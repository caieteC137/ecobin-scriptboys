#!/usr/bin/env python3
"""Valida TLS, autenticacao e telemetria REAL do ESP32. Somente biblioteca padrao."""
import argparse
import json
from pathlib import Path
import re
import socket
import ssl
import struct
import sys
import time
import uuid


def texto_mqtt(texto):
    dados = texto.encode("utf-8")
    return struct.pack("!H", len(dados)) + dados


def pacote(tipo, corpo):
    restante = len(corpo)
    cabecalho = bytearray([tipo])
    while True:
        digito = restante % 128
        restante //= 128
        cabecalho.append(digito | (128 if restante else 0))
        if not restante:
            return cabecalho + corpo


def receber(sock):
    def exatos(quantidade):
        dados = bytearray()
        while len(dados) < quantidade:
            parte = sock.recv(quantidade - len(dados))
            if not parte:
                raise RuntimeError("Broker encerrou a conexao")
            dados.extend(parte)
        return bytes(dados)

    tipo = exatos(1)[0]
    tamanho = 0
    for indice in range(4):
        digito = exatos(1)[0]
        tamanho += (digito & 127) * (128 ** indice)
        if not digito & 128:
            break
    else:
        raise RuntimeError("Pacote MQTT invalido")
    if tamanho > 4096:
        raise RuntimeError("Pacote MQTT excedeu o limite do verificador")
    return tipo, exatos(tamanho)


def verificar(args):
    codigo = args.sketch.read_text()
    if '#include "secrets.h"' in codigo:
        codigo += '\n' + (args.sketch.parent / 'secrets.h').read_text()

    def constante(nome):
        encontrado = re.search(r'\b' + nome + r'\s*=\s*("(?:\\.|[^"\\])*")', codigo)
        if not encontrado:
            raise RuntimeError("Constante ausente: " + nome)
        return json.loads(encontrado[1])

    ca = re.search(r'ROOT_CA\s*=\s*R"EOF\((.*?)\)EOF"', codigo, re.S)
    if not ca:
        raise RuntimeError("Certificado ROOT_CA ausente")
    contexto = ssl.create_default_context(cadata=ca[1])
    host = constante("MQTT_HOST")
    porta = int(re.search(r'\bMQTT_PORT\s*=\s*(\d+)', codigo)[1])
    topico = constante("MQTT_TOPIC")
    with socket.create_connection((host, porta), timeout=10) as tcp:
        with contexto.wrap_socket(tcp, server_hostname=host) as mqtt:
            print("OK: TLS com a CA do sketch e hostname validados", flush=True)
            corpo = (texto_mqtt("MQTT") + bytes([4, 194]) + struct.pack("!H", 60)
                     + texto_mqtt("ecobin-verificar-" + uuid.uuid4().hex[:12])
                     + texto_mqtt(constante("MQTT_USER"))
                     + texto_mqtt(constante("MQTT_PASSWORD")))
            mqtt.sendall(pacote(0x10, corpo))
            tipo, corpo = receber(mqtt)
            if tipo != 0x20 or corpo != b"\x00\x00":
                raise RuntimeError("Autenticacao recusada. CONNACK: " + corpo.hex())
            print("OK: autenticacao MQTT aceita pelo EMQX", flush=True)
            mqtt.sendall(pacote(0x82, b"\x00\x01" + texto_mqtt(topico) + b"\x00"))
            tipo, corpo = receber(mqtt)
            if tipo != 0x90 or corpo != b"\x00\x01\x00":
                raise RuntimeError("Assinatura recusada. SUBACK: " + corpo.hex())
            print("OK: assinatura autorizada em " + topico, flush=True)
            limite = time.monotonic() + args.timeout
            recebidos = 0
            while recebidos < args.quantidade:
                restante = limite - time.monotonic()
                if restante <= 0:
                    raise RuntimeError("ESP32 nao enviou a quantidade esperada de leituras")
                mqtt.settimeout(restante)
                tipo, corpo = receber(mqtt)
                if tipo >> 4 != 3:
                    continue
                tamanho = struct.unpack("!H", corpo[:2])[0]
                if corpo[2:2 + tamanho].decode() != topico:
                    continue
                # A assinatura pede QoS 0, portanto nao ha packet identifier aqui.
                dados = json.loads(corpo[2 + tamanho:])
                if (dados.get("lixeira") != "L01" or dados.get("simulado") is not True
                        or not 0 <= dados["ocupacao_pct"] <= 100
                        or not 0 <= dados["massa_kg"] <= 12):
                    raise RuntimeError("Telemetria fora do formato esperado do EcoBin")
                if tipo & 1:
                    continue  # Exige publicacoes novas, nao mensagens retidas antigas.
                recebidos += 1
                print("LEITURA " + str(recebidos) + ": " + json.dumps(dados, ensure_ascii=False), flush=True)
            mqtt.sendall(b"\xe0\x00")
            print("PASSOU: telemetria do ESP32 recebida pelo EMQX", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sketch", type=Path, default=Path(__file__).resolve().parents[1] / "ecoBin.ino")
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--quantidade", type=int, default=3)
    argumentos = parser.parse_args()
    if argumentos.quantidade < 1 or argumentos.timeout <= 0:
        parser.error("quantidade e timeout precisam ser positivos")
    try:
        verificar(argumentos)
    except (OSError, ValueError, RuntimeError, KeyError, IndexError, struct.error) as erro:
        print("FALHOU: " + str(erro), file=sys.stderr)
        sys.exit(1)
