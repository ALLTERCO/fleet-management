#!/bin/bash

# openssl-legacy-provider: for Node v17+
# max_old_space_size: prevent CPU exhaustion.
export NODE_OPTIONS="--openssl-legacy-provider --max_old_space_size=200"

. /home/ubuntu/.nvm/nvm.sh

echo "installing dependencies..."
npm install

echo "building frontend..."
cd ./packages/frontend
npm run build

echo "building backend..."
cd ../backend
npm run build

echo "starting backend..."
WEB_PORT_HTTP=7011 npm start
