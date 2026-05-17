import { prisma } from './prisma/db';

async function migrateRoles() {
  try {
    const result = await prisma.user.updateMany({
      where: { role: 'admin' },
      data: { role: 'super_admin' }
    });
    console.log(`Updated ${result.count} users from admin to super_admin`);
  } catch (err) {
    console.error('Error during role migration:', err);
  } finally {
    await prisma.$disconnect();
  }
}

migrateRoles();
