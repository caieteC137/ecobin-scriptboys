if (msg.ecobinAlertaKey) {
    const cache = flow.get('ecobin_alertas') || {};
    const state = cache[msg.ecobinAlertaKey];
    if (state && state.ativo && state.ciclo === msg.ecobinAlertaCiclo) {
        state.notificado = true;
        flow.set('ecobin_alertas', cache);
    }
}
flow.set('ecobin_ultimo_telegram', Date.now());
msg.payload = { sucesso: true, origem: 'Telegram', enviado_em: new Date().toISOString(), messageId: msg.payload?.sentMessageId };
return msg;
