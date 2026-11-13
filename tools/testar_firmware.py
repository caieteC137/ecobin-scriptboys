#!/usr/bin/env python3
"""Executa o sketch real com interfaces de hardware simuladas, sem rede/USB.

Requer g++ e Node.js. Usa secrets.example.h no build temporario, nunca secrets.h.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from verificar_emqx import validar_telemetria

ROOT = Path(__file__).resolve().parents[1]

STUBS = r'''
#pragma once
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <deque>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using byte = uint8_t;
inline unsigned long clockMs=0, echoUs=1458;
inline unsigned long millis(){return clockMs;}
inline void delay(unsigned long ms){clockMs+=ms;}
inline void delayMicroseconds(unsigned long){}
inline unsigned long pulseIn(uint8_t,int,unsigned long){return echoUs;}
constexpr int OUTPUT=1,INPUT=0,HIGH=1,LOW=0,WIFI_STA=1,WL_CONNECTED=3;
constexpr int ARDUINO_EVENT_WIFI_STA_DISCONNECTED=5;
using WiFiEvent_t=int;
struct WiFiEventInfo_t { struct { unsigned reason; } wifi_sta_disconnected; };
inline void pinMode(uint8_t,int){}
inline void digitalWrite(uint8_t,int){}
template<class T>T constrain(T x,T lo,T hi){return std::max(lo,std::min(x,hi));}
class String {
 public:
  std::string s;
  String(const char* v=""):s(v){} String(std::string v):s(v){}
  const char* c_str()const{return s.c_str();} size_t length()const{return s.size();}
  void trim(){auto a=s.find_first_not_of(" \t\r\n"); if(a==s.npos){s.clear();return;}s=s.substr(a,s.find_last_not_of(" \t\r\n")-a+1);}
  bool startsWith(const char* p)const{return s.rfind(p,0)==0;}
  bool equalsIgnoreCase(const char* p)const{std::string a=s,b=p;for(char& c:a)c=tolower(c);for(char& c:b)c=tolower(c);return a==b;}
  String substring(size_t n)const{return s.substr(n);}
  void replace(char a,char b){std::replace(s.begin(),s.end(),a,b);}
  void replace(const char* a,const char* b){size_t i=0;while((i=s.find(a,i))!=s.npos){s.replace(i,strlen(a),b);i+=strlen(b);}}
  friend String operator+(const char* a,const String& b){return std::string(a)+b.s;}
};
struct SerialMock {
 std::string input,log;
 void begin(int){} void setTimeout(int){}
 int available(){return !input.empty();}
 String readStringUntil(char c){auto i=input.find(c);std::string r=input.substr(0,i);input=i==input.npos?"":input.substr(i+1);return r;}
 template<class T>void print(T v){std::ostringstream s;s<<v;log+=s.str();}
 template<class T>void println(T v){print(v);log+='\n';}
 void println(){log+='\n';}
 void printf(const char* fmt,...){char b[2048];va_list args;va_start(args,fmt);vsnprintf(b,sizeof b,fmt,args);va_end(args);log+=b;}
}inline Serial;
class HX711 {
 public:
 std::deque<long> samples;long offset=0;float scale=1;
 void begin(uint8_t,uint8_t){scale=1;}
 bool wait_ready_timeout(unsigned long ms,unsigned long){if(samples.empty()){delay(ms);return false;}return true;}
 long read(){assert(!samples.empty());long v=samples.front();samples.pop_front();return v;}
 void set_offset(long v){offset=v;} long get_offset(){return offset;}
 void set_scale(float v){scale=v;}
};
class Preferences {
 public:
 inline static std::map<std::string,float> numbers;
 inline static std::map<std::string,bool> flags;
 bool begin(const char* ns,bool){assert(std::string(ns)=="ecobin");return true;}
 float getFloat(const char* k,float d){return numbers.count(k)?numbers[k]:d;}
 bool getBool(const char* k,bool d){return flags.count(k)?flags[k]:d;}
 size_t putFloat(const char* k,float v){numbers[k]=v;return sizeof(float);}
 size_t putBool(const char* k,bool v){flags[k]=v;return 1;}
};
struct IPAddress {};
inline std::ostream& operator<<(std::ostream& s,const IPAddress&){return s<<"127.0.0.1";}
struct WiFiMock {
 int status(){return WL_CONNECTED;} void disconnect(bool,bool){} void begin(const char*,const char*){}
 IPAddress localIP(){return {}; } bool hostByName(const char*,IPAddress&){return true;}
 String macAddress(){return "00:11:22:33:44:55";}
 template<class T>void onEvent(T){} void mode(int){} void persistent(bool){} void setAutoReconnect(bool){} void setSleep(bool){}
}inline WiFi;
inline void configTime(int,int,const char*,const char*){}
struct WiFiClientSecure {void setCACert(const char*){}void setHandshakeTimeout(int){}void stop(){}int lastError(char*,size_t){return 0;}};
class PubSubClient {
 public:
 bool online=true;int loops=0;
 std::vector<std::pair<std::string,std::string>> sent;
 PubSubClient(WiFiClientSecure&){}
 bool connected(){return online;}void loop(){++loops;}
 bool connect(const char*,const char*,const char*,const char*,int,bool,const char*){return online=true;}
 bool publish(const char* t,const char* p,bool=false){sent.emplace_back(t,p);return true;}
 bool subscribe(const char*,int){return true;}int state(){return 0;}
 void setServer(const char*,uint16_t){}void setBufferSize(int){}void setKeepAlive(int){}void setSocketTimeout(int){}
 template<class T>void setCallback(T){}
};
'''

HARNESS = r'''
#include "firmware.ino"
void fill(long raw,int n){balanca.samples.assign(n,raw);}
void reset(){calibrada=true;temTara=true;fatorCalibracao=100;balanca.set_scale(100);balanca.set_offset(100000);balanca.samples.clear();mqtt.online=true;mqtt.sent.clear();Serial.input.clear();Serial.log.clear();echoUs=1458;memoriaDisponivel=true;}
void noPublish(){const auto n=mqtt.sent.size();publicarTelemetria();assert(mqtt.sent.size()==n);}
void publish(long raw,unsigned long echo){reset();fill(raw,10);echoUs=echo;publicarTelemetria();assert(mqtt.sent.size()==1);assert(mqtt.sent.back().first=="ecobin/L01/telemetria");std::cout<<mqtt.sent.back().second<<'\n';}
int main(){
 reset();fill(100000,20);zerarBalanca();assert(temTara && balanca.get_offset()==100000);
 fill(120600,20);Serial.input="c 206\n";verificarComandos();assert(calibrada && fabs(fatorCalibracao-100)<0.001);assert(Preferences::numbers["fator"]==100 && Preferences::flags["calibrada"]);
 fill(120600,10);assert(fabs(lerPesoGramas()-206)<0.001);
 fill(79400,20);calibrar(206);assert(fatorCalibracao==-100);fill(79400,10);assert(fabs(lerPesoGramas()-206)<0.001);
 const float saved=fatorCalibracao;calibrar(0);calibrar(NAN);assert(fatorCalibracao==saved);
 Serial.input="c 206 lixo\n";verificarComandos();assert(fatorCalibracao==saved);
 fill(8388607,20);calibrar(206);assert(fatorCalibracao==saved);
 Preferences::numbers["fator"]=-100;Preferences::flags["calibrada"]=true;balanca.samples.clear();iniciarSensores();assert(calibrada && fatorCalibracao==-100 && balanca.scale==-100 && !temTara);
 fill(100000,20);Serial.input="t\n";verificarComandos();fill(79400,10);assert(fabs(lerPesoGramas()-206)<0.001);
 publish(120600,1458); // 206 g -> 0.206 kg
 publish(900000,1458); // alerta por 8 kg
 publish(120600,116);  // ocupacao limitada a 100%
 publish(120600,4000); // distancia maior que vazio: 0%
 publish(100100,1458); // ruido de 1 g: zero
 reset();calibrada=false;fill(120600,10);noPublish();
 reset();temTara=false;fill(120600,10);noPublish();
 reset();fill(120600,10);echoUs=0;noPublish();
 reset();noPublish(); // HX711 ausente
 reset();fill(120600,5);noPublish(); // desconexao no meio da media
 reset();fill(8388607,10);noPublish();
 reset();fill(-8388608,10);noPublish();
 reset();fill(99000,10);noPublish(); // massa negativa nao vira positiva
 reset();mqtt.online=false;fill(120600,10);noPublish();
 reset();fill(8388607,20);zerarBalanca();assert(!temTara);
 std::cerr<<"PASSOU: calibracao, reinicio, unidades, comandos e bloqueio de sensores invalidos\n";
}
'''


def main():
    with tempfile.TemporaryDirectory(prefix='ecobin-test-firmware-') as temp:
        dest = Path(temp)
        (dest / 'Arduino.h').write_text(STUBS)
        for header in ['HX711.h', 'Preferences.h', 'WiFi.h', 'WiFiClientSecure.h', 'PubSubClient.h']:
            (dest / header).write_text('#include "Arduino.h"\n')
        shutil.copyfile(ROOT / 'secrets.example.h', dest / 'secrets.h')
        shutil.copyfile(ROOT / 'ecoBin.ino', dest / 'firmware.ino')
        (dest / 'test.cpp').write_text(HARNESS)
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Wno-unused-parameter', '-I', str(dest), str(dest / 'test.cpp'), '-o', str(dest / 'test')], check=True)
        result = subprocess.run([str(dest / 'test')], check=True, text=True, capture_output=True)
        readings = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(readings) == 5
        assert readings[0]['massa_kg'] == 0.206 and readings[0]['simulado'] is False
        assert readings[1]['coletar'] is True and readings[1]['massa_kg'] == 8
        assert readings[2]['ocupacao_pct'] == 100 and readings[2]['coletar'] is True
        assert readings[3]['ocupacao_pct'] == 0
        assert readings[4]['massa_kg'] == 0
        for reading in readings:
            validar_telemetria(reading)
        for extra in [{"simulado": True}, {"massa_kg": -1}, {"massa_kg": True}, {"distancia_cm": None}, {"ocupacao_pct": float('nan')}]:
            try:
                validar_telemetria({**readings[0], **extra})
            except RuntimeError:
                continue
            raise AssertionError('Verificador aceitou uma leitura incorreta')
        # Passa os JSONs publicados pelo firmware pela funcao real do fluxo exportado.
        js = """
import fs from 'node:fs';
const flow=JSON.parse(fs.readFileSync('node-red/ecobin-flow.json','utf8'));
const run=new Function('msg','node','flow',flow.find(n=>n.id==='ecobin_normalizar').func);
const entries=JSON.parse(fs.readFileSync(0,'utf8'));
for(const payload of entries){
 const result=run({topic:'ecobin/L01/telemetria',payload}, {status(){},error(e){throw Error(e)}}, {set(){}});
 if(result.payload.simulado!==false)throw Error('Origem incorreta');
}
console.log('PASSOU: 5 JSONs produzidos pelo sketch aceitos pelo contrato Node-RED');
"""
        subprocess.run(['node', '--input-type=module', '-e', js], input=json.dumps(readings), text=True, cwd=ROOT, check=True)
        print(result.stderr.strip())


if __name__ == '__main__':
    main()
