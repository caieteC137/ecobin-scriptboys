# Fluxo EcoBin — EMQX, site local e Telegram

O fluxo ja foi instalado no Node-RED local, preservando as abas existentes:

**http://127.0.0.1:1880/#flow/4df8e47ac5bf8834**

## Caminho dos dados

```text
ESP32 -> EMQX (TLS/8883) -> Node-RED -> validacao -> API local -> SQLite -> site
                                           |
                                           +-> regra de coleta -> Telegram
```

- Entrada MQTT: `ecobin/+/telemetria`.
- Broker e credenciais: mesmos do sketch `ecoBin.ino`; a conexao instalada ja esta configurada.
- O certificado do servidor e verificado no TLS.
- Site: `http://127.0.0.1:3000`.
- Estado da integracao: `http://127.0.0.1:1880/ecobin/estado`.
- O no `Resultado da gravacao` mostra o ID salvo; `Erros EcoBin` recebe falhas resumidas.

## Configurar o Telegram (bot antigo ou novo)

1. Pode aproveitar o bot antigo **Alerta Esp32**. Nesse caso, selecione essa mesma configuracao no campo Bot de todos os nos Telegram do EcoBin; nao copie o token para outra configuracao. Para um bot separado, use o bot oficial **@BotFather**, envie `/newbot` e escolha nome e username.
2. No Node-RED, abra a aba **EcoBin | EMQX + Site + Telegram**. Atualmente ela reutiliza **Alerta Esp32**, com o token que ja estava salvo.
3. De dois cliques em **Telegram · bot EcoBin (Token)** para conferir o campo Bot. Os nos **Receber /start do Telegram** e **Identificar bot configurado** devem apontar para a mesma configuracao.
4. Para um bot novo, adicione apenas uma configuracao, cole o token nela e selecione essa configuracao nos tres nos. Nao precisa colocar o token no chat com o assistente nem no codigo do site.
5. Mantenha Update Mode em **polling**, compartilhando uma unica configuracao entre os nos. Clique **Update**, **Done** e **Deploy**. **Verificar bot (getMe)** mostra o username correto no Debug e no status do no, sem expor o token.
6. Abra uma conversa com o bot no Telegram e envie `/start` **depois** de implantar o receptor. Agora o fluxo responde com **Seu Chat ID**. Para obter o ID de um grupo, adicione o bot ao grupo e envie `/start` no grupo.
7. O Chat ID tambem aparece no Debug **SEU CHAT ID (copiar para no laranja)**. O botao quadrado a esquerda de **Obter Chat ID (manual)** lista novamente os chats ja recebidos. Esses nos ficam na parte inferior do fluxo, abaixo do comentario CONFIGURAR TELEGRAM. Use **Zoom to fit** no rodape para mostrar o fluxo inteiro.
8. Copie o `chatId` do destino desejado. Chat de grupo normalmente usa um numero negativo.
9. Abra **PREENCHER: Chat ID do Telegram** e substitua o valor de texto vazio da regra `msg.telegramChatId` pelo Chat ID. Mantenha o tipo **string**. Clique **Done** e **Deploy**.
10. Clique em **Testar Telegram (manual)**. O bot deve enviar uma mensagem de teste; o Debug **Telegram entregue** confirma a resposta da API.

O receptor processa somente `/start` para esse cadastro e responde ao proprio chat com o numero do Chat ID. Ele nao altera automaticamente o destino dos alertas. O botao manual le os chats guardados pelo receptor; nao executa uma segunda consulta `getUpdates` que concorreria com o polling do bot antigo.

O no **Verificar bot (getMe)** confirma o token e mostra o nome publico do bot sem exibir o token. Para verificar pela linha de comando:

```bash
python3 /home/caio/Arduino/ecoBin/node-red/verificar-telegram.py
python3 /home/caio/Arduino/ecoBin/node-red/verificar-telegram.py --require-start
```

Se o fluxo for atualizado pela API enquanto o editor estiver aberto, recarregue a pagina antes do proximo Deploy para nao sobrescrever a versao nova com uma copia antiga do editor.

### Correcao do cadastro de Chat ID

O botao de consulta havia desaparecido do fluxo ativo depois de um Deploy de uma versao anterior. Ele foi restaurado e o editor foi atualizado. A versao anterior tambem nao tinha um receptor para responder ao `/start`. Agora ha um receptor compartilhado com o bot antigo e testes para a resposta e a consulta dos Chat IDs. O numero do chat nao e escolhido automaticamente como destino dos alertas.

## Alertas

- Alerta ao atingir **80% de ocupacao ou 8 kg**.
- Enquanto a leitura permanecer alta, um alerta entregue nao se repete a cada segundo.
- Um novo ciclo e liberado quando a ocupacao fica em **ate 70% e a massa em ate 7 kg**.
- Falhas de envio nao sao marcadas como entrega; o fluxo permite nova tentativa apos 60 segundos. O no Telegram tambem possui sua propria recuperacao de falhas de rede.
- O texto informa quando os dados sao simulados.
- O controle de notificacoes usa o contexto em memoria do Node-RED atual. Reiniciar o Node-RED pode gerar um novo alerta para uma lixeira que continue acima do limite.
- Para testar um ciclo novo na placa, envie `t` pelo Monitor Serial em 115200 baud; a simulacao volta a encher e atinge o limite novamente.

O envio real depende de token e Chat ID validos, conversa iniciada com `/start` e acesso a internet. Na configuracao atual, o bot antigo Alerta Esp32 foi reutilizado e o Chat ID informado pelo usuario ja foi salvo. Foram confirmados `getMe`, recebimento de `/start`, entrega da resposta com Chat ID e entrega de uma nova mensagem de teste. O fluxo de alerta fica pronto para as proximas leituras que atingirem o limite.

## Arquivos

- `ecobin-flow.json`: exportacao importavel pelo menu **Import** do Node-RED. Nao inclui senhas ou token.
- `ecobin-flow-api.json`: representacao usada pelo instalador local.
- `gerar-fluxo.mjs`: gera as duas exportacoes a partir das funcoes em `functions/`.
- `instalar-fluxo.py`: adiciona a aba pela API, lendo as credenciais MQTT do sketch em memoria. Recusa duplicar uma instalacao existente.
- `teste-fluxo.mjs`: testes das funcoes exportadas, sem acesso ao Telegram.

Como o fluxo ja esta instalado, **nao importe outra copia** na mesma instancia: duas copias podem gerar alertas duplicados. Edite os campos na aba existente.

Se importar em outra instalacao, preencha tambem usuario e senha no broker MQTT. Mantenha a verificacao do certificado ativada.
