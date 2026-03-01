FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN mkdir -p /data
VOLUME ["/data"]

ENV DB_PATH=/data/index.db
ENV PORT=3001

EXPOSE 3001
CMD ["node", "dist/index.js"]
