require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  const admin = await prisma.user.findUnique({ where: { email: 'wafflegilang@gmail.com' } });
  console.log('Admin in DB:', admin);
  process.exit(0);
}

check();
