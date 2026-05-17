import { prisma } from './prisma/db';
import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';

async function seed() {
  try {
    const studentRows: any[] = [];
    const classRows: any[] = [];

    await new Promise((resolve) => {
      fs.createReadStream(path.join(__dirname, '../mock_data/mock_students.csv'))
        .pipe(csvParser())
        .on('data', (data) => studentRows.push(data))
        .on('end', resolve);
    });

    await new Promise((resolve) => {
      fs.createReadStream(path.join(__dirname, '../mock_data/mock_classes.csv'))
        .pipe(csvParser())
        .on('data', (data) => classRows.push(data))
        .on('end', resolve);
    });

    const students = studentRows.map((row) => ({
      nim: row.nim.trim(),
      name: row.name.trim(),
      email: row.email.trim(),
      role: 'student',
      isActive: true,
    })).filter(s => s.nim);

    const classes = classRows.map((row) => ({
      courseCode: row.courseCode.trim(),
      courseName: row.courseName.trim(),
      classCode: row.classCode.trim(),
      day: row.day.trim(),
      timeStart: row.timeStart.trim(),
      timeEnd: row.timeEnd.trim(),
      room: row.room.trim(),
    })).filter(c => c.courseCode);

    console.log(`Inserting ${students.length} students and ${classes.length} classes...`);

    if (students.length > 0) {
      await prisma.user.createMany({ data: students, skipDuplicates: true });
    }
    if (classes.length > 0) {
      await prisma.parallelClass.createMany({ data: classes, skipDuplicates: true });
    }

    console.log('Seed complete.');
  } catch (error) {
    console.error('Seed failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
