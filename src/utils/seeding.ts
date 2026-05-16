import { prisma } from '../prisma/db';

interface SeedingResult {
  studentCount: number;
  classCount: number;
  enrollmentCount: number;
}

export async function randomizeEnrollments(): Promise<SeedingResult> {
  // 1. Fetch data
  const students = await prisma.user.findMany({
    where: { role: 'student' }
  });
  const classes = await prisma.parallelClass.findMany();

  console.log(`Starting randomization for ${students.length} students and ${classes.length} classes`);

  if (students.length === 0 || classes.length === 0) {
    throw new Error('Tidak ada data mahasiswa atau kelas untuk diacak.');
  }

  // 2. Clear existing dynamic data
  console.log('Clearing old enrollments/offers...');
  await prisma.$transaction([
    prisma.notification.deleteMany({}),
    prisma.barterOffer.deleteMany({}),
    prisma.enrollment.deleteMany({}),
  ]);

  // 3. Process classes
  const courseCodes = Array.from(new Set(classes.map(c => c.courseCode)));
  const courseMap: Record<string, { types: Record<string, any[]> }> = {};

  classes.forEach(c => {
    const classType = c.classCode[0].toUpperCase(); // K, P, or R
    const classNum = parseInt(c.classCode.slice(1)) || 0;
    
    if (!courseMap[c.courseCode]) {
      courseMap[c.courseCode] = { types: {} };
    }
    if (!courseMap[c.courseCode].types[classType]) {
      courseMap[c.courseCode].types[classType] = [];
    }
    courseMap[c.courseCode].types[classType].push({ ...c, classType, classNum });
  });

  // Sort sections by classNum for consistent round-robin
  for (const code of courseCodes) {
    for (const type in courseMap[code].types) {
      courseMap[code].types[type].sort((a, b) => a.classNum - b.classNum);
    }
  }

  // 4. Assign Round-Robin
  const enrollments: { nim: string; parallelClassId: number }[] = [];
  console.log(`Course codes found: ${courseCodes.join(', ')}`);

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    let assignedForThisStudent = 0;
    
    for (const code of courseCodes) {
      const types = courseMap[code].types;
      const kSections = types['K'];
      
      if (!kSections || kSections.length === 0) {
        // console.log(`Warning: Course ${code} has no K sections`);
        continue;
      }

      // Assign Lecture (K)
      const k = kSections[i % kSections.length];
      enrollments.push({ nim: student.nim, parallelClassId: k.id });
      assignedForThisStudent++;

      // Assign Lab (P or R) if exists
      const pracKey = 'P' in types ? 'P' : 'R' in types ? 'R' : null;
      if (pracKey) {
        const pSections = types[pracKey];
        // Kn -> Pn matching if counts are equal, else independent round-robin
        const p = (pSections.length === kSections.length)
          ? (pSections.find(p => p.classNum === k.classNum) || pSections[i % pSections.length])
          : pSections[i % pSections.length];
        
        enrollments.push({ nim: student.nim, parallelClassId: p.id });
        assignedForThisStudent++;
      }
    }
    // if (i === 0) console.log(`DEBUG: Student ${student.nim} assigned to ${assignedForThisStudent} classes`);
  }

  console.log(`Total generated enrollments: ${enrollments.length}`);

  // 5. Bulk Insert
  const chunkSize = 500;
  for (let i = 0; i < enrollments.length; i += chunkSize) {
    await prisma.enrollment.createMany({
      data: enrollments.slice(i, i + chunkSize),
      skipDuplicates: true
    });
  }

  return {
    studentCount: students.length,
    classCount: classes.length,
    enrollmentCount: enrollments.length
  };
}
