#!/bin/bash
echo "installing dependencies..."
npm install
echo "building backend..."
cd ./packages/backend
npm build
echo "building frontend..."
cd ../frontend/
npm run build
echo "building ble..."
cd ../ble
npm run build
cd ../..
echo "starting backend..."
exec ./start_backend.sh