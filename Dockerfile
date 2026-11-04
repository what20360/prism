FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:all
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
ENV PRISM_DATA_DIR=/data
USER node
VOLUME ["/data"]
EXPOSE 8787/tcp
EXPOSE 47873/udp
CMD ["node", "dist-server/server.mjs"]
