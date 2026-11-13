#!/usr/bin/env python3
"""Confere o fluxo ativo sem ler ou exibir tokens."""
import argparse
from datetime import datetime
import json
import sys
from urllib.request import build_opener, ProxyHandler

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--require-start', action='store_true', help='Exige /start recebido e resposta entregue pelo bot.')
args = parser.parse_args()
opener = build_opener(ProxyHandler({}))

def get(path):
    with opener.open('http://127.0.0.1:1880' + path, timeout=10) as response:
        return json.load(response)

try:
    nodes = {n['id']: n for n in get('/flows')}
    required = ['ecobin_chat_lookup_inject', 'ecobin_chat_lookup', 'ecobin_chat_debug', 'ecobin_telegram_receiver', 'ecobin_telegram_receber']
    missing = [name for name in required if name not in nodes]
    if missing:
        raise RuntimeError('Nos ausentes no fluxo ativo: ' + ', '.join(missing))
    print('PASSOU: botao Chat ID e receptor /start presentes.')
    bot_id = nodes['ecobin_telegram']['bot']
    if nodes['ecobin_telegram_receiver']['bot'] != bot_id:
        raise RuntimeError('Receptor e envio precisam usar a mesma configuracao do bot.')
    if nodes[bot_id].get('updatemode') != 'polling':
        raise RuntimeError('A configuracao do receptor precisa usar polling.')
    state = get('/ecobin/estado')
    if not (state.get('telegram_bot') or {}).get('ok'):
        raise RuntimeError('Token ainda nao confirmado por getMe. Clique Verificar bot no fluxo.')
    print('PASSOU: getMe confirmou o bot configurado, sem expor o token.')
    if args.require_start:
        if not state.get('ultimo_start'):
            raise RuntimeError('Nenhum /start novo foi recebido depois da correcao.')
        received = datetime.fromisoformat(state['ultimo_start'].replace('Z', '+00:00')).timestamp() * 1000
        if (state.get('ultimo_telegram') or 0) < received:
            raise RuntimeError('/start recebido; aguardando a confirmacao de entrega da resposta.')
        print('PASSOU: /start recebido e resposta confirmada pelo Telegram.')
    print('CHATS RECEBIDOS:', state.get('chats_recebidos', 0))
except (OSError, ValueError, KeyError, RuntimeError) as error:
    print('FALHOU: ' + str(error), file=sys.stderr)
    sys.exit(1)
