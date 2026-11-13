const chats = flow.get('ecobin_chats') || [];
msg.payload = chats.length ? {
    chats,
    instrucao: 'Copie o chatId desejado para o no PREENCHER: Chat ID do Telegram e faca Deploy.'
} : {
    aviso: 'Envie /start novamente ao bot correto. O receptor precisa estar implantado antes da mensagem.',
    bot: flow.get('ecobin_bot_info') || null
};
return msg;
