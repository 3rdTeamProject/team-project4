FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_ 값은 빌드할 때 화면 코드에 들어간다
ARG VITE_API_URL=/api
ARG VITE_KAKAO_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL VITE_KAKAO_CLIENT_ID=$VITE_KAKAO_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
