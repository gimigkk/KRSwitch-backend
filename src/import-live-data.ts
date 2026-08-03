import { prisma } from './prisma/db';
import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';

const COURSE_REGEX = /^(.*?)\s*\((KOM\w+)\)$/;

async function main() {
  const filePath = path.join(process.cwd(), 'Pembagian_Peserta_KOM61_LIVE.csv');
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const results: any[] = [];
  const headersSet = new Set<string>();

  console.log('Reading CSV file...');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser({
        mapHeaders: ({ header }) => header.trim().replace(/^[\uFEFF\xA0]+|[\uFEFF\xA0]+$/g, '')
      }))
      .on('headers', (headers: string[]) => {
        headers.forEach((h: string) => headersSet.add(h.trim()));
      })
      .on('data', (data) => results.push(data))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Parsed ${results.length} rows.`);

  // Wipe old barter data completely to ensure strict integrity for Phase 2
  console.log('Wiping existing testing and enrollment data...');
  await prisma.notification.deleteMany({});
  await prisma.barterOffer.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.user.deleteMany({ where: { role: 'student' } });

  const courseHeaders = Array.from(headersSet).filter(h => COURSE_REGEX.test(h));
  const courseMap = new Map();

  for (const header of courseHeaders) {
    const match = header.match(COURSE_REGEX);
    if (match) {
      courseMap.set(header, { courseName: match[1].trim(), courseCode: match[2].trim().toUpperCase() });
    }
  }

  console.log(`Found ${courseHeaders.length} course columns.`);

  let usersCreated = 0;
  let enrollmentsCreated = 0;
  const processedEmails = new Set<string>();

  console.log('Importing users and enrollments...');
  
  await prisma.$transaction(async (tx) => {
    // 0. Wipe existing data cleanly inside transaction
    await tx.notification.deleteMany({});
    await tx.barterOffer.deleteMany({});
    await tx.enrollment.deleteMany({});
    await tx.user.deleteMany({ where: { role: 'student' } });

    for (const row of results) {
      const nim = row['NIM']?.trim();
      const name = row['Nama Mahasiswa']?.trim();
  
      if (!nim || !name) continue;
  
      // Use Email column if provided, otherwise skip the user
      const emailRaw = row['Email Mahasiswa'] || row['Email'] || row['email'] || row['EMAIL'];
      const email = emailRaw?.trim();
  
      if (!email) {
        console.warn(`[WARNING] Missing email for NIM ${nim}. Skipping user.`);
        continue;
      }
      
      if (processedEmails.has(email)) {
        console.warn(`[WARNING] Duplicate email found in CSV: ${email} for NIM ${nim}. Skipping user to prevent crash.`);
        continue;
      }
      processedEmails.add(email);
  
      const paket = row['Paket']?.trim();
  
      // 1. Upsert Student
      await tx.user.upsert({
        where: { nim: nim },
        update: { name: name, email: email, role: 'student' },
        create: { nim: nim, name: name, email: email, role: 'student' }
      });
      usersCreated++;
  
      // 2. Add Enrollments (Skip if "Belum Commit")
      if (paket !== 'Belum Commit') {
        for (const header of courseHeaders) {
          const rawClassCode = row[header]?.trim();
          
          if (rawClassCode && rawClassCode !== '-' && rawClassCode !== '') {
            const courseInfo = courseMap.get(header);
            
            const classCodes = rawClassCode.split('/').map((c: string) => c.trim().toUpperCase()).filter(Boolean);
  
            for (const classCode of classCodes) {
              // Find the ParallelClass
              let pClass = await tx.parallelClass.findFirst({
                where: {
                  courseCode: courseInfo.courseCode,
                  classCode: classCode
                }
              });
  
              if (!pClass) {
                console.warn(`[WARNING] Missing class in schedule: ${courseInfo.courseCode} - ${classCode} (Skipping enrollment for ${nim})`);
                continue;
              }
  
              // Create Enrollment
              await tx.enrollment.upsert({
                where: {
                  nim_parallelClassId: { nim: nim, parallelClassId: pClass.id }
                },
                update: {},
                create: { nim: nim, parallelClassId: pClass.id }
              });
              enrollmentsCreated++;
            }
          }
        }
      }
    }
  }, { timeout: 30000 });

  console.log(`\n✅ Import Complete!`);
  console.log(`Imported ${usersCreated} students.`);
  console.log(`Created ${enrollmentsCreated} exact class enrollments.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
