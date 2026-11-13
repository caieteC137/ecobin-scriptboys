# EcoBin — sensores reais, ESP32 e EMQX

Abra **ecoBin.ino** nesta pasta no Arduino IDE. Ele integra o HX711 e o HC-SR04 do sketch `balanca_kg/balanca_kg.ino` a conexao Wi-Fi/MQTT. A versao integrada foi compilada e testada com interfaces de hardware simuladas em 13/11/2026; ainda precisa ser gravada e validada com os sensores fisicos.

## Configuracao pronta

- Placa identificada: ESP32-D0WD-V3. No IDE, selecione **ESP32 Dev Module**.
- Nome e senha do Wi-Fi estao nas constantes `WIFI_SSID` e `WIFI_PASSWORD`, no arquivo local `secrets.h`, incluido pelo sketch. Ao clonar, copie `secrets.example.h` para `secrets.h` e preencha os valores.
- Broker: `w7017121.ala.us-east-1.emqxsl.com`, porta **8883**, MQTT com TLS.
- Usuario e senha MQTT tambem ficam em `secrets.h`. Esse arquivo nao e enviado ao GitHub.
- CA: DigiCert Global Root G2. A verificacao do certificado permanece ativa.
- Telemetria JSON: `ecobin/L01/telemetria`, em ciclo nominal de um segundo; a aquisicao e reconexoes podem aumentar esse intervalo.
- Presenca: `ecobin/L01/status`, com `online` retido e Last Will `offline`.
- Bibliotecas: **PubSubClient** e **HX711 Arduino Library 0.7.5 (bogde)**, ja instaladas neste computador. WiFi, WiFiClientSecure e Preferences acompanham o core ESP32.
- Monitor Serial: **115200 baud**, final de linha **Nova linha**. `t` faz a tara, `c 206` calibra com **206 gramas**, `f` mostra o fator e `help` mostra os comandos.

O JSON agora identifica `"simulado":false`, com massa em **kg**, distancia em **cm** e ocupacao em **%**. O formato e o topico continuam compativeis com o Node-RED da Azure e com o site. Nao e preciso alterar o fluxo para aceitar esses dados.

## Ligacoes e primeira utilizacao

| Componente | Terminal | GPIO ESP32 |
| --- | --- | --- |
| HX711 | DT | 19 |
| HX711 | SCK | 18 |
| HC-SR04 | TRIG | 4 |
| HC-SR04 | ECHO, depois do divisor resistivo | 5 |

Mantenha as ligacoes existentes: HC-SR04 em 5 V, ECHO por divisor de 1 kOhm em serie e 2 kOhm para GND, logica HX711 compativel com 3,3 V e GND comum. Consulte `docs/diagrama-eletrico-ecobin.md`.

1. Grave `ecoBin.ino` com **ESP32 Dev Module** e a porta USB correspondente.
2. Ligue/reinicie com a plataforma **vazia**. Assim como no codigo da balanca, o firmware avisa, espera tres segundos e realiza a tara automaticamente.
3. O fator salvo no namespace Preferences `ecobin` e reutilizado, em contagens/grama. Se nao houver calibracao ou voce alterar a montagem, coloque uma massa conhecida, aguarde estabilizar e envie, por exemplo, `c 206` para **206 g** ou `c 1000` para **1 kg**.
4. Confira a massa indicada, retire a referencia e confirme o retorno ao zero. Se necessario, plataforma vazia e comando `t`.
5. O firmware transmite as leituras validas automaticamente quando o MQTT conectar. Nao use `t` com residuos na plataforma: isso desconta a carga presente.

As constantes `VAZIO_CM = 50.0f` e `CHEIO_CM = 5.0f` definem a distancia do sensor ate o fundo vazio e ate o nivel considerado cheio. Ajuste-as para sua lixeira antes de gravar. A ocupacao e `(VAZIO_CM - distancia) / (VAZIO_CM - CHEIO_CM) * 100`, limitada a 0–100%.

Se faltar tara, calibracao, resposta do HX711 ou eco do ultrassonico, a leitura incompleta aparece no Serial e nao e publicada. Massa negativa fora da faixa de ruido e saturacao tambem bloqueiam aquela publicacao. Cada amostra do HX711 tem limite de espera; uma desconexao durante a media nao fica esperando indefinidamente. As leituras validas continuam aparecendo no Serial mesmo sem MQTT. O status MQTT `online` indica conexao ao broker; a atualidade dos sensores e indicada pela ultima telemetria no site.

Exemplo ilustrativo do JSON enviado (nao inserido artificialmente no banco):

```json
{"lixeira":"L01","setor":"Producao A","compartimento":"reciclavel","simulado":false,"uptime_ms":90000,"massa_kg":0.206,"distancia_cm":25.0,"ocupacao_pct":55.6,"coletar":false,"status":"normal"}
```

## Validacao da integracao em 13/11/2026

Compilacao ESP32 concluida com core 3.3.11, PubSubClient e HX711 0.7.5: **1.022.698 bytes de programa e 47.716 bytes de variaveis globais**. O teste abaixo executa o proprio sketch com interfaces de hardware simuladas, verifica calibracao positiva/negativa em gramas, recuperacao do fator, tara, comandos, conversao para kg, ocupacao e bloqueio de leituras invalidas. Os JSONs produzidos tambem passam pela funcao de validacao do fluxo Node-RED exportado e pelo verificador MQTT. Requer Python 3, g++ e Node.js.

```bash
python3 tools/testar_firmware.py
```

Nenhum dado desses testes e enviado ao EMQX, ao Telegram ou ao banco de producao. Nao foi feita gravacao USB nem calibracao fisica da versao integrada nesta etapa.

## Teste anterior com simulacao em 04/11/2026

Na versao anterior, que usava dados simulados, a compilacao foi concluida com Arduino ESP32 3.3.11 e PubSubClient instalado. Aquele firmware foi gravado por USB, com verificacao do hash da flash.

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

O script usa somente a biblioteca padrao do Python. Le o host e a CA do sketch e as credenciais de `secrets.h`, sem imprimir as senhas. Valida TLS e autenticacao e exige tres mensagens novas com `simulado:false`, ignorando mensagens retidas antigas. A placa precisa estar calibrada e ambos os sensores funcionando. Para verificar uma placa que ainda usa o firmware antigo, acrescente `--origem simulacao`.

Para o Node-RED ou MQTTX, configure o mesmo host, porta 8883, TLS ativo e as credenciais MQTT do sketch. Assine `ecobin/L01/telemetria`. O login do painel EMQX e diferente do usuario MQTT cadastrado em Authentication.

## Correcoes realizadas

O sketch anterior tinha um texto de exemplo no lugar do certificado e uma senha MQTT recusada pelo EMQX com codigo 4. Foram corrigidos a CA, a senha MQTT e os dados do Wi-Fi. As tentativas de Wi-Fi e NTP agora possuem limite de espera, e os clientes sao configurados antes da primeira tentativa para permitir recuperacao automatica.

A versao anterior foi preservada em `ecoBin.ino.bak`. Os outros sketches da pasta Arduino permanecem como estavam.

## Node-RED e site local

As etapas seguintes estao salvas nas subpastas deste projeto:

- `node-red/`: fluxo EMQX -> validacao -> site local e alertas Telegram. Consulte `node-red/README.md` para configurar o bot e o Chat ID.
- `site/`: painel local com API HTTP, historico SQLite e exportacao CSV. Abra **http://127.0.0.1:3000**. Consulte `site/README.md` para iniciar novamente.
- `cloud/`: implantacao na VM Ubuntu Azure com Docker Compose, HTTPS e Node-RED protegido. Consulte `cloud/README.md`.

O projeto foi publicado na VM Azure: **https://ecobin-scriptboys.northcentralus.cloudapp.azure.com/**. O caminho e ESP32 -> EMQX -> Node-RED -> API -> SQLite -> navegador. O Telegram reutiliza o bot Alerta Esp32. A versao integrada passa a produzir leituras dos sensores depois de gravada na placa; registros antigos de simulacao continuam identificados no historico. O editor Node-RED da VM e acessado por tunel SSH, conforme `cloud/README.md`.
