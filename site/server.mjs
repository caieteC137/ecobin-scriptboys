import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.mjs';
import { timingSafeEqual } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));

export async function createApplication({ database = resolve(root, 'data/ecobin.sqlite'), ingestToken = '', environment = 'local' } = {}) {
  if (database !== ':memory:') await mkdir(dirname(database), { recursive: true });
  const store = createStore(database);
  const streams = new Set();
  const staticFiles = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml']
  };
  function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function filters(url) {
    const minutes = Number(url.searchParams.get('minutos') || 60);
    if (![15, 60, 360, 1440, 10080].includes(minutes)) throw new Error('Periodo invalido.');
    const key = url.searchParams.get('lixeira') || '';
    if (key.length > 400) throw new Error('Filtro invalido.');
    return { minutes, key };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!['GET', 'POST', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Metodo nao permitido.' });
      if (req.method === 'POST' && url.pathname === '/api/telemetria') {
        if (ingestToken) {
          const expected = Buffer.from('Bearer ' + ingestToken);
          const actual = Buffer.from(req.headers.authorization || '');
          if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(res, 401, { error: 'Autenticacao de ingestao necessaria.' });
        }
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return json(res, 415, { error: 'Use Content-Type application/json.' });
        // Node-RED local nao envia Origin. Navegadores so podem gravar da propria origem.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Origem nao autorizada.' });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) { json(res, 413, { error: 'JSON excede 16 KB.' }); req.resume(); return; }
          chunks.push(chunk);
        }
        let reading;
        try { reading = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { return json(res, 400, { error: 'JSON invalido.' }); }
        let saved;
        try { saved = store.ingest(reading); }
        catch (error) {
          if (error.code?.startsWith('ERR_SQLITE')) throw error;
          return json(res, 400, { error: error.message });
        }
        for (const stream of streams) stream.write(`event: leitura\ndata: ${JSON.stringify({ id: saved.id })}\n\n`);
        return json(res, 201, { ok: true, id: saved.id, received_at: saved.received_at });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'Rota nao encontrada.' });
      if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'EcoBin local' });
      if (url.pathname === '/api/resumo') return json(res, 200, { ...store.summary(), environment });
      if (url.pathname === '/api/historico') return json(res, 200, store.history(filters(url)));
      if (url.pathname === '/api/exportar.csv') {
        const csv = store.csv(filters(url));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ecobin-leituras.csv"', 'Cache-Control': 'no-store' });
        return res.end(csv);
      }
      if (url.pathname === '/api/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write('event: conectado\ndata: {}\n\n');
        streams.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
        return;
      }
      const asset = staticFiles[url.pathname];
      if (!asset) return json(res, 404, { error: 'Rota nao encontrada.' });
      const body = await readFile(resolve(root, 'public', asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (!res.headersSent) json(res, error.message.includes('invalido') ? 400 : 500, { error: error.message.includes('invalido') ? error.message : 'Erro interno do servidor.' });
      else res.end();
      if (!error.message.includes('invalido')) console.error('[EcoBin]', error.code || error.name);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  function close() {
    for (const stream of streams) stream.end();
    return new Promise((done) => { server.close(() => { store.close(); done(); }); server.closeIdleConnections(); });
  }
  return { server, store, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const app = await createApplication({ database: process.env.ECOBIN_DB || resolve(root, 'data/ecobin.sqlite'), ingestToken: process.env.ECOBIN_INGEST_TOKEN || '', environment: process.env.ECOBIN_ENVIRONMENT || 'local' });
  app.server.listen(port, host, () => console.log(`EcoBin: http://${host}:${port}`));
  app.server.on('error', (error) => { console.error('Nao foi possivel iniciar o site:', error.message); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
