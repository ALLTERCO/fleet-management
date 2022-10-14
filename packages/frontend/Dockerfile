FROM node:lts as build-stage

WORKDIR /app

ENV VUE_APP_BACKEND_URI=http://localhost:7011
ENV VUE_APP_BASE_URL=/

COPY ./src ./src
COPY ./public ./public
COPY babel.config.js ./
COPY package* ./
COPY tsconfig* ./

RUN npm install
RUN npm run build

FROM nginx as production-stage
RUN mkdir /app
COPY --from=build-stage /app/dist /app
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

