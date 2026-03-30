FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json vitest.config.ts README.md ./

RUN npm ci
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV CAREERRAFIQ_START_API=1
ENV PORT=8787

COPY --from=build /app /app

EXPOSE 8787

CMD ["npm", "run", "start", "--workspace", "@career-rafiq/api"]
