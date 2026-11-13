#include <Arduino.h>

// ESP32: HC-SR04 TRIG=GPIO4, ECHO=GPIO5; HX711 DT=GPIO19, SCK=GPIO18.
// ECHO deve passar pelo divisor resistivo antes do GPIO5.
// HX711 compativel com 3,3 V; GND comum entre ESP32 e os dois sensores.
// Teste local, sem Wi-Fi e sem bibliotecas adicionais.

constexpr uint8_t TRIG = 4;
constexpr uint8_t ECHO = 5;
constexpr uint8_t HX_DT = 19;
constexpr uint8_t HX_SCK = 18;

portMUX_TYPE hxMux = portMUX_INITIALIZER_UNLOCKED;
int32_t tara = 0;
bool temTara = false;
bool pedirTara = false;

bool lerHX711(int32_t &leitura) {
  const uint32_t inicio = millis();
  while (digitalRead(HX_DT) == HIGH) {
    if (millis() - inicio >= 600) return false;
    delay(1);
  }

  uint32_t dados = 0;
  // Impede que interrupcoes prolonguem o clock e desliguem o HX711.
  portENTER_CRITICAL(&hxMux);
  for (uint8_t i = 0; i < 24; i++) {
    digitalWrite(HX_SCK, HIGH);
    delayMicroseconds(1);
    dados = (dados << 1) | digitalRead(HX_DT);
    digitalWrite(HX_SCK, LOW);
    delayMicroseconds(1);
  }
  // Pulso 25: seleciona canal A, ganho 128, para a proxima leitura.
  digitalWrite(HX_SCK, HIGH);
  delayMicroseconds(1);
  digitalWrite(HX_SCK, LOW);
  portEXIT_CRITICAL(&hxMux);

  leitura = (dados & 0x800000UL)
      ? static_cast<int32_t>(dados) - 16777216L
      : static_cast<int32_t>(dados);
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  digitalWrite(TRIG, LOW);
  pinMode(ECHO, INPUT);
  pinMode(HX_SCK, OUTPUT);
  digitalWrite(HX_SCK, LOW);
  pinMode(HX_DT, INPUT_PULLUP);
  delay(1000);

  Serial.println("\nEcoBin - teste dos sensores");
  Serial.println("HC-SR04: TRIG=4, ECHO=5 | HX711: DT=19, SCK=18");
  Serial.println("Sem peso, envie t para fazer a tara.");
  Serial.println("HX711 em contagens: ainda precisa de calibracao para kg.");
}

void loop() {
  while (Serial.available()) {
    const char comando = Serial.read();
    if (comando == 't' || comando == 'T') pedirTara = true;
  }

  static uint32_t anterior = 0;
  if (millis() - anterior < 500) return;
  anterior = millis();

  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  const unsigned long duracao = pulseIn(ECHO, HIGH, 30000UL);

  Serial.print("HC-SR04: ");
  if (duracao == 0) {
    Serial.print("sem eco");
  } else {
    Serial.print(duracao * 0.0343f / 2.0f, 1);
    Serial.print(" cm");
  }

  int32_t leitura;
  Serial.print(" | HX711: ");
  if (!lerHX711(leitura)) {
    Serial.println("sem resposta (verifique alimentacao, DT e SCK)");
    return;
  }

  if (leitura == -8388608L || leitura == 8388607L) {
    Serial.print("SATURADO, bruto=");
    Serial.print(leitura);
    Serial.println(" (confira as ligacoes das celulas e a alimentacao)");
    return;
  }

  if (pedirTara) {
    tara = leitura;
    temTara = true;
    pedirTara = false;
    Serial.print("tara definida | ");
  }
  Serial.print("bruto=");
  Serial.print(leitura);
  if (temTara) {
    Serial.print(" | apos tara=");
    Serial.print(leitura - tara);
  }
  Serial.println();
}
