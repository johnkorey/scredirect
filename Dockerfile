FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY --from=builder /app/client/dist ./client/dist
COPY server.js db.js ./
COPY uploads ./uploads

EXPOSE 3000

CMD ["node", "server.js"]
