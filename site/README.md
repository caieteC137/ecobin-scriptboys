# EcoBin — site local

Painel de coleta salvo nesta pasta, sem publicacao em hospedagem externa. O servidor recebe as leituras do Node-RED e grava o historico no SQLite local. A comunicacao com o EMQX permanece no Node-RED; o navegador nao recebe a senha MQTT nem o token do Telegram.

## Abrir

**http://127.0.0.1:3000**

O site esta configurado para escutar apenas em `127.0.0.1`, neste computador. As leituras sao do ESP32 e continuam identificadas como simuladas enquanto o sketch usar a simulacao.

## Iniciar novamente

Requer **Node.js 24 ou superior**. Nao precisa instalar pacotes adicionais.

```bash
cd /home/caio/Arduino/ecoBin/site
npm start
```

Mantenha esse terminal aberto durante o teste. Para parar, pressione Ctrl+C.

Nesta sessao, o servidor foi iniciado como servico temporario do usuario para continuar ativo enquanto voce usa o navegador:

```bash
systemctl --user status ecobin-local.service
systemctl --user stop ecobin-local.service
```

Se esse servico estiver ativo, nao execute outro `npm start` na mesma porta. Depois de encerrar a sessao ou reiniciar o computador, inicie com `npm start`.

## O que esta pronto

- Visao geral por lixeira, setor e compartimento, com massa, ocupacao e situacao.
- Atualizacao automatica e indicacao de leituras ausentes ha mais de 30 segundos.
- Grafico da ocupacao na ultima hora, usando somente as leituras recebidas.
- Eventos de limite atingido e nivel normalizado, sem um evento novo a cada segundo.
- Historico com filtros de lixeira e periodo e exportacao CSV.
- Persistencia em `data/ecobin.sqlite`, com retencao de 7 dias. A ultima leitura de cada ponto e preservada para indicar quando ele ficou offline.
- API HTTP para receber os dados do fluxo Node-RED.

Os eventos do painel registram as condicoes da leitura; nao comprovam entrega de notificacao pelo Telegram. A entrega aparece no Debug do Node-RED em `Telegram entregue`.

## Integracao com o Node-RED

O fluxo ja esta instalado na aba **EcoBin | EMQX + Site + Telegram** em:

**http://127.0.0.1:1880**

O no `Salvar no site local :3000` envia JSON para:

```text
POST http://127.0.0.1:3000/api/telemetria
Content-Type: application/json
```

Exemplo do contrato (ilustrativo, nao inserido automaticamente no banco):

```json
{
  "lixeira": "L01",
  "setor": "Producao A",
  "compartimento": "reciclavel",
  "simulado": true,
  "uptime_ms": 15000,
  "massa_kg": 3.2,
  "distancia_cm": 25.0,
  "ocupacao_pct": 55.5
}
```

O servidor valida os campos e calcula `coletar` e `status`. Limite de coleta: ocupacao >= 80% **ou** massa >= 8 kg. Um novo ciclo de alerta e liberado quando a ocupacao volta a <= 70% **e** a massa a <= 7 kg.

Rotas de consulta:

| Metodo | Rota | Uso |
| --- | --- | --- |
| GET | `/api/health` | Saude do servidor |
| GET | `/api/resumo` | Ultima leitura por ponto, indicadores e eventos |
| GET | `/api/historico?minutos=60` | Leituras e pontos do grafico |
| GET | `/api/exportar.csv?minutos=60` | Download do historico |
| GET | `/api/eventos` | Atualizacao do navegador via SSE |

Os filtros aceitam 15, 60, 360, 1440 e 10080 minutos. O filtro `lixeira` usa a chave do ponto retornada em `device_key`, que identifica lixeira, setor e compartimento juntos.

## Testes

```bash
cd /home/caio/Arduino/ecoBin/site
npm test
node ../node-red/teste-fluxo.mjs
```

Os testes usam banco temporario ou em memoria. Eles verificam validacao, persistencia, eventos sem repeticao, filtro por compartimento, CSV, API e regras do Telegram. Nao enviam mensagens reais.

## Hospedagem Azure

A configuracao Docker para executar este mesmo painel na VM Ubuntu, com HTTPS e ingestao autenticada, esta em `../cloud/`. Consulte `../cloud/README.md`. O modo local continua disponivel com `npm start`.
