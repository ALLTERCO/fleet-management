# Developing

> **Requires Node.js 20 or above.**

## Run Fleet Manager natively on your system

```bash
cd ./frontend
npm install
npm run build
cd ../backend
npm install
npm run build
npm start
```

## Run compiler in build mode so that new changes are automatically compiled

### Frontend

```bash
cd frontend
npm run watch
```

### Backend

```bash
cd backend
npm run watch
npm start
```

Occasionally run  `node jsonSchema2ts.js` to regenerate d.ts
param validations of rpc methods

### Running Postgres (TimescaleDB) with docker container

Use docker compose yaml file in the root dir of the project, remove mdns repeater and grafana container definitions and run compose file wit `docker compose up -d` if in ubuntu or older version of debian based distro use `docker-compose up -d` and wait untill container is ready (~1sec )
