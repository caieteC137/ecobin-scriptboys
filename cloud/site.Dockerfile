FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node site/package.json site/server.mjs ./
COPY --chown=node:node site/lib ./lib
COPY --chown=node:node site/public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3000 ECOBIN_DB=/data/ecobin.sqlite ECOBIN_ENVIRONMENT=azure
EXPOSE 3000
CMD ["node", "server.mjs"]
