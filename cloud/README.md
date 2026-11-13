# EcoBin na VM Ubuntu Azure

O ESP32 publica no EMQX por MQTT/TLS. O Node-RED da VM assina o topico, envia os alertas ao Telegram e grava as leituras na API do site pela rede privada Docker. Caddy publica somente o painel e suas consultas com HTTPS.

Endereco configurado: **https://ecobin-scriptboys.northcentralus.cloudapp.azure.com**.

O nome DNS da Azure e o certificado nao exigem comprar um dominio. A VM, o IP publico e demais recursos da conta seguem a cobranca normal da Azure.

## Servicos e dados

- `site`: Node.js 24, SQLite, painel, historico e CSV. Nenhuma porta publicada diretamente.
- `node-red`: editor com usuario e senha, publicado somente em `127.0.0.1:1880` da VM.
- `caddy`: portas publicas TCP 80 e 443; certificado HTTPS e renovacao automatica.
- Volumes `ecobin_site_data`, `ecobin_node_red_data`, `ecobin_caddy_data` e `ecobin_caddy_config` persistem dados e certificados entre reinicializacoes.

Todos usam `restart: unless-stopped`; o Docker deve iniciar com o Ubuntu. O historico preserva sete dias de leituras e a ultima leitura de cada ponto. A indicacao "simulado" vem do firmware: hospedar na nuvem nao transforma simulacao em leitura fisica.

## Configuracao inicial em outra VM

1. Instale Docker e Docker Compose. Copie o projeto para `~/ecobin`.
2. Configure um rotulo DNS no IP publico Azure e confirme que resolve para o IP da VM.
3. No grupo de seguranca de rede da Azure, permita entrada TCP 80 e 443. Mantenha SSH conforme sua regra existente. Nao publique 1880 ou 3000.
4. Copie `cloud/.env.example` para `cloud/.env`, preencha os valores e aplique `chmod 600 cloud/.env`. Mantenha esse arquivo fora do Git.
5. Defina um segredo aleatorio para ingestao e outro para criptografia das credenciais. Gere o hash bcrypt da senha do editor com `node-red admin hash-pw`; coloque o hash entre aspas simples no `.env`.
6. Use `TELEGRAM_UPDATE_MODE=polling` somente quando a instancia anterior do mesmo bot estiver desligada ou com polling desativado. Duas instancias em polling causam conflito no Telegram.

```bash
cd ~/ecobin/cloud
sudo docker compose config -q
sudo docker compose up -d --build
sudo docker compose ps
```

Os arquivos `nodered/flows_cred.json` versionados contem somente referencias `${VARIAVEL}`. As senhas reais ficam no ambiente privado. Na primeira execucao, `start.sh` copia os fluxos para `/data/ecobin-flows.json` e `/data/ecobin-flows_cred.json`; os proximos inicios preservam alteracoes feitas no editor.

## Abrir o editor Node-RED

No seu computador, mantenha o tunel aberto:

```bash
ssh -i ~/.ssh/vm-openbot-finance_key.pem -N -L 1881:127.0.0.1:1880 azureuser@20.98.42.169
```

Abra **http://127.0.0.1:1881**. Usuario inicial: `admin`. A senha gerada nesta instalacao fica no arquivo privado `cloud/admin-password.txt` no computador e na VM. Para consulta pela sua conexao SSH:

```bash
ssh -i ~/.ssh/vm-openbot-finance_key.pem azureuser@20.98.42.169 'cat ~/ecobin/cloud/admin-password.txt'
```

O botao `Testar Telegram (manual)` envia uma mensagem real ao Chat ID configurado. O fluxo tambem responde `/start` no Telegram. A rota `http://127.0.0.1:1881/ecobin/estado`, pelo tunel, mostra MQTT, ultima leitura e ultima entrega sem revelar tokens.

## Atualizar o codigo

No computador com este repositorio Git, execute:

```bash
bash cloud/deploy.sh
```

O script envia apenas arquivos versionados e reconstrui os servicos. Preserva o `.env` privado, o banco e os fluxos editados no volume do Node-RED. Mudancas no arquivo-semente `cloud/nodered/flows.json` devem ser importadas no editor; a atualizacao do container nao substitui automaticamente o fluxo ativo.

Para gerar novamente a versao cloud a partir do fluxo local exportado:

```bash
node cloud/gerar-fluxo-cloud.mjs
```

Depois de editar o `.env` na VM, execute `sudo docker compose up -d` em `~/ecobin/cloud` para recriar os containers afetados. Nao publique o arquivo nem o token no GitHub.

## Verificacao e manutencao

```bash
cd ~/ecobin/cloud
sudo docker compose ps
sudo docker compose logs --tail=50 site caddy
curl -fsS https://ecobin-scriptboys.northcentralus.cloudapp.azure.com/api/health
```

O painel publico permite consultas; `POST /api/telemetria` nao e publicado pelo proxy. Dentro da rede Docker, a ingestao exige um token Bearer. O editor Node-RED exige senha e fica restrito ao tunel SSH.

Para parar sem apagar dados: `sudo docker compose stop`. Para iniciar: `sudo docker compose up -d`. Evite `docker compose down -v`, pois essa opcao apaga os volumes.

Antes de uma alteracao importante, faca backup consistente do SQLite e do volume do Node-RED. Proteja o backup do Node-RED e o `.env`, pois podem conter credenciais. O `.gitignore` exclui dados locais, tokens, chaves SSH e arquivos temporarios de apresentacao.

Se HTTPS nao abrir, confira DNS, regras de entrada TCP 80/443 na Azure e logs do Caddy. Se o painel abrir sem leituras recentes, confira a energia/Wi-Fi do ESP32 e o estado MQTT pelo tunel. Nao e necessario deixar o computador pessoal ligado para o site e o Node-RED da VM funcionarem.

## Validacao da implantacao em 12/11/2026

- Painel publico, API de consulta, historico e CSV responderam HTTP 200 pelo endereco HTTPS acima. Certificado publico validado com TLS 1.3.
- Conexao SSE publica respondeu HTTP 200 e evento `conectado`. A interface foi aberta e conferida no navegador.
- `POST /api/telemetria`, `/flows`, `/ecobin/estado` e `/.env` responderam 404 pelo endereco publico.
- API administrativa do Node-RED respondeu 401 sem login. Login pelo tunel SSH foi validado.
- Node-RED conectado ao EMQX com TLS e cliente `ecobin-nodered-azure`.
- Bot Telegram identificado e mensagem de teste entregue pelo fluxo da VM. O polling foi transferido para a nuvem; a configuracao local do mesmo bot ficou em `none` para evitar conflito.
- Banco local copiado com 1.034 registros, preservados depois de recriar o container do site. Os volumes permanecem na VM.
- Seis testes do site e seis testes do fluxo passaram; firmware ESP32 compilado com sucesso apos separar as credenciais.
- O teste completo com uma nova publicacao do ESP32 ficou para depois, conforme combinado. Nao foram inseridas leituras artificiais para apresentar a placa como online. A resposta `/start` na instancia cloud ainda depende de uma nova mensagem enviada pelo usuario.
