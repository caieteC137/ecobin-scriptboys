#!/bin/sh
set -eu
if [ ! -f /data/ecobin-flows.json ]; then cp /opt/ecobin/flows.json /data/ecobin-flows.json; fi
if [ ! -f /data/ecobin-flows_cred.json ]; then cp /opt/ecobin/flows_cred.json /data/ecobin-flows_cred.json; fi
# O pacote fica dentro de /data, onde o Node-RED descobre os nos instalados.
mkdir -p /data/node_modules
if [ ! -e /data/node_modules/node-red-contrib-telegrambot ]; then
  ln -s /tmp/ecobin-deps/node_modules/node-red-contrib-telegrambot /data/node_modules/node-red-contrib-telegrambot
fi
exec node /usr/src/node-red/node_modules/node-red/red.js --userDir /data --settings /opt/ecobin/settings.cjs /data/ecobin-flows.json
