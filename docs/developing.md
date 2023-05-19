# Developing

## Run Fleet Manager natively on your system
```bash
cd ./frontend
npm run install
npm run build
cd ../backend
npm install
npm run build
npm start
```

## Run compiler in build mode so that new changes are automatically compiled

### Frontend
```bash
cd packages/frontend
npm run watch
```
### Backend
```bash
cd packages/backend
npm run watch
npm start
```

