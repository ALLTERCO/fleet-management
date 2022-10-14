FROM node:lts

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY default_rpc.json ./
COPY src ./src

RUN npm install
RUN npm run build

ENV WEB_PORT_HTTP=7011

EXPOSE 7011

CMD ["npm", "start"]