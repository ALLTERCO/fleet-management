# First stage: build
FROM node:18.16.0-alpine3.17 AS builder

ENV RELATIVE_CLIENT_PATH="../../../frontend/dist/"

# Backend
WORKDIR /app/backend
COPY ./backend/package*.json ./backend/package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY ./backend/tsconfig*.json ./
COPY ./backend/src ./src
COPY ./backend/cfg ./cfg
COPY ./backend/embedded_web ./embedded_web
COPY ./backend/plugins ./plugins
RUN npm run build

# Frontend
WORKDIR /app/frontend
COPY ./frontend/package*.json ./frontend/package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY ./frontend/tsconfig*.json ./
COPY ./frontend/src ./src
COPY ./frontend/public ./public
COPY ./frontend/index.html ./
COPY ./frontend/vite.config.ts ./
RUN npm run build 

# Second stage: run
FROM node:18.16.0-alpine3.17

ENV FLEET_MANAGER_PORT=7011

WORKDIR /app
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend ./frontend

RUN mkdir -p /app/backend/logs && chown -R node:node /app/backend/logs

WORKDIR /app/backend
EXPOSE ${FLEET_MANAGER_PORT}
CMD [ "npm", "start" ]