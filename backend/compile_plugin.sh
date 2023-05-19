#!/bin/bash
./tsc --pretty --listEmittedFiles true --module commonjs --moduleResolution node --target es2021 --lib es2021 ./plugins/$1/index.ts