#!/bin/bash
echo "working on backend"
cd ./backend
echo "installing dependencies..."
npm install
echo "building backend..."
cd ./packages/backend
npm build
echo "building frontend..."
cd ../frontend/
npm run build
cd ..
echo "starting backend..."
exec ./start_backend.sh