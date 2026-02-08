import axios from 'axios';

const API_BASE = 'http://localhost:5000';

interface User {
  nim: string;
  name: string;
}

interface ParallelClass {
  id: number;
  courseCode: string;
  courseName: string;
  classCode: string;
}

interface Enrollment {
  id: number;
  nim: string;
  parallelClassId: number;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchData() {
  const [usersRes, classesRes, enrollmentsRes] = await Promise.all([
    axios.get(`${API_BASE}/api/users`),
    axios.get(`${API_BASE}/api/classes`),
    axios.get(`${API_BASE}/api/enrollments`)
  ]);

  return {
    users: usersRes.data as User[],
    classes: classesRes.data as ParallelClass[],
    enrollments: enrollmentsRes.data as Enrollment[]
  };
}

function findValidBarterPairs(classes: ParallelClass[], enrollments: Enrollment[]) {
  const pairs: Array<{
    user1: string;
    user2: string;
    class1Id: number;
    class2Id: number;
    courseCode: string;
  }> = [];

  const enrollmentsByUser = new Map<string, number[]>();
  enrollments.forEach(e => {
    if (!enrollmentsByUser.has(e.nim)) {
      enrollmentsByUser.set(e.nim, []);
    }
    enrollmentsByUser.get(e.nim)!.push(e.parallelClassId);
  });

  const classesByCourse = new Map<string, ParallelClass[]>();
  classes.forEach(c => {
    if (!classesByCourse.has(c.courseCode)) {
      classesByCourse.set(c.courseCode, []);
    }
    classesByCourse.get(c.courseCode)!.push(c);
  });

  classesByCourse.forEach((courseClasses, courseCode) => {
    const sameTypeGroups = new Map<string, ParallelClass[]>();
    courseClasses.forEach(c => {
      const type = c.classCode[0];
      if (!sameTypeGroups.has(type)) {
        sameTypeGroups.set(type, []);
      }
      sameTypeGroups.get(type)!.push(c);
    });

    sameTypeGroups.forEach(group => {
      if (group.length < 2) return;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const class1 = group[i];
          const class2 = group[j];

          enrollmentsByUser.forEach((classIds, nim1) => {
            if (!classIds.includes(class1.id)) return;

            enrollmentsByUser.forEach((otherClassIds, nim2) => {
              if (nim1 === nim2) return;
              if (!otherClassIds.includes(class2.id)) return;

              pairs.push({
                user1: nim1,
                user2: nim2,
                class1Id: class1.id,
                class2Id: class2.id,
                courseCode
              });
            });
          });
        }
      }
    });
  });

  return pairs;
}

async function createOffer(offererNim: string, myClassId: number, wantedClassId: number) {
  try {
    const res = await axios.post(`${API_BASE}/api/offers`, {
      offererNim,
      myClassId,
      wantedClassId
    });
    console.log(`✅ Offer created by ${offererNim}: ${myClassId} → ${wantedClassId}`);
    return res.data;
  } catch (error: any) {
    console.error(`❌ Failed to create offer: ${error.response?.data?.error || error.message}`);
    return null;
  }
}

async function takeOffer(offerId: number, takerNim: string) {
  try {
    await axios.post(`${API_BASE}/api/offers/${offerId}/take`, { takerNim });
    console.log(`✅ Offer ${offerId} accepted by ${takerNim}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to take offer: ${error.response?.data?.error || error.message}`);
    return false;
  }
}

async function simulate() {
  console.log('🔄 Fetching data...');
  const data = await fetchData();
  
  console.log(`📊 Found ${data.users.length} users, ${data.classes.length} classes, ${data.enrollments.length} enrollments`);
  
  const validPairs = findValidBarterPairs(data.classes, data.enrollments);
  console.log(`🎯 Found ${validPairs.length} valid barter pairs`);

  if (validPairs.length === 0) {
    console.log('❌ No valid barter pairs found. Check your seed data.');
    return;
  }

  const iterations = 5;
  console.log(`\n🚀 Starting ${iterations} simulated barters...\n`);

  for (let i = 0; i < iterations; i++) {
    const pair = validPairs[Math.floor(Math.random() * validPairs.length)];
    
    console.log(`\n--- Barter ${i + 1}/${iterations} ---`);
    console.log(`Course: ${pair.courseCode}`);
    console.log(`${pair.user1} wants class ${pair.class2Id}`);
    console.log(`${pair.user2} wants class ${pair.class1Id}`);

    const offer = await createOffer(pair.user1, pair.class1Id, pair.class2Id);
    
    if (offer) {
      await wait(1000 + Math.random() * 2000);
      await takeOffer(offer.id, pair.user2);
    }

    await wait(2000 + Math.random() * 3000);
  }

  console.log('\n✨ Simulation complete!');
}

simulate().catch(console.error);