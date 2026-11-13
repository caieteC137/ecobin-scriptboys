export const LIMITS = { massKg: 8, occupancyPct: 80, resetMassKg: 7, resetOccupancyPct: 70 };

export function normalizeReading(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Leitura precisa ser um objeto JSON.');
  const result = {};
  for (const name of ['lixeira', 'setor', 'compartimento']) {
    if (typeof input[name] !== 'string' || !input[name].trim() || input[name].length > 100) {
      throw new Error(`Campo ${name} ausente ou invalido.`);
    }
    result[name] = input[name].trim();
  }
  for (const [name, max] of [['massa_kg', 10000], ['distancia_cm', 1000], ['ocupacao_pct', 100]]) {
    if (typeof input[name] !== 'number' || !Number.isFinite(input[name]) || input[name] < 0 || input[name] > max) {
      throw new Error(`Campo ${name} precisa ser um numero entre 0 e ${max}.`);
    }
    result[name] = input[name];
  }
  if (typeof input.simulado !== 'boolean') throw new Error('Campo simulado precisa ser true ou false.');
  result.simulado = input.simulado;
  result.uptime_ms = Number.isSafeInteger(input.uptime_ms) && input.uptime_ms >= 0 ? input.uptime_ms : null;
  result.coletar = result.massa_kg >= 8 || result.ocupacao_pct >= 80;
  result.status = result.coletar ? 'coletar' : result.ocupacao_pct >= 70 ? 'acompanhar' : 'normal';
  return result;
}

export function deviceKey(reading) {
  return JSON.stringify([reading.lixeira, reading.setor, reading.compartimento]);
}
