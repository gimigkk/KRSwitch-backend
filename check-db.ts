import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.count();
  const classes = await prisma.parallelClass.count();
  const enrollments = await prisma.enrollment.count();
  console.log({ users, classes, enrollments });
}
main();
