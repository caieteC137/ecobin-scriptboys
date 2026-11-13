#include <Arduino.h>
#include <HX711.h>
#include <Preferences.h>
#include <math.h>
#include <stdlib.h>

// =======================================
// ECOBIN - SISTEMA DE PESAGEM
// ESP32 + HX711 + 2 CELULAS DE 3 FIOS
// =======================================

// Pinos
#define HX_DT   19
#define HX_SCK  18
#define TRIG     4
#define ECHO     5

// HC-SR04 em 5 V; ECHO chega ao GPIO5 pelo divisor de 1 kOhm / 2 kOhm.
// GND comum. Calibracao em GRAMAS: c 206 significa 206 g.

// Configuracoes
#define AMOSTRAS 10
#define INTERVALO 500

HX711 balanca;
Preferences memoria;

float fatorCalibracao = 1.0f;
bool calibrada = false;
bool temTara = false;
bool memoriaDisponivel = false;
const char *erroPesagem = "OK";

unsigned long ultimaLeitura = 0;

// =======================================
// VERIFICAR HX711
// =======================================

bool sensorDisponivel() {
  return balanca.wait_ready_timeout(1000, 1);
}

// =======================================
// TARA
// =======================================

void zerarBalanca() {

  if (!sensorDisponivel()) {
    Serial.println("ERRO: HX711 desconectado!");
    return;
  }

  Serial.println("Realizando tara...");

  balanca.tare(20);
  const long offset = balanca.get_offset();
  if (offset <= -8388608L || offset >= 8388607L) {
    temTara = false;
    Serial.println("ERRO: HX711 saturado. Confira as ligacoes das celulas.");
    return;
  }
  temTara = true;
  Serial.println("Tara concluida!");
}

// =======================================
// CALIBRACAO
// =======================================

void calibrar(float pesoConhecido) {

  if (!isfinite(pesoConhecido) || pesoConhecido <= 0) {
    Serial.println("Peso de referencia invalido!");
    return;
  }

  if (!sensorDisponivel()) {
    Serial.println("HX711 nao responde!");
    return;
  }

  if (!temTara) {
    Serial.println("Primeiro deixe a plataforma vazia e envie t.");
    return;
  }

  Serial.println("Calibrando...");
  Serial.println("Nao toque na plataforma.");

  delay(2000);

  if (!sensorDisponivel()) {
    Serial.println("HX711 nao responde!");
    return;
  }
  // Leitura descontando a tara, sem aplicar o fator anterior.
  double leitura = balanca.get_value(20);
  const double bruto = leitura + balanca.get_offset();
  if (bruto <= -8388608.0 || bruto >= 8388607.0) {
    Serial.println("ERRO: HX711 saturado. Confira as celulas antes de calibrar.");
    return;
  }

  if (fabs(leitura) < 100) {
    Serial.println("ERRO: Sinal insuficiente!");
    return;
  }

  const float novoFator = leitura / pesoConhecido;
  if (!isfinite(novoFator) || fabs(novoFator) < 0.000001f) {
    Serial.println("ERRO: Fator de calibracao invalido.");
    return;
  }
  fatorCalibracao = novoFator;

  balanca.set_scale(fatorCalibracao);

  // Salvar na memoria nao volatil
  const bool fatorSalvo = memoriaDisponivel &&
      memoria.putFloat("fator", fatorCalibracao) == sizeof(float);
  const bool salvo = fatorSalvo && memoria.putBool("calibrada", true) == 1;

  calibrada = true;

  Serial.println(salvo ? "Calibracao concluida e salva!"
                       : "Calibracao concluida; nao foi possivel salvar na memoria.");

  Serial.print("Fator: ");
  Serial.println(fatorCalibracao, 6);

  Serial.print("Peso de referencia: ");
  Serial.print(pesoConhecido, 1);
  Serial.println(" g");
}

// =======================================
// LEITURA DO PESO
// =======================================

float lerPeso() {

  if (!sensorDisponivel()) {
    erroPesagem = "HX711 SEM RESPOSTA";
    return NAN;
  }
  if (!temTara || !calibrada) return NAN;

  float peso = balanca.get_units(AMOSTRAS);
  const double bruto = static_cast<double>(peso) * fatorCalibracao + balanca.get_offset();
  if (!isfinite(peso) || bruto <= -8388607.0 || bruto >= 8388606.0) {
    erroPesagem = "LEITURA INVALIDA OU SATURADA";
    return NAN;
  }
  erroPesagem = "OK";

  // Eliminar pequeno ruido proximo de zero
  if (fabs(peso) < 2.0f) {
    peso = 0;
  }

  return peso;
}

// =======================================
// COMANDOS SERIAL
// =======================================

void verificarComandos() {

  if (!Serial.available()) {
    return;
  }

  String comando = Serial.readStringUntil('\n');
  comando.trim();
  if (comando.length() == 0) return;

  // Tara
  if (comando.equalsIgnoreCase("t")) {
    zerarBalanca();
  }

  // Calibracao: c 206
  else if (comando.startsWith("c ") ||
           comando.startsWith("C ")) {

    String argumento = comando.substring(2);
    argumento.trim();
    argumento.replace(',', '.');
    const char *inicio = argumento.c_str();
    char *fim;
    float peso = strtof(inicio, &fim);
    if (fim == inicio || *fim != '\0') {
      Serial.println("Valor invalido. Exemplo: c 206 (massa em gramas).");
      return;
    }
    calibrar(peso);
  }

  // Exibir fator
  else if (comando.equalsIgnoreCase("f")) {

    Serial.print("Fator de calibracao: ");
    Serial.println(fatorCalibracao, 6);
  }

  // Ajuda
  else if (comando.equalsIgnoreCase("help")) {

    Serial.println("=== COMANDOS ===");
    Serial.println("t     - Realizar tara");
    Serial.println("c 206 - Calibrar com 206 g");
    Serial.println("f     - Mostrar fator");
    Serial.println("help  - Mostrar comandos");
  } else {
    Serial.println("Comando invalido. Use t, c 206, f ou help.");
  }
}

// =======================================
// SETUP
// =======================================

void setup() {

  Serial.begin(115200);
  Serial.setTimeout(100);

  delay(1000);

  Serial.println();
  Serial.println("===========================");
  Serial.println("      ECOBIN - HX711       ");
  Serial.println("===========================");
  Serial.println("HX711: DT=19, SCK=18 | HC-SR04: TRIG=4, ECHO=5");
  Serial.println("Monitor Serial: 115200 baud, Nova linha. Calibracao em gramas.");

  pinMode(TRIG, OUTPUT);
  digitalWrite(TRIG, LOW);
  pinMode(ECHO, INPUT);

  // Mesmo namespace e unidades do codigo fornecido pelo usuario.
  memoriaDisponivel = memoria.begin("ecobin", false);

  // Recuperar calibracao
  if (memoriaDisponivel) {
    calibrada = memoria.getBool("calibrada", false);
    fatorCalibracao = memoria.getFloat("fator", 1.0f);
  }

  if (!isfinite(fatorCalibracao) ||
      fabs(fatorCalibracao) < 0.000001f) {
    calibrada = false;
    fatorCalibracao = 1.0f;
  }

  // Inicializar HX711
  balanca.begin(HX_DT, HX_SCK);
  // Aplicar o fator mesmo se o HX711 estiver temporariamente desconectado.
  balanca.set_scale(fatorCalibracao);

  if (calibrada) {
    Serial.println("Calibracao recuperada!");
  } else {
    Serial.println("Balanca ainda nao calibrada.");
  }

  if (sensorDisponivel()) {
    Serial.println("HX711 conectado! Mantenha a plataforma vazia.");
    delay(3000);
    zerarBalanca();
  } else {
    Serial.println("HX711 nao encontrado. Confira as conexoes e envie t apos reconectar.");
  }

  Serial.println();
  Serial.println("Comandos:");
  Serial.println("t     = Tara");
  Serial.println("c 206 = Calibrar com 206 g");
  Serial.println("f     = Exibir fator");
  Serial.println("help  = Ajuda");
}

// =======================================
// HC-SR04 E LOOP
// =======================================

void exibirDistancia() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  const unsigned long duracao = pulseIn(ECHO, HIGH, 30000UL);
  Serial.print(" | Distancia: ");
  if (duracao == 0) Serial.println("SEM ECO");
  else {
    Serial.print(duracao * 0.0343f / 2.0f, 1);
    Serial.println(" cm");
  }
}

void loop() {
  verificarComandos();
  if (millis() - ultimaLeitura < INTERVALO) return;
  ultimaLeitura = millis();

  Serial.print("ECOBIN | ");
  if (!sensorDisponivel()) {
    Serial.print("Massa: -- kg | HX711 SEM RESPOSTA");
  } else if (!temTara) {
    Serial.print("Massa: -- kg | SEM TARA: plataforma vazia, envie t");
  } else if (!calibrada) {
    const double leitura = balanca.get_value(AMOSTRAS);
    const double bruto = leitura + balanca.get_offset();
    if (bruto <= -8388608.0 || bruto >= 8388607.0) {
      Serial.print("Massa: -- kg | HX711 SATURADO");
    } else {
      Serial.print("Sinal: ");
      Serial.print(leitura, 0);
      Serial.print(" contagens | NAO CALIBRADA: envie c <gramas>");
    }
  } else {
    const float pesoGramas = lerPeso();
    if (!isfinite(pesoGramas)) {
      Serial.print("Massa: -- kg | ");
      Serial.print(erroPesagem);
    } else {
      Serial.print("Massa: ");
      Serial.print(pesoGramas / 1000.0f, 3);
      Serial.print(" kg | ");
      Serial.print(pesoGramas, 1);
      Serial.print(" g");
    }
  }
  exibirDistancia();
}
