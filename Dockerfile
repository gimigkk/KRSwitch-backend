FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
# Install postgresql-client to get pg_isready utility
RUN apk add --no-cache postgresql-client
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/production-seed.js ./production-seed.js
COPY --from=builder /app/mock_data ./mock_data

EXPOSE 5000
# Wait for the PostgreSQL database container to be fully ready before pushing schema
CMD ["sh", "-c", "until pg_isready -h db -p 5432 -U postgres; do echo 'Waiting for database...'; sleep 1; done && npx prisma db push && node dist/server.js"]