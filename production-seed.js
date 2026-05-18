require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('=== Starting Admin-Only Production Seeding ===');

  // 1. Wipe database clean
  console.log('Clearing existing database tables...');
  await prisma.notification.deleteMany({});
  await prisma.barterOffer.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.parallelClass.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.activityLog.deleteMany({});
  console.log('✓ Database tables wiped successfully.');

  // 2. Create the SINGLE requested Super Admin
  console.log('Creating Super Admin account: wafflegilang@gmail.com...');
  await prisma.user.create({
    data: {
      nim: 'ADMIN001',
      name: 'Gilang (Super Admin)',
      email: 'wafflegilang@gmail.com',
      role: 'super_admin',
      isActive: true
    }
  });
  console.log('✓ Super Admin created.');
  console.log('\n=== Seeding Completed Successfully! ===');
}

main()
  .catch(err => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
