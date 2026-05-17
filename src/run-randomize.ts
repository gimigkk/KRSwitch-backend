import { randomizeEnrollments } from './utils/seeding';

async function run() {
  try {
    const result = await randomizeEnrollments();
    console.log('Randomization complete:', result);
  } catch (error) {
    console.error('Failed:', error);
  }
}

run();
