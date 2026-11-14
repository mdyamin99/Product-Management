
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 3000

# Apply pending migrations before the API starts, so a brand-new database
# volume is usable without a manual `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
