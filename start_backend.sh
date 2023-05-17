#!/bin/bash
cd ./packages/backend

. /home/ubuntu/.nvm/nvm.sh

npm install
npm run build
WEB_PORT_HTTP=7011 npm start
