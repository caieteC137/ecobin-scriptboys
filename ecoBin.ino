
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include <HX711.h>
#include <Preferences.h>
#include <math.h>
#include <stdlib.h>
#include "secrets.h"

// ============================================
// ECOBIN - CONFIGURACOES
// ============================================

// Wi-Fi e credenciais MQTT: secrets.h (arquivo local).

// EMQX Cloud Serverless
const char* MQTT_HOST = "w7017121.ala.us-east-1.emqxsl.com";
constexpr uint16_t MQTT_PORT = 8883;

// Topico para o Node-RED
const char* MQTT_TOPIC = "ecobin/L01/telemetria";
const char* MQTT_STATUS_TOPIC = "ecobin/L01/status";

// DigiCert Global Root G2, validado contra este endpoint EMQX.
const char* ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
)EOF";

// ============================================
// ECOBIN - SENSORES REAIS
// ============================================

constexpr uint8_t HX_DT = 19;
constexpr uint8_t HX_SCK = 18;
constexpr uint8_t TRIG = 4;
constexpr uint8_t ECHO = 5;
// HC-SR04: ECHO passa pelo divisor resistivo antes do GPIO5. GND comum.
// Ajuste estas distancias a montagem fisica da lixeira.
constexpr float VAZIO_CM = 50.0f;
constexpr float CHEIO_CM = 5.0f;
static_assert(VAZIO_CM > CHEIO_CM && CHEIO_CM >= 0, "Distancias da lixeira invalidas");
constexpr float LIMITE_KG = 8.0f;
constexpr float LIMITE_PCT = 80.0f;
constexpr uint8_t AMOSTRAS_PESO = 10;
constexpr uint8_t AMOSTRAS_CALIBRACAO = 20;
constexpr unsigned long ESPERA_HX_MS = 250;
constexpr unsigned long INTERVALO_MS = 1000;
constexpr unsigned long RECONEXAO_MS = 5000;

HX711 balanca;
Preferences memoria;
float fatorCalibracao = 1.0f;  // contagens por GRAMA, igual a balanca_kg.ino
bool calibrada = false;
bool temTara = false;
bool memoriaDisponivel = false;
const char* erroPesagem = "OK";

unsigned long ultimaLeitura = 0;
unsigned long ultimaTentativaMQTT = 0;
unsigned long ultimaTentativaWiFi = 0;
unsigned long ultimaTentativaHorario = 0;

WiFiClientSecure wifiSecure;
PubSubClient mqtt(wifiSecure);

// A biblioteca read_average espera indefinidamente se o modulo parar no meio.
// Confira disponibilidade em cada amostra e aborte a media inteira em caso de falha.
bool lerMediaHX(uint8_t amostras, double &media) {
  double soma = 0;
  for (uint8_t i = 0; i < amostras; ++i) {
    if (mqtt.connected()) mqtt.loop();
    if (!balanca.wait_ready_timeout(ESPERA_HX_MS, 1)) {
      erroPesagem = "HX711 SEM RESPOSTA";
      return false;
    }
    const long bruto = balanca.read();
    if (bruto <= -8388607L || bruto >= 8388606L) {
      erroPesagem = "HX711 SATURADO: confira as ligacoes das celulas";
      return false;
    }
    soma += bruto;
  }
  media = soma / amostras;
  erroPesagem = "OK";
  return true;
}

void zerarBalanca() {
  temTara = false;
  Serial.println("[Balanca] Realizando tara. Plataforma deve estar vazia.");
  double media;
  if (!lerMediaHX(AMOSTRAS_CALIBRACAO, media)) {
    Serial.println(erroPesagem);
    return;
  }
  balanca.set_offset(lround(media));
  temTara = true;
  Serial.println("[Balanca] Tara concluida!");
}

void calibrar(float pesoConhecidoGramas) {
  if (!isfinite(pesoConhecidoGramas) || pesoConhecidoGramas <= 0) {
    Serial.println("[Balanca] Referencia invalida. Use c 206 para 206 gramas.");
    return;
  }
  if (!temTara) {
    Serial.println("[Balanca] Primeiro, plataforma vazia e comando t.");
    return;
  }
  Serial.println("[Balanca] Calibrando em gramas. Nao toque na plataforma.");
  const unsigned long inicio = millis();
  while (millis() - inicio < 2000) {
    if (mqtt.connected()) mqtt.loop();
    delay(5);
  }
  double media;
  if (!lerMediaHX(AMOSTRAS_CALIBRACAO, media)) {
    Serial.println(erroPesagem);
    return;
  }
  const double sinal = media - balanca.get_offset();
  if (fabs(sinal) < 100) {
    Serial.println("[Balanca] Sinal insuficiente. Confira a massa de referencia.");
    return;
  }
  const float novoFator = sinal / pesoConhecidoGramas;
  if (!isfinite(novoFator) || fabs(novoFator) < 0.000001f) {
    Serial.println("[Balanca] Fator invalido; calibracao anterior preservada.");
    return;
  }
  fatorCalibracao = novoFator;  // O sinal negativo e permitido; nao use abs().
  balanca.set_scale(fatorCalibracao);
  calibrada = true;
  const bool fatorSalvo = memoriaDisponivel &&
      memoria.putFloat("fator", fatorCalibracao) == sizeof(float);
  const bool salvo = fatorSalvo && memoria.putBool("calibrada", true) == 1;
  Serial.println(salvo ? "[Balanca] Calibracao concluida e salva!"
                       : "[Balanca] Calibrada somente nesta sessao; falha ao salvar.");
  Serial.printf("[Balanca] Fator: %.6f contagens/g | Referencia: %.1f g\n",
                fatorCalibracao, pesoConhecidoGramas);
}

float lerPesoGramas() {
  if (!temTara) { erroPesagem = "SEM TARA: plataforma vazia, envie t"; return NAN; }
  if (!calibrada) { erroPesagem = "NAO CALIBRADA: envie c <gramas>"; return NAN; }
  double media;
  if (!lerMediaHX(AMOSTRAS_PESO, media)) return NAN;
  float gramas = (media - balanca.get_offset()) / fatorCalibracao;
  if (!isfinite(gramas)) { erroPesagem = "MASSA INVALIDA"; return NAN; }
  if (fabs(gramas) < 2.0f) gramas = 0;
  // A API aceita massa nao negativa. Nao transforme erro de tara em peso positivo.
  if (gramas < 0 || gramas > 10000000.0f) {
    erroPesagem = "MASSA FORA DA FAIXA: confira tara e calibracao";
    return NAN;
  }
  erroPesagem = "OK";
  return gramas;
}

float lerDistanciaCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  const unsigned long duracao = pulseIn(ECHO, HIGH, 30000UL);
  if (duracao == 0) return NAN;
  return duracao * 0.0343f / 2.0f;
}

void verificarComandos() {
  if (!Serial.available()) return;
  String comando = Serial.readStringUntil('\n');
  comando.trim();
  if (comando.length() == 0) return;
  if (comando.equalsIgnoreCase("t")) zerarBalanca();
  else if (comando.startsWith("c ") || comando.startsWith("C ")) {
    String argumento = comando.substring(2);
    argumento.trim();
    argumento.replace(',', '.');
    const char* inicio = argumento.c_str();
    char* fim;
    const float gramas = strtof(inicio, &fim);
    if (fim == inicio || *fim != '\0') Serial.println("Valor invalido. Exemplo: c 206 (gramas).");
    else calibrar(gramas);
  } else if (comando.equalsIgnoreCase("f")) {
    Serial.printf("Fator: %.6f contagens/g | Calibrada: %s | Tara: %s\n",
                  fatorCalibracao, calibrada ? "sim" : "nao", temTara ? "sim" : "nao");
  } else {
    Serial.println("Comandos: t = tara; c 206 = calibrar com 206 g; f = fator; help = ajuda.");
  }
}

void iniciarSensores() {
  pinMode(TRIG, OUTPUT);
  digitalWrite(TRIG, LOW);
  pinMode(ECHO, INPUT);
  memoriaDisponivel = memoria.begin("ecobin", false);
  if (memoriaDisponivel) {
    calibrada = memoria.getBool("calibrada", false);
    fatorCalibracao = memoria.getFloat("fator", 1.0f);
  }
  if (!isfinite(fatorCalibracao) || fabs(fatorCalibracao) < 0.000001f) {
    calibrada = false;
    fatorCalibracao = 1.0f;
  }
  balanca.begin(HX_DT, HX_SCK);
  balanca.set_scale(fatorCalibracao);
  Serial.println("HX711: DT=19, SCK=18 | HC-SR04: TRIG=4, ECHO=5");
  Serial.println(calibrada ? "[Balanca] Calibracao recuperada (gramas)."
                          : "[Balanca] Calibracao necessaria: t e depois c <gramas>.");
  Serial.println("[Balanca] Tara automatica em 3 s. Mantenha a plataforma vazia.");
  delay(3000);
  zerarBalanca();
}

// ============================================
// CONEXAO WI-FI
// ============================================

bool conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  // Cancele uma tentativa anterior antes de reconfigurar o driver.
  WiFi.disconnect(false, false);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Conectando");

  const unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  ultimaTentativaWiFi = millis();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[WiFi] Falhou (estado %d). Confira rede 2,4 GHz e senha. Nova tentativa em 15 s.\n", WiFi.status());
    return false;
  }
  Serial.println("[WiFi] Conectado!");
  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

// ============================================
// SINCRONIZACAO DE HORARIO PARA TLS
// ============================================

bool sincronizarHorario() {
  if (time(nullptr) >= 1700000000) return true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  Serial.print("[TLS] Sincronizando horario");

  time_t agora = time(nullptr);

  const unsigned long inicio = millis();
  while (agora < 1700000000 && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
    agora = time(nullptr);
  }

  Serial.println();
  ultimaTentativaHorario = millis();
  if (agora < 1700000000) {
    Serial.println("[TLS] NTP indisponivel. Tentarei novamente em 15 s.");
    return false;
  }
  Serial.println("[TLS] Horario sincronizado!");
  return true;
}

// ============================================
// CONEXAO MQTT
// ============================================


void receberMQTT(char* topico, byte* payload, unsigned int tamanho) {
  // Receber a propria publicacao confirma a passagem pelo broker e a permissao do topico.
  if (strcmp(topico, MQTT_TOPIC) == 0) {
    Serial.printf("[MQTT] Confirmacao do broker: telemetria recebida (%u bytes).\n", tamanho);
  }
}

void conectarMQTT() {
  if (mqtt.connected() || time(nullptr) < 1700000000) return;
  ultimaTentativaMQTT = millis();

  Serial.println("\n===== DIAGNOSTICO MQTT =====");

  // 1. Verificar Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ERRO] Wi-Fi desconectado");
    return;
  }

  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.localIP());

  // 2. Verificar DNS
  IPAddress brokerIP;

  if (!WiFi.hostByName(MQTT_HOST, brokerIP)) {
    Serial.println("[ERRO] Falha ao resolver DNS");
    return;
  }

  Serial.print("[DNS] Broker IP: ");
  Serial.println(brokerIP);

  // Use o hostname, e nao o IP: o EMQX Serverless precisa de SNI no TLS.
  String clientId = "EcoBin-L01-" + WiFi.macAddress();
  clientId.replace(":", "");

  Serial.println("[MQTT] Iniciando conexao TLS...");

  bool conectado = mqtt.connect(
    clientId.c_str(),
    MQTT_USER,
    MQTT_PASSWORD,
    MQTT_STATUS_TOPIC, 1, true, "offline"
  );

  if (conectado) {
    Serial.println("[MQTT] CONECTADO!");
    if (!mqtt.subscribe(MQTT_TOPIC, 0)) {
      Serial.println("[MQTT] Falha ao solicitar assinatura da telemetria.");
    }
    if (!mqtt.publish(MQTT_STATUS_TOPIC, "online", true)) {
      Serial.println("[MQTT] Falha ao enviar status online.");
    }
  } else {
    Serial.print("[MQTT] Falha. Codigo: ");
    Serial.println(mqtt.state());
    if (mqtt.state() == 4 || mqtt.state() == 5) {
      Serial.println("[MQTT] Confira usuario/senha em Authentication no EMQX (nao e o login do painel).");
    }

    // Diagnostico do WiFiClientSecure
    char erroTLS[256] = {0};
    int codigoTLS = wifiSecure.lastError(
      erroTLS, sizeof(erroTLS)
    );

    Serial.print("[TLS] Codigo: ");
    Serial.println(codigoTLS);

    Serial.print("[TLS] Detalhe: ");
    Serial.println(erroTLS);
  }

  Serial.println("============================");
}

// ============================================
// PUBLICACAO DOS DADOS
// ============================================

void publicarTelemetria() {
  const float pesoGramas = lerPesoGramas();
  const float distanciaCm = lerDistanciaCm();
  if (!isfinite(pesoGramas)) Serial.printf("[Balanca] %s\n", erroPesagem);
  else Serial.printf("[Balanca] %.3f kg | %.1f g\n", pesoGramas / 1000.0f, pesoGramas);
  if (!isfinite(distanciaCm)) Serial.println("[HC-SR04] SEM ECO: confira alimentacao e ligacoes.");
  else Serial.printf("[HC-SR04] %.1f cm\n", distanciaCm);
  if (!isfinite(pesoGramas) || !isfinite(distanciaCm)) {
    Serial.println("[EcoBin] Leitura incompleta; telemetria nao publicada.");
    return;
  }
  const float massaKg = pesoGramas / 1000.0f;
  const float ocupacaoPct = constrain(
      (VAZIO_CM - distanciaCm) * 100.0f / (VAZIO_CM - CHEIO_CM), 0.0f, 100.0f);

  bool coletar =
      massaKg >= LIMITE_KG ||
      ocupacaoPct >= LIMITE_PCT;

  const char* status =
      coletar ? "coletar" :
      ocupacaoPct >= 70.0f ? "acompanhar" :
      "normal";

  // Mesmo contrato do Node-RED/site; leituras reais em kg e cm.
  char payload[384];

  int tamanho = snprintf(
      payload,
      sizeof(payload),
      "{"
      "\"lixeira\":\"L01\","
      "\"setor\":\"Producao A\","
      "\"compartimento\":\"reciclavel\","
      "\"simulado\":false,"
      "\"uptime_ms\":%lu,"
      "\"massa_kg\":%.3f,"
      "\"distancia_cm\":%.1f,"
      "\"ocupacao_pct\":%.1f,"
      "\"coletar\":%s,"
      "\"status\":\"%s\""
      "}",
      millis(),
      massaKg,
      distanciaCm,
      ocupacaoPct,
      coletar ? "true" : "false",
      status
  );

  if (tamanho < 0 || static_cast<size_t>(tamanho) >= sizeof(payload)) {
    Serial.println("[EcoBin] Erro ao montar JSON.");
    return;
  }

  // Mostra os dados localmente
  Serial.println(payload);

  // Envia para o broker MQTT
  if (mqtt.connected()) {
    bool enviado = mqtt.publish(
        MQTT_TOPIC,
        payload
    );

    if (enviado) {
      Serial.println("[MQTT] Telemetria enviada; aguardando retorno pelo broker.");
    } else {
      Serial.println("[MQTT] Falha ao publicar.");
    }
  } else {
    Serial.println("[MQTT] Sem conexao. Dado nao enviado.");
  }
}

// ============================================
// SETUP
// ============================================

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(100);

  Serial.println();
  Serial.println("==========================");
  Serial.println(" EcoBin | MQTT EMQX Cloud ");
  Serial.println("==========================");
  Serial.println("Sensores reais | t = tara | c 206 = calibrar com 206 g | f = fator");
  iniciarSensores();

  // Configure os clientes antes de tentar a rede, para permitir recuperacao de falhas.
  WiFi.onEvent([](WiFiEvent_t evento, WiFiEventInfo_t info) {
    if (evento == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("[WiFi] Desconectou. Motivo: %u\n", info.wifi_sta_disconnected.reason);
    }
  });
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  wifiSecure.setCACert(ROOT_CA);
  wifiSecure.setHandshakeTimeout(15);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);
  mqtt.setCallback(receberMQTT);

  if (conectarWiFi() && sincronizarHorario()) conectarMQTT();
}

// ============================================
// LOOP
// ============================================

void loop() {
  verificarComandos();

  // Reconexao Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    // Fecha o socket antigo antes de recuperar a rede.
    wifiSecure.stop();
    if (millis() - ultimaTentativaWiFi >= 15000) conectarWiFi();
  } else if (time(nullptr) < 1700000000 && millis() - ultimaTentativaHorario >= 15000) {
    sincronizarHorario();
  }

  // Reconexao MQTT
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    unsigned long agora = millis();

    if (agora - ultimaTentativaMQTT >= RECONEXAO_MS) {
      ultimaTentativaMQTT = agora;
      conectarMQTT();
    }
  }

  if (mqtt.connected()) {
    mqtt.loop();
  }

  // Ciclo nominal de 1 s; aquisicao e reconexoes podem aumentar esse intervalo.
  unsigned long agora = millis();

  if (agora - ultimaLeitura >= INTERVALO_MS) {
    ultimaLeitura = agora;
    publicarTelemetria();
  }
  delay(10);
}
