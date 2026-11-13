
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include "secrets.h"

// ============================================
// ECOBIN - CONFIGURACOES
// ============================================

// Wi-Fi



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
// ECOBIN - SIMULACAO ORIGINAL
// ============================================

constexpr float VAZIO_CM = 50.0f;
constexpr float CHEIO_CM = 5.0f;
constexpr float LIMITE_KG = 8.0f;
constexpr float LIMITE_PCT = 80.0f;

float massaKg = 0.0f;
float ocupacaoPct = 0.0f;

// Intervalo de publicacao: 1 segundo
constexpr unsigned long INTERVALO_MS = 1000;
constexpr unsigned long RECONEXAO_MS = 5000;

unsigned long ultimaLeitura = 0;
unsigned long ultimaTentativaMQTT = 0;
unsigned long ultimaTentativaWiFi = 0;
unsigned long ultimaTentativaHorario = 0;

// ============================================
// CLIENTES DE REDE
// ============================================

WiFiClientSecure wifiSecure;
PubSubClient mqtt(wifiSecure);

// ============================================
// FUNCOES DA LIXEIRA
// ============================================

void esvaziarLixeira() {
  massaKg = 0.0f;
  ocupacaoPct = 0.0f;

  Serial.println("[EcoBin] Lixeira esvaziada!");
}

void atualizarSimulacao() {
  // Entrada simulada de residuos
  ocupacaoPct += random(20, 51) / 10.0f;
  massaKg += random(20, 51) / 100.0f;

  ocupacaoPct = constrain(ocupacaoPct, 0.0f, 100.0f);
  massaKg = constrain(massaKg, 0.0f, 12.0f);
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
  // Mantem a simulacao mesmo sem conexao MQTT
  atualizarSimulacao();

  float distanciaCm =
      VAZIO_CM -
      (ocupacaoPct / 100.0f) * (VAZIO_CM - CHEIO_CM);

  bool coletar =
      massaKg >= LIMITE_KG ||
      ocupacaoPct >= LIMITE_PCT;

  const char* status =
      coletar ? "coletar" :
      ocupacaoPct >= 70.0f ? "acompanhar" :
      "normal";

  // Monta o mesmo JSON do codigo original
  char payload[384];

  int tamanho = snprintf(
      payload,
      sizeof(payload),
      "{"
      "\"lixeira\":\"L01\","
      "\"setor\":\"Producao A\","
      "\"compartimento\":\"reciclavel\","
      "\"simulado\":true,"
      "\"uptime_ms\":%lu,"
      "\"massa_kg\":%.2f,"
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
  randomSeed(micros());

  Serial.println();
  Serial.println("==========================");
  Serial.println(" EcoBin | MQTT EMQX Cloud ");
  Serial.println("==========================");
  Serial.println("Envie 't' para esvaziar.");

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
  // Comando original de esvaziamento
  while (Serial.available()) {
    char comando = Serial.read();

    if (comando == 't' || comando == 'T') {
      esvaziarLixeira();
    }
  }

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

  // Publicacao a cada segundo
  unsigned long agora = millis();

  if (agora - ultimaLeitura >= INTERVALO_MS) {
    ultimaLeitura = agora;
    publicarTelemetria();
  }
  delay(10);
}
