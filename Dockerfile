FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
