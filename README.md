# EcoBin — ESP32 conectado ao EMQX

Abra **ecoBin.ino** nesta pasta no Arduino IDE. Este e o sketch corrigido e ja gravado na placa conectada em `/dev/ttyUSB0`.

## Configuracao pronta

- Placa identificada: ESP32-D0WD-V3. No IDE, selecione **ESP32 Dev Module**.
- Nome e senha do Wi-Fi estao nas constantes `WIFI_SSID` e `WIFI_PASSWORD`, no arquivo local `secrets.h`, incluido pelo sketch. Ao clonar, copie `secrets.example.h` para `secrets.h` e preencha os valores.
- Broker: `w7017121.ala.us-east-1.emqxsl.com`, porta **8883**, MQTT com TLS.
- Usuario e senha MQTT tambem ficam em `secrets.h`. Esse arquivo nao e enviado ao GitHub.
- CA: DigiCert Global Root G2. A verificacao do certificado permanece ativa.
- Telemetria JSON: `ecobin/L01/telemetria`, a cada segundo.
- Presenca: `ecobin/L01/status`, com `online` retido e Last Will `offline`.
- Monitor Serial: **115200 baud**. Envie `t` para zerar a simulacao de massa e ocupacao.

Os dados ainda sao **simulados**, identificados por `"simulado":true`. Este passo valida a comunicacao com a nuvem, sem exigir os sensores conectados.

## Resultado confirmado em 04/11/2026

Compilacao concluida com Arduino ESP32 3.3.11 e PubSubClient instalado. Firmware gravado por USB, com verificacao do hash da flash.

Um cliente independente autenticou no EMQX, assinou o topico e recebeu tres publicacoes novas do ESP32, com `uptime_ms` 79004, 80008 e 81011. A placa tambem recebeu de volta as proprias publicacoes:

```text
[MQTT] CONECTADO!
[MQTT] Telemetria enviada; aguardando retorno pelo broker.
[MQTT] Confirmacao do broker: telemetria recebida (192 bytes).
PASSOU: telemetria do ESP32 recebida pelo EMQX
```

Nesta rede, a inicializacao precisou de aproximadamente **80 segundos**, incluindo novas tentativas de Wi-Fi e sincronizacao NTP. Se aparecer uma falha inicial, o sketch continua tentando automaticamente. As falhas de Wi-Fi, horario, TLS e autenticacao aparecem separadamente no Monitor Serial.

## Repetir a verificacao pelo computador

Com a placa ligada e com acesso a internet, execute:

```bash
python3 /home/caio/Arduino/ecoBin/tools/verificar_emqx.py --timeout 120
```

O script usa somente a biblioteca padrao do Python. Le o host, a CA e as credenciais diretamente do sketch, sem imprimir as senhas. Valida TLS e autenticacao e exige tres mensagens novas do ESP32, ignorando mensagens retidas antigas.

Para o Node-RED ou MQTTX, configure o mesmo host, porta 8883, TLS ativo e as credenciais MQTT do sketch. Assine `ecobin/L01/telemetria`. O login do painel EMQX e diferente do usuario MQTT cadastrado em Authentication.

## Correcoes realizadas

O sketch anterior tinha um texto de exemplo no lugar do certificado e uma senha MQTT recusada pelo EMQX com codigo 4. Foram corrigidos a CA, a senha MQTT e os dados do Wi-Fi. As tentativas de Wi-Fi e NTP agora possuem limite de espera, e os clientes sao configurados antes da primeira tentativa para permitir recuperacao automatica.

A versao anterior foi preservada em `ecoBin.ino.bak`. Os outros sketches da pasta Arduino permanecem como estavam.

## Node-RED e site local

As etapas seguintes estao salvas nas subpastas deste projeto:

- `node-red/`: fluxo EMQX -> validacao -> site local e alertas Telegram. Consulte `node-red/README.md` para preencher o token do bot novo e o Chat ID.
- `site/`: painel local com API HTTP, historico SQLite e exportacao CSV. Abra **http://127.0.0.1:3000**. Consulte `site/README.md` para iniciar novamente.
- `cloud/`: implantacao na VM Ubuntu Azure com Docker Compose, HTTPS e Node-RED protegido. Consulte `cloud/README.md`.

O fluxo esta instalado no Node-RED em **http://127.0.0.1:1880**. Os dados seguem simulados no ESP32, mas percorrem a conexao real EMQX -> Node-RED -> API -> SQLite -> navegador. O Telegram reutiliza o bot antigo Alerta Esp32, com Chat ID preenchido: recebimento de `/start` e entrega da resposta e da mensagem de teste foram confirmados pela API do Telegram.
