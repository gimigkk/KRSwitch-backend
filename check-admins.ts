import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const admins = await prisma.user.findMany({ where: { role: 'admin' } });
  console.log('Admins found:', admins.map(a => ({ nim: a.nim, name: a.name })));
}
main();
