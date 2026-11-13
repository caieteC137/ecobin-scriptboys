# EcoBin — HX711 com o codigo fornecido pelo usuario

Abra `balanca_kg.ino` no Arduino IDE. O sketch ativo em `/home/caio/Arduino/sketch_sep4a/sketch_sep4a.ino` foi atualizado com o mesmo conteudo. Se o IDE estava aberto, reabra o arquivo para carregar a versao atual.

A pesagem agora usa **HX711 Arduino Library 0.7.5**, de Bogdan Necula (bogde), instalada em `/home/caio/Arduino/libraries/HX711_Arduino_Library`. Ela fornece `tare`, `get_value`, `get_units`, `set_scale` e `wait_ready_timeout`. Esta versao deriva do codigo colado pelo usuario, com leitura do HC-SR04 acrescentada. Usa tambem Preferences, incluido no pacote ESP32.

## Pinos

| Componente | Terminal | GPIO |
| --- | --- | --- |
| HC-SR04 | TRIG | 4 |
| HC-SR04 | ECHO, depois do divisor resistivo | 5 |
| HX711 | DT | 19 |
| HX711 | SCK | 18 |

O HC-SR04 usa 5 V. ECHO chega ao GPIO5 por 1 kOhm em serie, com 2 kOhm entre o GPIO5 e GND. A logica do HX711 deve ser compativel com 3,3 V; todos os GND sao interligados.

## Uso e calibracao

1. Grave o sketch e abra o Monitor Serial em **115200 baud**, com **Nova linha**.
2. Mantenha a plataforma vazia durante a inicializacao: a tara e feita automaticamente apos o aviso e uma espera de tres segundos. A coleta da tara usa 20 amostras.
3. Coloque uma massa conhecida e espere a plataforma estabilizar.
4. Envie `c 206` para uma massa real de **206 gramas**, `c 500` para **500 gramas** ou `c 1000` para **1 kg**.
5. Aguarde a confirmacao e confira outra massa conhecida, alem do retorno ao zero ao retirar a carga.

**O comando c recebe GRAMAS, conforme o codigo fornecido.** Diferentemente da implementacao anterior, `c 0.500` significa meio grama; nao use esse comando para calibrar com 500 g.

Comandos: `t` refaz a tara; `f` mostra o fator; `help` mostra a ajuda. A calibracao utiliza 20 amostras e salva o fator em contagens/grama no namespace Preferences `ecobin`, chaves `fator` e `calibrada`, conforme o codigo original. O antigo fator em contagens/kg do namespace `ecobin-hx` nao e reutilizado.

Se o HX711 nao estiver disponivel ao iniciar, o HC-SR04 e os comandos continuam ativos. Apos reconectar o HX711, deixe a plataforma vazia e envie `t`. O fator salvo e aplicado tambem nesse caso. O cabecalho inicial informa os pinos e as unidades para conferir a versao gravada.

A leitura usa a media de dez amostras da biblioteca. Conforme o codigo fornecido, valores com modulo menor que 2 g aparecem como zero. A exibicao em kg usa tres casas decimais; isso nao garante precisao de 1 g. O intervalo configurado e de 500 ms, mas a aquisicao de dez amostras pode levar mais tempo, conforme a taxa do modulo.

Exemplo ilustrativo de saida:

```text
ECOBIN | Massa: 0.206 kg | 206.0 g | Distancia: 17.2 cm
```

Sem calibracao, sao mostradas as contagens descontadas da tara. Ausencia de resposta e saturacao constante sao sinalizadas; massa de referencia invalida ou sinal insuficiente nao substituem a calibracao existente. O fator pode ser negativo e deve manter o sinal; nao se aplica valor absoluto ao peso.

A tara automatica desconta qualquer carga presente ao iniciar. Para medir a massa adicionada, inicie sempre com a plataforma vazia. Se alterar celulas, ligacoes ou montagem, refaca a calibracao.

## Validacao

Compilacao real concluida com Arduino CLI, placa `esp32:esp32:esp32`, core ESP32 3.3.11, HX711 Arduino Library 0.7.5 e Preferences 3.3.11: **293400 bytes de programa e 22180 bytes de variaveis globais**.

Um harness de computador com as interfaces Arduino/HX711/Preferences simuladas verificou tara automatica, fator positivo e negativo, calibracao em gramas, conversao de 206 g para 0.206 kg, recuperacao simulada do fator salvo, comandos invalidos, saturacao e desconexao. Um teste adicional reproduziu a perda da escala ao iniciar com o HX711 desconectado e confirmou a correcao apos reconectar e refazer a tara. Nao foi realizada gravacao na placa nem calibracao fisica nesta sessao.

Fonte da biblioteca: [bogde/HX711](https://github.com/bogde/HX711). Base do codigo de pesagem: anexo do usuario `Pasted text.txt`.
