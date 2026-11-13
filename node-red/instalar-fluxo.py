#!/usr/bin/env python3
"""Adiciona somente a aba EcoBin pela API local; preserva os demais fluxos."""
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent
base = 'http://127.0.0.1:1880'

def request(path, data=None, method=None):
    req = Request(base + path, data=json.dumps(data).encode() if data is not None else None,
                  headers={'Content-Type': 'application/json', 'Node-RED-API-Version': 'v2'}, method=method)
    with urlopen(req, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else {}

existing = request('/flows')['flows']
if any(n.get('id') == 'ecobin_mqtt' for n in existing):
    raise SystemExit('O fluxo EcoBin ja esta instalado. Edite-o no Node-RED; nenhuma alteracao foi feita.')
flow = json.loads((root / 'ecobin-flow-api.json').read_text())
sketch = (root.parent / 'ecoBin.ino').read_text()
if '#include "secrets.h"' in sketch:
    sketch += '\n' + (root.parent / 'secrets.h').read_text()
def value(name):
    return json.loads(re.search(r'\b' + name + r'\s*=\s*("(?:\\.|[^"\\])*")', sketch)[1])
broker = next(n for n in flow['configs'] if n['type'] == 'mqtt-broker')
broker['credentials'] = {'user': value('MQTT_USER'), 'password': value('MQTT_PASSWORD')}
broker['broker'] = value('MQTT_HOST')
result = request('/flow', flow, 'POST')
print('Nova aba EcoBin instalada:', result.get('id', '(consultar editor)'))
print('Fluxos anteriores preservados. Token Telegram e Chat ID aguardam preenchimento no editor.')
