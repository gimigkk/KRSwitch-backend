import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

console.log('Initializing Prisma with DATABASE_URL:', process.env.DATABASE_URL ? 'FOUND' : 'MISSING');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Test connection on startup
prisma.$connect()
  .then(() => console.log('Successfully connected to the database via Prisma'))
  .catch((err) => console.error('Failed to connect to the database via Prisma:', err));