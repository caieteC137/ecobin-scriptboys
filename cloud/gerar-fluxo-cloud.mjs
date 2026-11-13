import { readFile, writeFile } from 'node:fs/promises';
const source = JSON.parse(await readFile(new URL('../node-red/ecobin-flow.json', import.meta.url), 'utf8'));
for (const node of source) {
  delete node.credentials;
  if (node.type === 'tab') { node.label = 'EcoBin | Azure + EMQX + Telegram'; node.info = 'Instancia cloud. Credenciais e Chat ID configurados no arquivo privado cloud/.env.'; }
  if (node.type === 'mqtt-broker') {
    node.broker = '${MQTT_HOST}';
    node.clientid = 'ecobin-nodered-azure';
  }
  if (node.type === 'telegram bot') { node.updatemode = '${TELEGRAM_UPDATE_MODE}'; node.botname = 'EcoBin · Telegram cloud'; }
  if (node.id === 'ecobin_http') { node.url = '${ECOBIN_API_URL}'; node.name = 'Salvar no site Azure'; }
  if (node.id === 'ecobin_guide') { node.name = 'EcoBin | EMQX → Azure + Telegram'; node.info = 'Recebe MQTT com TLS, grava no site pela rede privada Docker e envia alertas. Configure cloud/.env; editor acessivel por tunel SSH.'; }
  if (node.id === 'ecobin_http_resultado') node.func = node.func.replace('Falha ao salvar leitura no site local. Inicie o site e confira a API.', 'Falha ao salvar leitura. Confira o servico site e o token de ingestao no ambiente.');
  if (node.id === 'ecobin_endpoint_func') node.name = 'Consultar integração Azure';
  if (node.id === 'ecobin_telegram_receber') node.func = node.func.replace('Copie este numero para o no "PREENCHER: Chat ID do Telegram" e faca Deploy para ativar os alertas de coleta.', 'O destino dos alertas e configurado em TELEGRAM_CHAT_ID no ambiente da VM.');
  if (node.id === 'ecobin_telegram_guide' || node.id === 'ecobin_chat_guide') node.info = 'Token e Chat ID definidos em cloud/.env. Apenas uma instancia deve usar polling para este bot. O bot responde /start com o Chat ID.';
  if (node.id === 'ecobin_preparar_http') node.func = "msg.headers={'Content-Type':'application/json',Authorization:'Bearer '+env.get('ECOBIN_INGEST_TOKEN')};return msg;";
  if (node.id === 'ecobin_chat_id') {
    node.rules = [{t:'set',p:'telegramChatId',pt:'msg',to:'TELEGRAM_CHAT_ID',tot:'env'}];
    node.name = 'Chat ID configurado no ambiente';
  }
}
const credentials = {};
for (const node of source) {
  if (node.type === 'mqtt-broker') credentials[node.id] = {user:'${MQTT_USER}',password:'${MQTT_PASSWORD}'};
  if (node.type === 'telegram bot') credentials[node.id] = {token:'${TELEGRAM_BOT_TOKEN}'};
}
await writeFile(new URL('./nodered/flows.json',import.meta.url),JSON.stringify(source,null,2)+'\n');
await writeFile(new URL('./nodered/flows_cred.json',import.meta.url),JSON.stringify(credentials,null,2)+'\n');
console.log('Fluxo cloud gerado com placeholders de ambiente, sem senhas.');
