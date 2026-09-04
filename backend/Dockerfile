FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV PORT=4100
EXPOSE 4100

CMD ["node", "src/index.js"]
