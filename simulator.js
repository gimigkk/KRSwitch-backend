const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:5000';

// ==================== CONFIGURATION ====================

const CONFIG = {
  SIMULATION_ROUNDS: 30,
  MIN_ACTION_DELAY: 200,
  MAX_ACTION_DELAY: 1000,
  USER_BEHAVIOR_DISTRIBUTION: {
    aggressive: 0.5,   // 20% users are very active
    moderate: 0.5,     // 50% users are moderately active
    passive: 0       // 30% users are passive
  },
  RACE_CONDITION_SIMULATION: true,
  VERBOSE_LOGGING: true
};

// ==================== UTILITIES ====================

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = () => 
  CONFIG.MIN_ACTION_DELAY + Math.random() * (CONFIG.MAX_ACTION_DELAY - CONFIG.MIN_ACTION_DELAY);

const pickRandom = (array) => 
  array[Math.floor(Math.random() * array.length)];

const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.log(`❌ ${msg}`),
  warning: (msg) => console.log(`⚠️  ${msg}`),
  section: (msg) => console.log(`\n${'='.repeat(60)}\n${msg}\n${'='.repeat(60)}`),
  action: (msg) => CONFIG.VERBOSE_LOGGING && console.log(`  → ${msg}`)
};

// ==================== DATA FETCHING ====================

async function fetchData() {
  log.info('Fetching data from API...');
  
  try {
    const [usersRes, classesRes, enrollmentsRes, offersRes] = await Promise.all([
      axios.get(`${API_BASE}/api/users`),
      axios.get(`${API_BASE}/api/classes`),
      axios.get(`${API_BASE}/api/enrollments`),
      axios.get(`${API_BASE}/api/offers`)
    ]);

    const data = {
      users: usersRes.data,
      classes: classesRes.data,
      enrollments: enrollmentsRes.data,
      offers: offersRes.data
    };

    log.success(`Loaded ${data.users.length} users, ${data.classes.length} classes, ${data.enrollments.length} enrollments`);
    return data;
  } catch (error) {
    log.error('Failed to fetch data from API');
    throw error;
  }
}

// ==================== BARTER LOGIC ====================

function findValidBarterPairs(classes, enrollments) {
  const pairs = [];

  // Index enrollments by user
  const enrollmentsByUser = new Map();
  enrollments.forEach(e => {
    if (!enrollmentsByUser.has(e.nim)) {
      enrollmentsByUser.set(e.nim, []);
    }
    enrollmentsByUser.get(e.nim).push(e.parallelClassId);
  });

  // Index classes by course
  const classesByCourse = new Map();
  classes.forEach(c => {
    if (!classesByCourse.has(c.courseCode)) {
      classesByCourse.set(c.courseCode, []);
    }
    classesByCourse.get(c.courseCode).push(c);
  });

  // Find all valid pairs
  classesByCourse.forEach((courseClasses, courseCode) => {
    // Group by class type (K, P, R)
    const typeGroups = new Map();
    courseClasses.forEach(c => {
      const type = c.classCode[0];
      if (!typeGroups.has(type)) {
        typeGroups.set(type, []);
      }
      typeGroups.get(type).push(c);
    });

    // For each type group, find all possible swaps
    typeGroups.forEach(group => {
      if (group.length < 2) return;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const class1 = group[i];
          const class2 = group[j];

          // Find users enrolled in these classes
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
                courseCode,
                courseName: class1.courseName,
                class1Code: class1.classCode,
                class2Code: class2.classCode
              });
            });
          });
        }
      }
    });
  });

  return pairs;
}

// ==================== USER BEHAVIOR MODELING ====================

function assignUserBehaviors(users) {
  const behaviors = new Map();
  
  users.forEach(user => {
    const rand = Math.random();
    let type;
    let offerProb;
    let acceptProb;
    let cancelProb;

    if (rand < CONFIG.USER_BEHAVIOR_DISTRIBUTION.aggressive) {
      type = 'aggressive';
      offerProb = 0.7;
      acceptProb = 0.8;
      cancelProb = 0.1;
    } else if (rand < CONFIG.USER_BEHAVIOR_DISTRIBUTION.aggressive + CONFIG.USER_BEHAVIOR_DISTRIBUTION.moderate) {
      type = 'moderate';
      offerProb = 0.4;
      acceptProb = 0.5;
      cancelProb = 0.2;
    } else {
      type = 'passive';
      offerProb = 0.15;
      acceptProb = 0.3;
      cancelProb = 0.05;
    }

    behaviors.set(user.nim, {
      nim: user.nim,
      type,
      offerProbability: offerProb,
      acceptProbability: acceptProb,
      cancelProbability: cancelProb,
      actionsPerformed: 0
    });
  });

  return behaviors;
}

// ==================== API ACTIONS ====================

async function createOffer(offererNim, myClassId, wantedClassId, pair) {
  try {
    const res = await axios.post(`${API_BASE}/api/offers`, {
      offererNim,
      myClassId,
      wantedClassId
    });
    
    log.success(`${offererNim} offered ${pair.courseName} ${pair.class1Code} → ${pair.class2Code}`);
    return res.data;
  } catch (error) {
    log.error(`Create offer failed: ${error.response?.data?.error || error.message}`);
    return null;
  }
}

async function acceptOffer(offerId, takerNim, offerDetails) {
  try {
    await axios.post(`${API_BASE}/api/offers/${offerId}/take`, { takerNim });
    log.success(`${takerNim} accepted offer #${offerId}${offerDetails ? ` (${offerDetails})` : ''}`);
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    
    if (errorMsg.includes('already taken')) {
      log.warning(`Race condition: ${takerNim} lost to another user on offer #${offerId}`);
      return false;
    }
    
    log.error(`Accept offer #${offerId} failed: ${errorMsg}`);
    return false;
  }
}

// ==================== SIMULATION ENGINE ====================

async function runSimulation() {
  const startTime = Date.now();
  const stats = {
    totalActions: 0,
    offersCreated: 0,
    offersAccepted: 0,
    offersCancelled: 0,
    failedAttempts: 0,
    raceConditionLosses: 0,
    duration: 0
  };

  log.section('🚀 STARTING REALISTIC BARTER SIMULATION');
  
  // Fetch initial data
  const data = await fetchData();
  const validPairs = findValidBarterPairs(data.classes, data.enrollments);
  
  if (validPairs.length === 0) {
    log.error('No valid barter pairs found. Aborting.');
    return;
  }

  log.success(`Found ${validPairs.length} valid barter opportunities`);
  
  // Assign behaviors to users
  const userBehaviors = assignUserBehaviors(data.users);
  const behaviorCounts = {
    aggressive: Array.from(userBehaviors.values()).filter(b => b.type === 'aggressive').length,
    moderate: Array.from(userBehaviors.values()).filter(b => b.type === 'moderate').length,
    passive: Array.from(userBehaviors.values()).filter(b => b.type === 'passive').length
  };
  
  log.info(`User behaviors: ${behaviorCounts.aggressive} aggressive, ${behaviorCounts.moderate} moderate, ${behaviorCounts.passive} passive`);
  log.section(`Running ${CONFIG.SIMULATION_ROUNDS} simulation rounds`);

  // Track created offers
  const createdOffers = [];
  
  // Simulation loop
  for (let round = 1; round <= CONFIG.SIMULATION_ROUNDS; round++) {
    log.info(`\n--- Round ${round}/${CONFIG.SIMULATION_ROUNDS} ---`);
    
    // Randomly decide: create new offer or accept existing?
    const action = Math.random() < 0.6 ? 'create' : 'accept';
    
    if (action === 'create') {
      // Find a user who wants to create an offer
      const pair = pickRandom(validPairs);
      const behavior = userBehaviors.get(pair.user1);
      
      if (!behavior || Math.random() > behavior.offerProbability) {
        log.action(`${pair.user1} (${behavior?.type}) decided not to create offer`);
        stats.totalActions++;
        await wait(randomDelay());
        continue;
      }

      // Create the offer
      stats.totalActions++;
      const offer = await createOffer(pair.user1, pair.class1Id, pair.class2Id, pair);
      
      if (offer) {
        stats.offersCreated++;
        createdOffers.push({ id: offer.id, offererNim: pair.user1, pair });
        behavior.actionsPerformed++;
      } else {
        stats.failedAttempts++;
      }
      
    } else {
      // Try to accept an existing offer
      if (createdOffers.length === 0) {
        log.action('No offers available to accept');
        await wait(randomDelay());
        continue;
      }

      const offerToAccept = pickRandom(createdOffers);
      const potentialTaker = offerToAccept.pair.user2;
      const behavior = userBehaviors.get(potentialTaker);
      
      if (!behavior || Math.random() > behavior.acceptProbability) {
        log.action(`${potentialTaker} (${behavior?.type}) browsed but didn't accept`);
        stats.totalActions++;
        await wait(randomDelay());
        continue;
      }

      // Simulate race condition by occasionally having multiple users accept
      const raceCondition = CONFIG.RACE_CONDITION_SIMULATION && Math.random() < 0.15;
      
      if (raceCondition) {
        log.warning(`Race condition scenario: Multiple users racing for offer #${offerToAccept.id}`);
        
        // Simulate 2-3 users trying simultaneously
        const racers = [potentialTaker];
        const otherPotentialTakers = validPairs
          .filter(p => p.class1Id === offerToAccept.pair.class2Id && p.user1 !== potentialTaker)
          .map(p => p.user1)
          .slice(0, 2);
        
        racers.push(...otherPotentialTakers);
        
        const acceptPromises = racers.map(async (racer, idx) => {
          if (idx > 0) await wait(Math.random() * 200); // Slight stagger
          return { racer, success: await acceptOffer(offerToAccept.id, racer, `${offerToAccept.pair.courseName}`) };
        });
        
        const results = await Promise.all(acceptPromises);
        const winners = results.filter(r => r.success);
        const losers = results.filter(r => !r.success);
        
        stats.totalActions += racers.length;
        
        if (winners.length > 0) {
          stats.offersAccepted++;
          userBehaviors.get(winners[0].racer).actionsPerformed++;
          createdOffers.splice(createdOffers.indexOf(offerToAccept), 1);
        }
        
        stats.raceConditionLosses += losers.length;
        
      } else {
        // Normal single acceptance
        stats.totalActions++;
        const success = await acceptOffer(
          offerToAccept.id, 
          potentialTaker,
          `${offerToAccept.pair.courseName} ${offerToAccept.pair.class2Code} → ${offerToAccept.pair.class1Code}`
        );
        
        if (success) {
          stats.offersAccepted++;
          behavior.actionsPerformed++;
          createdOffers.splice(createdOffers.indexOf(offerToAccept), 1);
        } else {
          stats.failedAttempts++;
        }
      }
    }
    
    await wait(randomDelay());
  }

  // Final statistics
  stats.duration = Date.now() - startTime;
  
  log.section('📊 SIMULATION COMPLETE');
  console.log(`
Duration: ${(stats.duration / 1000).toFixed(2)}s
Total Actions: ${stats.totalActions}
Offers Created: ${stats.offersCreated}
Offers Accepted: ${stats.offersAccepted}
Offers Cancelled: ${stats.offersCancelled}
Failed Attempts: ${stats.failedAttempts}
Race Losses: ${stats.raceConditionLosses}
Success Rate: ${((stats.offersAccepted / (stats.offersAccepted + stats.failedAttempts)) * 100).toFixed(1)}%
  `);

  // Top users by activity
  const topUsers = Array.from(userBehaviors.values())
    .filter(b => b.actionsPerformed > 0)
    .sort((a, b) => b.actionsPerformed - a.actionsPerformed)
    .slice(0, 10);
  
  if (topUsers.length > 0) {
    log.section('🏆 Most Active Users');
    topUsers.forEach((user, idx) => {
      console.log(`${idx + 1}. ${user.nim} (${user.type}): ${user.actionsPerformed} actions`);
    });
  }
}

// ==================== MAIN ====================

runSimulation()
  .then(() => {
    log.success('\n✨ Simulation completed successfully');
    process.exit(0);
  })
  .catch(error => {
    log.error(`\n💥 Simulation failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  });