#!/bin/sh
set -eu
if [ ! -f /data/flows.json ]; then cp /opt/ecobin/flows.json /data/flows.json; fi
if [ ! -f /data/flows_cred.json ]; then cp /opt/ecobin/flows_cred.json /data/flows_cred.json; fi
# O pacote fica dentro de /data, onde o Node-RED descobre os nos instalados.
if [ ! -e /data/node_modules ]; then ln -s /tmp/ecobin-deps/node_modules /data/node_modules; fi
exec node /usr/src/node-red/node_modules/node-red/red.js --userDir /data --settings /opt/ecobin/settings.cjs /data/flows.json
