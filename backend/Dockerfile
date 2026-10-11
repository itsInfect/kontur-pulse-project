FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run db:generate && npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npm run db:deploy && node dist/main.js"]
