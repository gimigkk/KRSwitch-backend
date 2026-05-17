require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Fisher-Yates Shuffler for realistic randomization
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[arr[j] ? j : i]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  console.log('=== Starting Barter-Only Demo Seeding ===');

  // 1. Fetch current database state
  const students = await prisma.user.findMany({
    where: { role: 'student' }
  });
  const classes = await prisma.parallelClass.findMany();
  const enrollments = await prisma.enrollment.findMany();

  if (students.length === 0 || classes.length === 0 || enrollments.length === 0) {
    console.error('Error: Database has no students, classes, or enrollments! Please seed the database first (e.g., node enhanced-seed.js) or import CSV files.');
    process.exit(1);
  }

  console.log(`Found ${students.length} students, ${classes.length} classes, and ${enrollments.length} enrollments.`);

  // 2. Wipe existing barter data
  console.log('Cleaning old barter offers and notifications...');
  await prisma.notification.deleteMany({});
  await prisma.barterOffer.deleteMany({});

  // 3. Group enrollments by courseCode and classType (K, P, R)
  const enrollByCourseAndType = {};
  for (const enr of enrollments) {
    const cls = classes.find(c => c.id === enr.parallelClassId);
    if (!cls) continue;
    const type = cls.classCode[0]; // 'K', 'P', or 'R'
    const key = `${cls.courseCode}-${type}`;
    if (!enrollByCourseAndType[key]) enrollByCourseAndType[key] = [];
    enrollByCourseAndType[key].push({ ...enr, class: cls });
  }

  // Set to track students who already have an active barter offer
  // This guarantees each student makes at MOST 1 active trade offer!
  const assignedNims = new Set();

  let openCount = 0;
  let matchedCount = 0;
  let historyCount = 0;

  // ─── 4. Target Curation for Logged-In Demo Student M0403241117 ───
  const demoStudentNim = 'M0403241117';
  const demoStudentEnrollments = enrollments.filter(e => e.nim === demoStudentNim);
  let demoCreated = 0;

  if (demoStudentEnrollments.length > 0) {
    console.log(`Curating specific clickable demo offers for main student ${demoStudentNim}...`);
    
    // We want to find up to 3 classes they are enrolled in, and create open offers they can accept!
    for (const enr of shuffle(demoStudentEnrollments)) {
      if (demoCreated >= 3) break;
      
      const myClass = classes.find(c => c.id === enr.parallelClassId);
      if (!myClass) continue;
      
      // Find parallel sections of the same course and type
      const parallelSections = classes.filter(c => 
        c.courseCode === myClass.courseCode && 
        c.classCode[0] === myClass.classCode[0] && 
        c.id !== myClass.id
      );
      
      if (parallelSections.length === 0) continue;
      
      let counterpart = null;
      let targetClass = null;
      
      // Find a student enrolled in one of the parallel sections who is free
      for (const section of shuffle(parallelSections)) {
        const potentialTakers = enrollments.filter(e => 
          e.parallelClassId === section.id && 
          e.nim !== demoStudentNim && 
          !assignedNims.has(e.nim)
        );
        if (potentialTakers.length > 0) {
          counterpart = potentialTakers[0];
          targetClass = section;
          break;
        }
      }
      
      if (counterpart && targetClass) {
        assignedNims.add(counterpart.nim);
        
        await prisma.barterOffer.create({
          data: {
            offererNim: counterpart.nim,
            myClassId: targetClass.id,
            wantedClassId: myClass.id,
            status: 'open',
            createdAt: new Date(Date.now() - 1000 * 60 * (2 + Math.random() * 5)), 
          }
        });
        openCount += 1;
        demoCreated += 1;
      }
    }
  }

  // ─── 5. General Seeding ───
  console.log('Generating general realistic barter offers...');

  const keys = shuffle(Object.keys(enrollByCourseAndType));
  for (const key of keys) {
    const list = enrollByCourseAndType[key];
    
    // Separate student enrollments by section/classCode
    const classGroups = {};
    for (const item of list) {
      const code = item.class.classCode;
      if (!classGroups[code]) classGroups[code] = [];
      classGroups[code].push(item);
    }

    const availableCodes = Object.keys(classGroups);
    if (availableCodes.length < 2) continue; // Needs at least 2 sections to generate a trade

    // Shuffle sections and pick two parallel sections to trade between
    const shuffledCodes = shuffle(availableCodes);
    const codeA = shuffledCodes[0];
    const codeB = shuffledCodes[1];

    const groupA = shuffle(classGroups[codeA]);
    const groupB = shuffle(classGroups[codeB]);

    // 1. Perfect 2-Way Match:
    // Student A (enrolled in Section A) wants Section B
    // Student B (enrolled in Section B) wants Section A
    // Both must be unique and not currently assigned to any other open offer
    const studentA = groupA.find(student => !assignedNims.has(student.nim));
    const studentB = groupB.find(student => !assignedNims.has(student.nim));

    if (studentA && studentB) {
      // Mark nims as busy
      assignedNims.add(studentA.nim);
      assignedNims.add(studentB.nim);

      // Create Offer A
      await prisma.barterOffer.create({
        data: {
          offererNim: studentA.nim,
          myClassId: studentA.parallelClassId,
          wantedClassId: studentB.parallelClassId,
          status: 'open',
          createdAt: new Date(Date.now() - 1000 * 60 * (30 + Math.random() * 60)), 
        }
      });

      // Create Offer B
      await prisma.barterOffer.create({
        data: {
          offererNim: studentB.nim,
          myClassId: studentB.parallelClassId,
          wantedClassId: studentA.parallelClassId,
          status: 'open',
          createdAt: new Date(Date.now() - 1000 * 60 * (25 + Math.random() * 60)),
        }
      });
      openCount += 2;
      matchedCount += 1;
    }

    // 2. Single Open Offer:
    // Student C (enrolled in Section A) wants Section B, showing in the open queue without matching partner yet
    const studentC = groupA.find(student => !assignedNims.has(student.nim));
    const classTarget = groupB[0]; // target class is section B

    if (studentC && classTarget) {
      assignedNims.add(studentC.nim);

      await prisma.barterOffer.create({
        data: {
          offererNim: studentC.nim,
          myClassId: studentC.parallelClassId,
          wantedClassId: classTarget.parallelClassId,
          status: 'open',
          createdAt: new Date(Date.now() - 1000 * 60 * (15 + Math.random() * 60)),
        }
      });
      openCount += 1;
    }

    // 3. Historical Completed Swap:
    // Pick another pair of students to generate matched history logs
    const studentD = groupA.find(student => !assignedNims.has(student.nim));
    const studentE = groupB.find(student => !assignedNims.has(student.nim));

    if (studentD && studentE) {
      // Historical matches are already finalized, so we don't block their nims for future open offers
      await prisma.barterOffer.create({
        data: {
          offererNim: studentD.nim,
          myClassId: studentD.parallelClassId,
          wantedClassId: studentE.parallelClassId,
          status: 'matched',
          takerNim: studentE.nim,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * (2 + Math.random() * 10)), 
          completedAt: new Date(Date.now() - 1000 * 60 * 60 * (1.8 + Math.random() * 9)),
        }
      });
      historyCount += 1;
    }
  }

  console.log('\n=== Demo Seeding Complete ===');
  console.log(`Successfully populated:`);
  console.log(`  - ${openCount} Open Barter Offers (${demoCreated} tailored for main demo student!)`);
  console.log(`  - ${matchedCount} Active Auto-Match Pairs (ready for admin dashboard)`);
  console.log(`  - ${historyCount} Completed Barter Match History Records`);
  console.log(`  - Diverse Student Spread: ${assignedNims.size} different students actively participating in trades.`);
}

main()
  .catch(err => { console.error('Seed failed:', err.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
