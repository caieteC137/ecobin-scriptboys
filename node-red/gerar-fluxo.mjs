import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeReading } from '../site/lib/readings.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const z = 'ecobin_local_flow';
const nodes = [];
function add(id, type, name, x, y, wires = [], extra = {}) {
  nodes.push({ id, type, z, name, x, y, wires, ...extra });
}
function fn(id, name, x, y, func, wires, extra = {}) {
  add(id, 'function', name, x, y, wires, { func, outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], ...extra });
}
function debug(id, name, x, y, active = true) {
  add(id, 'debug', name, x, y, [], { active, tosidebar: true, console: false, tostatus: false, complete: 'payload', targetType: 'msg', statusVal: '', statusType: 'auto' });
}
add('ecobin_guide', 'comment', 'EcoBin | EMQX → site local + Telegram', 290, 40, [], { info: 'Fluxo do EcoBin. Recebe telemetria real do ESP32 pelo EMQX, valida e envia ao site local. Telegram: preencha Chat ID no no laranja e Token no bot EcoBin. Clique Testar Telegram somente depois de enviar /start ao seu bot. Limites: 80% ou 8 kg; rearmar abaixo de 70% e 7 kg. O token nunca deve ir no JSON do site.' });
add('ecobin_mqtt', 'mqtt in', 'ESP32 / EMQX · telemetria', 170, 120, [['ecobin_normalizar']], {
  topic: 'ecobin/+/telemetria', qos: '0', datatype: 'utf8', broker: 'ecobin_broker', nl: false, rap: true, rh: 0, inputs: 0
});
const validation = `${normalizeReading.toString()}
try {
    const input = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
    msg.payload = normalizeReading(input);
    const parts = String(msg.topic || '').split('/');
    if (parts.length === 3 && parts[0] === 'ecobin' && parts[2] === 'telemetria' && parts[1] !== msg.payload.lixeira) throw new Error('Lixeira nao corresponde ao topico MQTT.');
    flow.set('ecobin_ultima_leitura', { ...msg.payload, recebido_em: new Date().toISOString() });
    node.status({fill:'green',shape:'dot',text:msg.payload.lixeira+' / '+msg.payload.ocupacao_pct.toFixed(0)+'% / '+msg.payload.massa_kg.toFixed(2)+' kg'});
    return msg;
} catch (error) {
    node.error('Telemetria rejeitada: ' + error.message, msg);
    return null;
}`;
fn('ecobin_normalizar', 'Validar JSON e calcular situação', 465, 120, validation, [['ecobin_preparar_http', 'ecobin_chat_id', 'ecobin_debug_leitura']]);
fn('ecobin_preparar_http', 'JSON → API do site', 740, 120,
  `msg.headers = {'Content-Type':'application/json'};\nreturn msg;`, [['ecobin_http']]);
add('ecobin_http', 'http request', 'Salvar no site local :3000', 1005, 120, [['ecobin_http_resultado']], {
  method: 'POST', ret: 'obj', paytoqs: 'ignore', url: 'http://127.0.0.1:3000/api/telemetria', tls: '', persist: false, proxy: '', insecureHTTPParser: false, authType: '', senderr: false, headers: [], requestTimeout: '5000'
});
fn('ecobin_http_resultado', 'Resultado da gravação', 1270, 120,
  `const ok = msg.statusCode === 201 && msg.payload?.ok === true;
flow.set('ecobin_http', {ok,status:msg.statusCode || 0,atualizado_em:new Date().toISOString()});
node.status({fill:ok?'green':'red',shape:'dot',text:ok?'gravado / ID '+msg.payload.id:'erro HTTP '+msg.statusCode});
if (!ok) node.error('Falha ao salvar leitura no site local. Inicie o site e confira a API.', msg);
return null;`, [[]]);
debug('ecobin_debug_leitura', 'Telemetria validada (opcional)', 755, 200, false);
add('ecobin_chat_id', 'change', 'PREENCHER: Chat ID do Telegram', 755, 300, [['ecobin_alerta']], {
  rules: [{ t: 'set', p: 'telegramChatId', pt: 'msg', to: '', tot: 'str' }], action: '', property: '', from: '', to: '', reg: false
});
fn('ecobin_alerta', 'Alerta de coleta · sem repetição', 1055, 300,
  await readFile(resolve(root, 'functions/alerta-telegram.js'), 'utf8'), [['ecobin_telegram']]);
add('ecobin_telegram', 'telegram sender', 'Telegram · bot EcoBin (Token)', 1350, 300, [['ecobin_telegram_ok'], ['ecobin_error_sanitize']], {
  bot: 'ecobin_telegram_bot', haserroroutput: true, outputs: 2
});
fn('ecobin_telegram_ok', 'Confirmar entrega', 1610, 280,
  await readFile(resolve(root, 'functions/confirmar-telegram.js'), 'utf8'), [['ecobin_debug_telegram']]);
debug('ecobin_debug_telegram', 'Telegram entregue', 1830, 280);
add('ecobin_test_telegram', 'inject', 'Testar Telegram (manual)', 450, 360, [['ecobin_chat_id']], {
  props: [{ p: 'telegramTeste', v: 'true', vt: 'bool' }], repeat: '', crontab: '', once: false, onceDelay: .1, topic: '', payload: '', payloadType: 'date'
});
add('ecobin_telegram_guide', 'comment', 'Telegram: bot único em polling → /start → Chat ID → alertas', 930, 245, [], { info: 'Pode usar o bot antigo. Selecione a mesma configuracao de Bot nos nos Telegram do EcoBin e mantenha polling. Depois de Deploy, envie /start novamente ao bot. Ele responde com o Chat ID. Copie o numero para o no laranja, faca Deploy e teste. Os alertas de coleta ficam bloqueados enquanto Chat ID estiver vazio.' });
add('ecobin_catch', 'catch', 'Erros do fluxo EcoBin', 175, 460, [['ecobin_error_sanitize']], { scope: null, uncaught: false });
fn('ecobin_error_sanitize', 'Erro resumido (sem token)', 455, 460,
  `const error = msg.error;
const text = (typeof error === 'string' ? error : error?.message) || 'Falha na integracao.';
msg = {payload:{erro:text.replace(/bot\\d+:[A-Za-z0-9_-]+/g,'bot<token-omitido>'),origem:error?.source?.name || 'EcoBin',horario:new Date().toISOString()}};
return msg;`, [['ecobin_debug_error']]);
debug('ecobin_debug_error', 'Erros EcoBin', 735, 460);
add('ecobin_status_mqtt', 'status', 'Estado da conexão EMQX', 185, 520, [['ecobin_status_func']], { scope: ['ecobin_mqtt'] });
fn('ecobin_status_func', 'Registrar conexão', 455, 520,
  `flow.set('ecobin_mqtt_status',msg.status?.text || 'desconhecido');\nmsg.payload=msg.status;\nreturn msg;`, [['ecobin_debug_status']]);
debug('ecobin_debug_status', 'Conexão EMQX', 735, 520);
add('ecobin_endpoint', 'http in', 'GET /ecobin/estado', 170, 620, [['ecobin_endpoint_func']], { url: '/ecobin/estado', method: 'get', upload: false, swaggerDoc: '' });
fn('ecobin_endpoint_func', 'Consultar integração local', 460, 620,
  `msg.payload={mqtt:flow.get('ecobin_mqtt_status')||'aguardando',ultima_leitura:flow.get('ecobin_ultima_leitura')||null,site:flow.get('ecobin_http')||null,telegram_chat_configurado:flow.get('ecobin_telegram_configurado')||false,ultimo_telegram:flow.get('ecobin_ultimo_telegram')||null,telegram_bot:flow.get('ecobin_bot_info')||null,ultimo_start:flow.get('ecobin_ultimo_start')||null,chats_recebidos:(flow.get('ecobin_chats')||[]).length};\nmsg.headers={'Content-Type':'application/json'};\nreturn msg;`, [['ecobin_endpoint_response']]);
add('ecobin_endpoint_response', 'http response', 'Estado JSON', 740, 620, [], { statusCode: '200', headers: {} });
add('ecobin_chat_guide', 'comment', 'CONFIGURAR TELEGRAM: envie /start ao bot para receber seu Chat ID', 540, 710, [], { info: 'O receptor compartilha a mesma configuracao do bot de envio. Ele responde somente a /start e mostra Chat IDs no Debug. O botao manual consulta os chats ja recebidos; nao executa getUpdates concorrente com polling. O destino dos alertas continua sendo escolhido no no laranja.' });
add('ecobin_telegram_receiver', 'telegram receiver', 'Receber /start do Telegram', 185, 770, [['ecobin_telegram_receber'], []], { bot: 'ecobin_telegram_bot', saveDataDir: '', filterCommands: false, hasinput: false, inputs: 0, handleallupdates: false, handleprocessupdates: false });
fn('ecobin_telegram_receber', 'Responder /start com Chat ID', 510, 770,
  await readFile(resolve(root, 'functions/receber-start.js'), 'utf8'), [['ecobin_telegram'], ['ecobin_chat_debug']], { outputs: 2 });
add('ecobin_chat_lookup_inject', 'inject', 'Obter Chat ID (manual)', 190, 780, [['ecobin_chat_lookup']], {
  props: [{ p: 'payload' }], repeat: '', crontab: '', once: false, onceDelay: .1, topic: '', payload: '', payloadType: 'date', y: 850
});
fn('ecobin_chat_lookup', 'Consultar Chat IDs recebidos', 505, 850, await readFile(resolve(root, 'functions/consultar-chat-id.js'), 'utf8'), [['ecobin_chat_debug']]);
debug('ecobin_chat_debug', 'SEU CHAT ID (copiar para nó laranja)', 850, 820);
add('ecobin_bot_check_inject', 'inject', 'Verificar bot (getMe)', 180, 950, [['ecobin_bot_check']], { props: [{p:'payload'}], repeat:'', crontab:'', once:true, onceDelay:2, payload:JSON.stringify({type:'callApi',method:'getMe',args:[]}), payloadType:'json' });
add('ecobin_bot_check', 'telegram sender', 'Identificar bot configurado', 475, 950, [['ecobin_bot_check_result'], ['ecobin_error_sanitize']], { bot:'ecobin_telegram_bot', haserroroutput:true, outputs:2 });
fn('ecobin_bot_check_result', 'Guardar nome público do bot', 780, 950,
  `const bot=msg.payload?.content;if(!bot?.is_bot){node.error('getMe nao retornou um bot valido',msg);return null;}\nmsg.payload={ok:true,username:bot.username,nome:bot.first_name};flow.set('ecobin_bot_info',msg.payload);node.status({fill:'green',shape:'dot',text:'@'+bot.username});return msg;`, [['ecobin_bot_debug']]);
debug('ecobin_bot_debug', 'Bot Telegram confirmado (sem token)', 1100, 950);

const configs = [
  { id: 'ecobin_broker', type: 'mqtt-broker', name: 'EcoBin · EMQX Cloud TLS', broker: 'w7017121.ala.us-east-1.emqxsl.com', port: '8883', clientid: 'ecobin-nodered-local', autoConnect: true, usetls: true, protocolVersion: '4', keepalive: '60', cleansession: true, autoUnsubscribe: true, birthTopic: '', birthQos: '0', birthPayload: '', birthMsg: {}, closeTopic: '', closeQos: '0', closePayload: '', closeMsg: {}, willTopic: '', willQos: '0', willPayload: '', willMsg: {}, tls: 'ecobin_tls' },
  { id: 'ecobin_tls', type: 'tls-config', name: 'TLS · verificar certificado EMQX', cert: '', key: '', ca: '', certname: '', keyname: '', caname: '', servername: 'w7017121.ala.us-east-1.emqxsl.com', verifyservercert: true, alpnprotocol: '' },
  { id: 'ecobin_telegram_bot', type: 'telegram bot', botname: 'EcoBin - PREENCHER TOKEN', usernames: '', chatids: '', baseapiurl: '', testenvironment: false, updatemode: 'polling', pollinterval: 300, addressfamily: '', usesocks: false, sockshost: '', socksprotocol: 'socks5', socksport: 6667, socksusername: 'anonymous', sockspassword: '', bothost: '', botpath: '', localbothost: '0.0.0.0', localbotport: 8443, publicbotport: 8443, privatekey: '', certificate: '', useselfsignedcertificate: false, sslterminated: false, verboselogging: false }
];
const flow = { id: z, label: 'EcoBin | EMQX + Site + Telegram', disabled: false, info: 'Fluxo local do EcoBin. Consulte README.md do projeto para configurar o bot Telegram.', nodes, configs };
await writeFile(resolve(root, 'ecobin-flow.json'), JSON.stringify([{ id: z, type: 'tab', label: flow.label, disabled: false, info: flow.info }, ...configs, ...nodes], null, 2) + '\n');
await writeFile(resolve(root, 'ecobin-flow-api.json'), JSON.stringify(flow, null, 2) + '\n');
console.log('Fluxo gerado sem senhas ou token. Configuracao MQTT e aplicada pelas credenciais do runtime.');
