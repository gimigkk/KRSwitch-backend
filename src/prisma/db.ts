import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

console.log('Initializing Prisma with DATABASE_URL:', process.env.DATABASE_URL ? 'FOUND' : 'MISSING');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,                       // Handle 500 concurrent users with headroom
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if pool is full rather than hang
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Test connection on startup
prisma.$connect()
  .then(() => console.log('Successfully connected to the database via Prisma'))
  .catch((err) => console.error('Failed to connect to the database via Prisma:', err));