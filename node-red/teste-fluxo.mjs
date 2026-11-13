import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const file = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const flow = JSON.parse(await file('./ecobin-flow-api.json'));
const funcs = new Map(flow.nodes.filter((n) => n.type === 'function').map((n) => [n.id, new Function('msg', 'node', 'flow', n.func)]));
function harness() {
  const values = new Map(), errors = [];
  return { context: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) }, node: { status() {}, error(...args) { errors.push(args); } }, values, errors };
}
const reading = (extra = {}) => ({ lixeira: 'L01', setor: 'Producao A', compartimento: 'reciclavel', massa_kg: 3, ocupacao_pct: 40, distancia_cm: 30, simulado: true, ...extra });

test('todas as funções do JSON importável possuem sintaxe válida', () => assert.equal(funcs.size, 11));
test('valida JSON MQTT, rejeita tópico divergente e valores ausentes', () => {
  const h = harness(), run = funcs.get('ecobin_normalizar');
  assert.equal(run({ topic: 'ecobin/L01/telemetria', payload: JSON.stringify(reading({ ocupacao_pct: 90 })) }, h.node, h.context).payload.status, 'coletar');
  assert.equal(run({ topic: 'ecobin/L02/telemetria', payload: reading() }, h.node, h.context), null);
  assert.equal(run({ topic: 'ecobin/L01/telemetria', payload: reading({ massa_kg: null }) }, h.node, h.context), null);
  assert.equal(h.errors.length, 2);
});
test('Chat ID vazio bloqueia envio; teste manual só sai com Chat ID preenchido', () => {
  const h = harness(), run = funcs.get('ecobin_alerta');
  assert.equal(run({ payload: reading({ ocupacao_pct: 100 }) }, h.node, h.context), null);
  const msg = run({ telegramTeste: true, telegramChatId: '-98765432' }, h.node, h.context);
  assert.equal(msg.payload.chatId, '-98765432');
  assert.equal(msg.payload.type, 'message');
});
test('alerta aguarda entrega e não repete; nova coleta rearma após nível baixo', () => {
  const h = harness(), run = funcs.get('ecobin_alerta'), ack = funcs.get('ecobin_telegram_ok');
  const message = (extra = {}) => ({ telegramChatId: '12345', payload: reading({ ocupacao_pct: 90, ...extra }) });
  const first = run(message(), h.node, h.context);
  assert.match(first.payload.content, /ALERTA DE COLETA/);
  assert.equal(run(message(), h.node, h.context), null);
  ack(first, h.node, h.context);
  assert.equal(run(message(), h.node, h.context), null);
  assert.equal(run(message({ ocupacao_pct: 79 }), h.node, h.context), null);
  assert.equal(run(message({ ocupacao_pct: 70, massa_kg: 7 }), h.node, h.context), null);
  assert.ok(run(message(), h.node, h.context));
});

test('/start responde com Chat ID, sem alterar o destino dos alertas', () => {
  assert.ok(funcs.has('ecobin_telegram_receber'), 'Receptor /start ausente do fluxo');
  const h = harness(), run = funcs.get('ecobin_telegram_receber');
  const output = run({payload:{chatId:12345,type:'message',content:'/start',messageId:8},originalMessage:{chat:{id:12345,type:'private',first_name:'Teste'}}}, h.node, h.context);
  assert.equal(output[0].payload.chatId, '12345');
  assert.match(output[0].payload.content,/12345/);
  assert.equal(h.values.has('ecobin_telegram_chat_destino'),false);
  assert.equal(output[1].payload.chats.length,1);
  assert.equal(run({payload:{chatId:12345,type:'message',content:'oi'}}, h.node, h.context),null);
});

test('botão Chat ID consulta o receptor local, sem getUpdates concorrente', () => {
  const lookup = flow.nodes.find(n=>n.id==='ecobin_chat_lookup');
  assert.equal(lookup?.type,'function');
  const h=harness();h.values.set('ecobin_chats',[{chatId:'12345',tipo:'private',nome:'Teste'}]);
  const output=funcs.get('ecobin_chat_lookup')({},h.node,h.context);
  assert.equal(output.payload.chats[0].chatId,'12345');
});
