const p = msg.payload;
if (!p || p.type !== 'message' || typeof p.content !== 'string' || !/^\/start(?:@\w+)?(?:\s|$)/.test(p.content.trim())) return null;
const chatId = String(p.chatId || '');
if (!/^-?\d+$/.test(chatId)) return null;
const chat = msg.originalMessage?.chat || {};
const chats = flow.get('ecobin_chats') || [];
const entry = { chatId, tipo: chat.type || 'desconhecido', nome: chat.title || chat.first_name || '', recebido_em: new Date().toISOString() };
const saved = [entry, ...chats.filter(c => c.chatId !== chatId)].slice(0, 30);
flow.set('ecobin_chats', saved);
flow.set('ecobin_ultimo_start', entry.recebido_em);
node.status({ fill: 'green', shape: 'dot', text: '/start recebido' });
// A resposta vai somente ao chat que iniciou a conversa. O destino dos alertas continua manual.
const reply = { payload: {
    chatId, type: 'message',
    content: 'EcoBin conectado ao Node-RED.\n\nSeu Chat ID: ' + chatId + '\n\nCopie este numero para o no "PREENCHER: Chat ID do Telegram" e faca Deploy para ativar os alertas de coleta.'
} };
return [reply, { payload: { chats: saved, instrucao: 'Copie o chatId desejado para o no laranja e faca Deploy.' } }];
