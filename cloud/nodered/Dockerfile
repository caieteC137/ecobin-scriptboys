FROM nodered/node-red:5.0.9
COPY --chown=node-red:node-red cloud/nodered/package.json /tmp/ecobin-deps/package.json
RUN cd /tmp/ecobin-deps && npm install --omit=dev --no-audit --no-fund
ENV NODE_PATH=/tmp/ecobin-deps/node_modules
COPY --chown=node-red:node-red --chmod=644 cloud/nodered/settings.cjs cloud/nodered/start.sh cloud/nodered/flows.json cloud/nodered/flows_cred.json /opt/ecobin/
USER root
RUN chmod 755 /opt/ecobin
USER node-red
ENTRYPOINT ["/bin/sh", "/opt/ecobin/start.sh"]
CMD []
