import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { normalizeReading } from '../lib/readings.mjs';

const reading = (extra = {}) => ({ lixeira: 'L01', setor: 'Produção A', compartimento: 'reciclável', simulado: true, uptime_ms: 1000, massa_kg: 3, distancia_cm: 30, ocupacao_pct: 40, ...extra });

test('API recalcula situação e rejeita leituras inválidas sem coagir valores', () => {
  assert.equal(normalizeReading(reading({ massa_kg: 8, coletar: false, status: 'normal' })).status, 'coletar');
  assert.equal(normalizeReading(reading({ ocupacao_pct: 80 })).coletar, true);
  for (const extra of [{ massa_kg: null }, { ocupacao_pct: '80' }, { ocupacao_pct: 101 }, { distancia_cm: -1 }, { simulado: 'true' }, { setor: '' }]) {
    assert.throws(() => normalizeReading(reading(extra)));
  }
});

test('eventos não se repetem por leitura e rearmam após normalização', () => {
  const store = createStore(':memory:');
  try {
    store.ingest(reading({ ocupacao_pct: 80 }));
    store.ingest(reading({ ocupacao_pct: 100 }));
    store.ingest(reading({ ocupacao_pct: 79 }));
    assert.equal(store.summary().events.length, 1);
    store.ingest(reading({ ocupacao_pct: 70, massa_kg: 7 }));
    store.ingest(reading({ ocupacao_pct: 81 }));
    assert.deepEqual(store.summary().events.map((e) => e.tipo), ['coleta', 'normalizado', 'coleta']);
    assert.equal(store.summary().stats.readings, 5);
  } finally { store.close(); }
});

test('separa compartimentos e marca leitura antiga como offline', () => {
  const store = createStore(':memory:');
  const now = Date.now();
  try {
    store.ingest(reading(), now - 31000);
    store.ingest(reading({ compartimento: 'orgânico' }), now);
    assert.equal(store.summary(now).devices.length, 2);
    assert.equal(store.summary(now).stats.online, 1);
    const key = store.summary().devices[0].device_key;
    assert.equal(store.history({ key }).rows.length, 1);
  } finally { store.close(); }
});

test('histórico persiste após reiniciar o armazenamento e CSV protege fórmulas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ecobin-store-'));
  try {
    let store = createStore(join(dir, 'test.sqlite'));
    store.ingest(reading({ setor: '=1+1', ocupacao_pct: 90 }));
    store.close();
    store = createStore(join(dir, 'test.sqlite'));
    assert.equal(store.summary().stats.readings, 1);
    assert.equal(store.summary().events.length, 1);
    assert.match(store.csv(), /"'=1\+1"/);
    store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('servidor recebe Node-RED, consulta histórico e rejeita entrada incorreta', async () => {
  const app = await createApplication({ database: ':memory:' });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (body, headers = {}) => fetch(base + '/api/telemetria', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(reading())).status, 201);
    assert.equal((await (await fetch(base + '/api/resumo')).json()).stats.readings, 1);
    assert.equal((await (await fetch(base + '/api/historico')).json()).rows[0].lixeira, 'L01');
    assert.equal((await post(reading({ massa_kg: null }))).status, 400);
    assert.equal((await post(reading(), { Origin: 'https://outro-site.example' })).status, 403);
    assert.equal((await fetch(base + '/api/telemetria', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(base + '/api/historico?minutos=banana')).status, 400);
    assert.equal((await fetch(base + '/rota-inexistente')).status, 404);
    assert.match(await (await fetch(base + '/api/exportar.csv')).text(), /L01/);
    assert.equal((await fetch(base)).status, 200);
    assert.match((await fetch(base)).headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally { await app.close(); }
});

test('ingestão cloud exige token e preserva a leitura pública do painel', async () => {
  const app = await createApplication({ database: ':memory:', ingestToken: 'token-de-teste', environment: 'azure' });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const send = (authorization) => fetch(base + '/api/telemetria', { method: 'POST', headers: { 'Content-Type':'application/json', ...(authorization ? { Authorization:authorization } : {}) }, body:JSON.stringify(reading()) });
  try {
    assert.equal((await send()).status,401);
    assert.equal((await send('Bearer errado')).status,401);
    assert.equal((await send('Bearer token-de-teste')).status,201);
    const summary=await (await fetch(base+'/api/resumo')).json();
    assert.equal(summary.environment,'azure');
    assert.equal(summary.stats.readings,1);
  } finally { await app.close(); }
});
