# Build stage
FROM node:18.16.0-alpine3.17 AS builder

WORKDIR /app

COPY package*.json ./

# Install all dependencies, including devDependencies
RUN npm install

COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18.16.0-alpine3.17

WORKDIR /app

COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built app from the previous stage
COPY --from=builder /app/dist ./dist
COPY ./cfg ./cfg
ENV FLEET_MANAGER_PORT=7011

EXPOSE ${FLEET_MANAGER_PORT}

CMD ["npm", "start"]