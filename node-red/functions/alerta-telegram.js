// O Chat ID e preenchido no no Change anterior. Token fica nas credenciais do bot.
const chatId = String(msg.telegramChatId || '').trim();
if (!/^-?\d+$/.test(chatId)) {
    flow.set('ecobin_telegram_configurado', false);
    node.status({ fill: 'yellow', shape: 'ring', text: 'preencher Chat ID' });
    return null;
}
flow.set('ecobin_telegram_configurado', true);
if (msg.telegramTeste === true) {
    msg.payload = {
        chatId,
        type: 'message',
        content: 'EcoBin / ScriptBoys\nTeste de conexao do Node-RED com o Telegram concluido.'
    };
    delete msg.telegramChatId;
    return msg;
}

const r = msg.payload;
const key = JSON.stringify([r.lixeira, r.setor, r.compartimento]);
const cache = flow.get('ecobin_alertas') || {};
const now = Date.now();
const state = cache[key] || { ativo: false, notificado: false, tentativa: 0, ciclo: 0 };
if (!state.ativo && (r.massa_kg >= 8 || r.ocupacao_pct >= 80)) {
    state.ativo = true;
    state.notificado = false;
    state.tentativa = 0;
    state.ciclo = now;
}
if (state.ativo && r.massa_kg <= 7 && r.ocupacao_pct <= 70) {
    state.ativo = false;
    state.notificado = false;
    state.tentativa = 0;
}
cache[key] = state;
flow.set('ecobin_alertas', cache);
if (!state.ativo) {
    node.status({ fill: 'green', shape: 'dot', text: 'nivel normal' });
    return null;
}
if (state.notificado || now - state.tentativa < 60000) {
    node.status({ fill: 'yellow', shape: 'dot', text: state.notificado ? 'alerta ja entregue' : 'aguardando envio / nova tentativa em 60 s' });
    return null;
}
state.tentativa = now;
flow.set('ecobin_alertas', cache);
msg.ecobinAlertaKey = key;
msg.ecobinAlertaCiclo = state.ciclo;
msg.payload = {
    chatId,
    type: 'message',
    content: [
        'ECOBIN - ALERTA DE COLETA',
        '',
        'Setor: ' + r.setor,
        'Lixeira: ' + r.lixeira,
        'Compartimento: ' + r.compartimento,
        'Ocupacao: ' + r.ocupacao_pct.toFixed(1) + '%',
        'Massa: ' + r.massa_kg.toFixed(2) + ' kg',
        '',
        'Acao: programar coleta interna.',
        r.simulado ? 'Dados simulados do prototipo.' : 'Leitura dos sensores.',
        'Recebido: ' + new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    ].join('\n')
};
delete msg.telegramChatId;
node.status({ fill: 'blue', shape: 'dot', text: 'enviando alerta' });
return msg;
