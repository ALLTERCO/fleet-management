FROM node:lts

ENV WEB_PORT_HTTP=7011
ENV RELATIVE_CLIENT_PATH="../../../frontend/dist/"

WORKDIR /app/backend
COPY ./packages/backend/package*.json ./
COPY ./packages/backend/tsconfig*.json ./
COPY ./packages/backend/default_rpc.json ./
COPY ./packages/backend/src ./src

RUN npm install
RUN npm run build

WORKDIR /app/frontend
COPY ./packages/frontend/package*.json ./
COPY ./packages/frontend/tsconfig.json ./
COPY ./packages/frontend/babel.config.js ./
COPY ./packages/frontend/src ./src
COPY ./packages/frontend/public ./public

RUN npm install
RUN npm run build

WORKDIR /app/backend
CMD [ "npm", "start" ]

EXPOSE 7011