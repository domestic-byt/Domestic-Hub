FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
COPY packages/api/package.json packages/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY packages ./packages

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "packages/api/src/server.ts"]
