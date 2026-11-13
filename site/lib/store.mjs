import { DatabaseSync } from 'node:sqlite';
import { normalizeReading, deviceKey, LIMITS } from './readings.mjs';

export function createStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY, device_key TEXT NOT NULL, received_at INTEGER NOT NULL,
      lixeira TEXT NOT NULL, setor TEXT NOT NULL, compartimento TEXT NOT NULL,
      massa_kg REAL NOT NULL, distancia_cm REAL NOT NULL, ocupacao_pct REAL NOT NULL,
      simulado INTEGER NOT NULL, uptime_ms INTEGER, coletar INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS readings_time ON readings(received_at);
    CREATE INDEX IF NOT EXISTS readings_device_time ON readings(device_key, received_at);
    CREATE TABLE IF NOT EXISTS devices (
      device_key TEXT PRIMARY KEY, latest_id INTEGER NOT NULL, alert_active INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, device_key TEXT NOT NULL, received_at INTEGER NOT NULL,
      tipo TEXT NOT NULL, lixeira TEXT NOT NULL, setor TEXT NOT NULL, compartimento TEXT NOT NULL,
      massa_kg REAL NOT NULL, ocupacao_pct REAL NOT NULL, simulado INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_time ON events(received_at);
  `);
  const insert = db.prepare(`INSERT INTO readings(device_key,received_at,lixeira,setor,compartimento,massa_kg,
    distancia_cm,ocupacao_pct,simulado,uptime_ms,coletar,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const previous = db.prepare('SELECT * FROM devices WHERE device_key=?');
  const upsert = db.prepare(`INSERT INTO devices(device_key,latest_id,alert_active) VALUES(?,?,?)
    ON CONFLICT(device_key) DO UPDATE SET latest_id=excluded.latest_id,alert_active=excluded.alert_active`);
  const insertEvent = db.prepare(`INSERT INTO events(device_key,received_at,tipo,lixeira,setor,compartimento,
    massa_kg,ocupacao_pct,simulado) VALUES(?,?,?,?,?,?,?,?,?)`);
  const convert = (row) => row && { ...row, simulado: !!row.simulado, ...(row.coletar === undefined ? {} : { coletar: !!row.coletar }) };
  let lastCleanup = 0;

  function ingest(input, now = Date.now()) {
    const r = normalizeReading(input);
    const key = deviceKey(r);
    db.exec('BEGIN');
    try {
      const old = previous.get(key);
      let active = !!old?.alert_active;
      let event = null;
      if (!active && r.coletar) { active = true; event = 'coleta'; }
      else if (active && r.massa_kg <= LIMITS.resetMassKg && r.ocupacao_pct <= LIMITS.resetOccupancyPct) {
        active = false; event = 'normalizado';
      }
      const id = Number(insert.run(key, now, r.lixeira, r.setor, r.compartimento, r.massa_kg, r.distancia_cm,
        r.ocupacao_pct, +r.simulado, r.uptime_ms, +r.coletar, r.status).lastInsertRowid);
      upsert.run(key, id, +active);
      if (event) insertEvent.run(key, now, event, r.lixeira, r.setor, r.compartimento, r.massa_kg, r.ocupacao_pct, +r.simulado);
      db.exec('COMMIT');
      if (now - lastCleanup > 3600000) {
        const cutoff = now - 7 * 86400000;
        db.prepare('DELETE FROM readings WHERE received_at < ? AND id NOT IN (SELECT latest_id FROM devices)').run(cutoff);
        db.prepare('DELETE FROM events WHERE received_at < ?').run(cutoff);
        lastCleanup = now;
      }
      return { id, ...r, device_key: key, received_at: now };
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  function summary(now = Date.now()) {
    const devices = db.prepare(`SELECT r.* FROM devices d JOIN readings r ON r.id=d.latest_id
      ORDER BY r.coletar DESC,r.ocupacao_pct DESC,r.lixeira`).all().map((r) => ({ ...convert(r), online: now - r.received_at < 30000 }));
    return {
      server_time: now, limits: LIMITS, devices,
      events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all().map(convert),
      stats: {
        total: devices.length, online: devices.filter((d) => d.online).length,
        collect: devices.filter((d) => d.coletar).length,
        mass: devices.reduce((sum, d) => sum + d.massa_kg, 0),
        occupancy: devices.length ? devices.reduce((sum, d) => sum + d.ocupacao_pct, 0) / devices.length : 0,
        readings: db.prepare('SELECT COUNT(*) AS n FROM readings').get().n,
        latest: devices.length ? Math.max(...devices.map((d) => d.received_at)) : null
      }
    };
  }

  function history({ key = '', minutes = 60, limit = 100 } = {}) {
    const cutoff = Date.now() - minutes * 60000;
    const condition = key ? 'received_at >= ? AND device_key = ?' : 'received_at >= ?';
    const args = key ? [cutoff, key] : [cutoff];
    const rows = db.prepare(`SELECT * FROM readings WHERE ${condition} ORDER BY id DESC LIMIT ?`).all(...args, limit).map(convert);
    const bucket = Math.max(1000, Math.floor(minutes * 60000 / 180));
    // Cada serie agrupa uma unica lixeira/setor/compartimento.
    const points = db.prepare(`SELECT device_key,lixeira,setor,compartimento,
      MAX(received_at) AS received_at,AVG(ocupacao_pct) AS ocupacao_pct,AVG(massa_kg) AS massa_kg
      FROM readings WHERE ${condition} GROUP BY device_key,CAST(received_at / ? AS INTEGER)
      ORDER BY received_at`).all(...args, bucket);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM readings WHERE ${condition}`).get(...args).n;
    return { rows, points, count, minutes };
  }

  function csv({ key = '', minutes = 60 } = {}) {
    const cutoff = Date.now() - minutes * 60000;
    const rows = key
      ? db.prepare('SELECT * FROM readings WHERE received_at>=? AND device_key=? ORDER BY id LIMIT 100000').all(cutoff, key)
      : db.prepare('SELECT * FROM readings WHERE received_at>=? ORDER BY id LIMIT 100000').all(cutoff);
    const cell = (v) => {
      const value = String(v ?? '');
      return '"' + (/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
    };
    return '\uFEFF' + [
      ['recebido_em_utc', 'lixeira', 'setor', 'compartimento', 'massa_kg', 'ocupacao_pct', 'distancia_cm', 'status', 'simulado'],
      ...rows.map((r) => [new Date(r.received_at).toISOString(),r.lixeira,r.setor,r.compartimento,r.massa_kg,r.ocupacao_pct,r.distancia_cm,r.status,!!r.simulado])
    ].map((row) => row.map(cell).join(';')).join('\r\n');
  }
  return { ingest, summary, history, csv, close: () => db.close() };
}
