FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS production
# ffmpeg: Lapse AFK detection (integrations/lapse-afk.ts)
RUN apk add --no-cache git ffmpeg
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD npx prisma migrate deploy && node build/index.js
