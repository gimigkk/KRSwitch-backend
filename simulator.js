const axios = require('axios');

// ============================================================================
// ANSI COLOR CODES
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  red: '\x1b[91m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  blue: '\x1b[94m',
  cyan: '\x1b[96m'
};

const c = {
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  red: (text) => `${colors.red}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  blue: (text) => `${colors.blue}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  bold: (text) => `${colors.bold}${text}${colors.reset}`,
  boldCyan: (text) => `${colors.bold}${colors.cyan}${text}${colors.reset}`,
  boldWhite: (text) => `${colors.bold}${text}${colors.reset}`
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // API Configuration
  API_BASE: process.env.API_BASE || 'http://localhost:5000',
  
  // Simulation Parameters
  DURATION_SECONDS: 120,          // Total simulation duration
  RAMP_UP_SECONDS: 20,            // Time to reach peak load
  CONCURRENT_USERS: 20,           // Peak concurrent users
  
  // User Behavior Distribution
  USER_PERSONAS: {
    aggressive: 0.15,             // 15% - Very active, quick decisions
    moderate: 0.40,               // 40% - Normal activity
    passive: 0.30,                // 30% - Slow, cautious
    lurker: 0.15                  // 15% - Mostly browse, rarely act
  },
  
  // Timing Configuration (in milliseconds)
  THINK_TIME: {
    min: 500,
    max: 3000,
    aggressive: { min: 200, max: 1000 },
    moderate: { min: 500, max: 2500 },
    passive: { min: 1000, max: 4000 },
    lurker: { min: 2000, max: 6000 }
  },
  
  // Action Probabilities by Persona
  // REALISTIC MARKETPLACE BEHAVIOR: Most users browse and take offers
  // Only a small fraction create new offers (roughly 10:1 take/create ratio)
  PROBABILITIES: {
    aggressive: { create: 0.08, accept: 0.85, browse: 0.95 },
    moderate: { create: 0.05, accept: 0.65, browse: 0.80 },
    passive: { create: 0.03, accept: 0.45, browse: 0.70 },
    lurker: { create: 0.01, accept: 0.20, browse: 0.95 }
  },
  
  // Data Refresh
  DATA_REFRESH_INTERVAL_MS: 5000, // Refresh every 5 seconds
  
  // Concurrency Simulation
  RACE_CONDITION_PROBABILITY: 0.20, // 20% chance of simulated race
  
  // Retry Configuration
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: 1000,
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  SHOW_TIMESTAMPS: true
};

// ============================================================================
// UTILITIES
// ============================================================================

class Logger {
  constructor(level = 'info') {
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.currentLevel = this.levels[level] || 1;
  }
  
  _log(level, icon, color, message, data = null) {
    if (this.levels[level] < this.currentLevel) return;
    
    const timestamp = CONFIG.SHOW_TIMESTAMPS 
      ? c.gray(`[${new Date().toISOString().substr(11, 12)}]`)
      : '';
    
    const formatted = `${timestamp} ${icon} ${color(message)}`;
    console.log(formatted);
    
    if (data) {
      console.log(c.gray('  └─'), data);
    }
  }
  
  debug(msg, data) { this._log('debug', '🔍', c.gray, msg, data); }
  info(msg, data) { this._log('info', 'ℹ️ ', c.blue, msg, data); }
  success(msg, data) { this._log('info', '✅', c.green, msg, data); }
  warn(msg, data) { this._log('warn', '⚠️ ', c.yellow, msg, data); }
  error(msg, data) { this._log('error', '❌', c.red, msg, data); }
  
  section(title) {
    if (this.currentLevel > 1) return;
    console.log('\n' + c.boldCyan('═'.repeat(70)));
    console.log(c.boldCyan(`  ${title}`));
    console.log(c.boldCyan('═'.repeat(70)) + '\n');
  }
  
  metric(label, value, unit = '') {
    if (this.currentLevel > 1) return;
    const paddedLabel = label.padEnd(30, '.');
    console.log(`  ${c.gray(paddedLabel)} ${c.boldWhite(value)}${unit}`);
  }
}

const logger = new Logger(CONFIG.LOG_LEVEL);

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const randomChoice = (array) => array[Math.floor(Math.random() * array.length)];

const getThinkTime = (persona) => {
  const config = CONFIG.THINK_TIME[persona] || CONFIG.THINK_TIME;
  return randomInt(config.min, config.max);
};

// ============================================================================
// STATE MANAGER
// ============================================================================

class StateManager {
  constructor(apiBase) {
    this.apiBase = apiBase;
    this.state = {
      users: [],
      classes: [],
      enrollments: [],
      offers: [],
      validPairs: [],
      lastUpdate: null
    };
    this.isRefreshing = false;
  }
  
  async initialize() {
    logger.info('Initializing state manager...');
    await this.refresh();
    logger.success(`Loaded ${this.state.users.length} users, ${this.state.classes.length} classes`);
  }
  
  async refresh() {
    if (this.isRefreshing) {
      logger.debug('Refresh already in progress, skipping');
      return;
    }
    
    this.isRefreshing = true;
    try {
      const [usersRes, classesRes, enrollmentsRes, offersRes] = await Promise.all([
        axios.get(`${this.apiBase}/api/users`),
        axios.get(`${this.apiBase}/api/classes`),
        axios.get(`${this.apiBase}/api/enrollments`),
        axios.get(`${this.apiBase}/api/offers`)
      ]);
      
      this.state.users = usersRes.data;
      this.state.classes = classesRes.data;
      this.state.enrollments = enrollmentsRes.data;
      this.state.offers = offersRes.data;
      this.state.validPairs = this._calculateValidPairs();
      this.state.lastUpdate = Date.now();
      
      logger.debug(`Refreshed state: ${this.state.offers.length} active offers, ${this.state.validPairs.length} valid pairs`);
    } catch (error) {
      logger.error('Failed to refresh state', error.message);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }
  
  _calculateValidPairs() {
    const pairs = [];
    const enrollmentsByUser = new Map();
    
    // Index enrollments by user
    this.state.enrollments.forEach(e => {
      if (!enrollmentsByUser.has(e.nim)) {
        enrollmentsByUser.set(e.nim, []);
      }
      enrollmentsByUser.get(e.nim).push(e.parallelClassId);
    });
    
    // Index classes by course
    const classesByCourse = new Map();
    this.state.classes.forEach(c => {
      if (!classesByCourse.has(c.courseCode)) {
        classesByCourse.set(c.courseCode, []);
      }
      classesByCourse.get(c.courseCode).push(c);
    });
    
    // Find valid swap pairs
    classesByCourse.forEach((courseClasses, courseCode) => {
      const byType = new Map();
      courseClasses.forEach(c => {
        const type = c.classCode[0];
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push(c);
      });
      
      byType.forEach(group => {
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
                
                // Create BOTH directions of the swap
                // Direction 1: nim1 (has class1) swaps with nim2 (has class2)
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
                
                // Direction 2: nim2 (has class2) swaps with nim1 (has class1)
                pairs.push({
                  user1: nim2,
                  user2: nim1,
                  class1Id: class2.id,
                  class2Id: class1.id,
                  courseCode,
                  courseName: class1.courseName,
                  class1Code: class2.classCode,
                  class2Code: class1.classCode
                });
              });
            });
          }
        }
      });
    });
    
    return pairs;
  }
  
  getState() {
    return this.state;
  }
  
  getRandomUser() {
    return randomChoice(this.state.users);
  }
  
  getRandomPair() {
    return randomChoice(this.state.validPairs);
  }
  
  getRandomOffer() {
    return randomChoice(this.state.offers);
  }
  
  getPotentialTakers(offer) {
    return this.state.validPairs
      .filter(p => 
        p.class1Id === offer.wantedClassId && 
        p.class2Id === offer.myClassId &&
        p.user1 !== offer.offererNim
      )
      .map(p => p.user1);
  }
}

// ============================================================================
// METRICS COLLECTOR
// ============================================================================

class MetricsCollector {
  constructor() {
    this.metrics = {
      startTime: Date.now(),
      endTime: null,
      
      // Action counts
      totalActions: 0,
      browseActions: 0,
      createAttempts: 0,
      acceptAttempts: 0,
      
      // Outcomes
      offersCreated: 0,
      offersAccepted: 0,
      raceConditionLosses: 0,
      validationFailures: 0,
      networkErrors: 0,
      
      // Timing
      responseTimesMs: [],
      thinkTimesMs: [],
      
      // Per-persona stats
      byPersona: {
        aggressive: { actions: 0, created: 0, accepted: 0, browsed: 0 },
        moderate: { actions: 0, created: 0, accepted: 0, browsed: 0 },
        passive: { actions: 0, created: 0, accepted: 0, browsed: 0 },
        lurker: { actions: 0, created: 0, accepted: 0, browsed: 0 }
      },
      
      // Concurrency
      concurrentUsers: 0,
      peakConcurrentUsers: 0
    };
  }
  
  recordAction(action, persona = null) {
    this.metrics.totalActions++;
    if (persona && this.metrics.byPersona[persona]) {
      this.metrics.byPersona[persona].actions++;
    }
  }
  
  recordBrowse(persona) {
    this.metrics.browseActions++;
    if (this.metrics.byPersona[persona]) {
      this.metrics.byPersona[persona].browsed++;
    }
  }
  
  recordCreateAttempt(persona, success) {
    this.metrics.createAttempts++;
    if (success) {
      this.metrics.offersCreated++;
      if (this.metrics.byPersona[persona]) {
        this.metrics.byPersona[persona].created++;
      }
    }
  }
  
  recordAcceptAttempt(persona, result) {
    this.metrics.acceptAttempts++;
    if (result.success) {
      this.metrics.offersAccepted++;
      if (this.metrics.byPersona[persona]) {
        this.metrics.byPersona[persona].accepted++;
      }
    } else if (result.raceCondition) {
      this.metrics.raceConditionLosses++;
    } else if (result.validationError) {
      this.metrics.validationFailures++;
    }
  }
  
  recordResponseTime(ms) {
    this.metrics.responseTimesMs.push(ms);
  }
  
  recordThinkTime(ms) {
    this.metrics.thinkTimesMs.push(ms);
  }
  
  recordNetworkError() {
    this.metrics.networkErrors++;
  }
  
  updateConcurrency(delta) {
    this.metrics.concurrentUsers += delta;
    if (this.metrics.concurrentUsers > this.metrics.peakConcurrentUsers) {
      this.metrics.peakConcurrentUsers = this.metrics.concurrentUsers;
    }
  }
  
  finish() {
    this.metrics.endTime = Date.now();
  }
  
  getReport() {
    const duration = (this.metrics.endTime - this.metrics.startTime) / 1000;
    const avgResponse = this.metrics.responseTimesMs.length > 0
      ? this.metrics.responseTimesMs.reduce((a, b) => a + b, 0) / this.metrics.responseTimesMs.length
      : 0;
    const avgThink = this.metrics.thinkTimesMs.length > 0
      ? this.metrics.thinkTimesMs.reduce((a, b) => a + b, 0) / this.metrics.thinkTimesMs.length
      : 0;
    
    const p95Response = this._percentile(this.metrics.responseTimesMs, 95);
    const p99Response = this._percentile(this.metrics.responseTimesMs, 99);
    
    const successRate = this.metrics.acceptAttempts > 0
      ? (this.metrics.offersAccepted / this.metrics.acceptAttempts * 100).toFixed(1)
      : 0;
    
    const takeToOfferRatio = this.metrics.offersCreated > 0
      ? (this.metrics.acceptAttempts / this.metrics.createAttempts).toFixed(2)
      : 0;
    
    return {
      duration,
      totalActions: this.metrics.totalActions,
      actionsPerSecond: (this.metrics.totalActions / duration).toFixed(2),
      
      offersCreated: this.metrics.offersCreated,
      offersAccepted: this.metrics.offersAccepted,
      raceConditionLosses: this.metrics.raceConditionLosses,
      validationFailures: this.metrics.validationFailures,
      networkErrors: this.metrics.networkErrors,
      
      browseActions: this.metrics.browseActions,
      createAttempts: this.metrics.createAttempts,
      acceptAttempts: this.metrics.acceptAttempts,
      successRate: `${successRate}%`,
      takeToOfferRatio,
      
      avgResponseTimeMs: avgResponse.toFixed(2),
      p95ResponseTimeMs: p95Response.toFixed(2),
      p99ResponseTimeMs: p99Response.toFixed(2),
      avgThinkTimeMs: avgThink.toFixed(2),
      
      peakConcurrentUsers: this.metrics.peakConcurrentUsers,
      byPersona: this.metrics.byPersona
    };
  }
  
  _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// ============================================================================
// USER SIMULATOR
// ============================================================================

class UserSimulator {
  constructor(userId, persona, stateManager, apiBase, metricsCollector) {
    this.userId = userId;
    this.persona = persona;
    this.stateManager = stateManager;
    this.apiBase = apiBase;
    this.metrics = metricsCollector;
    this.isActive = false;
  }
  
  async start() {
    this.isActive = true;
    this.metrics.updateConcurrency(1);
    
    try {
      while (this.isActive) {
        await this._performAction();
        const thinkTime = getThinkTime(this.persona);
        this.metrics.recordThinkTime(thinkTime);
        await sleep(thinkTime);
      }
    } finally {
      this.metrics.updateConcurrency(-1);
    }
  }
  
  stop() {
    this.isActive = false;
  }
  
  async _performAction() {
    const state = this.stateManager.getState();
    const probs = CONFIG.PROBABILITIES[this.persona];
    const rand = Math.random();
    
    this.metrics.recordAction('any', this.persona);
    
    // Decide action based on persona probabilities
    if (rand < (1 - probs.browse)) {
      // User doesn't even browse
      logger.debug(`[${this.userId}] ${this.persona} user idle`);
      return;
    }
    
    // Browse offers
    this.metrics.recordBrowse(this.persona);
    logger.debug(`[${this.userId}] ${this.persona} browsing offers`);
    
    // REALISTIC DECISION LOGIC: Heavily favor accepting over creating
    // If offers exist, users are much more likely to try accepting
    const offerSupply = state.offers.length;
    
    // Increase acceptance probability when many offers are available
    let acceptProb = probs.accept;
    if (offerSupply > 10) {
      acceptProb = Math.min(0.95, acceptProb * 1.3); // Boost by 30%
    }
    
    // Decrease creation probability when many offers exist
    let createProb = probs.create;
    if (offerSupply > 5) {
      createProb = createProb * 0.5; // Cut in half
    }
    
    const shouldAccept = offerSupply > 0 && Math.random() < acceptProb;
    const shouldCreate = state.validPairs.length > 0 && Math.random() < createProb;
    
    // Priority: Accept first (if possible), create only if not accepting
    if (shouldAccept) {
      await this._acceptOffer();
    } else if (shouldCreate) {
      await this._createOffer();
    }
  }
  
  async _createOffer() {
    const pair = this.stateManager.getRandomPair();
    if (!pair) {
      logger.debug(`[${this.userId}] No valid pairs available`);
      return;
    }
    
    const startTime = Date.now();
    const result = await this._apiCall(
      'POST',
      '/api/offers',
      {
        offererNim: pair.user1,
        myClassId: pair.class1Id,
        wantedClassId: pair.class2Id
      }
    );
    
    this.metrics.recordResponseTime(Date.now() - startTime);
    const success = result && !result.error;
    this.metrics.recordCreateAttempt(this.persona, success);
    
    if (success) {
      logger.success(`[${this.userId}] Created offer: ${pair.courseName} ${pair.class1Code} → ${pair.class2Code}`);
    } else {
      logger.debug(`[${this.userId}] Failed to create offer: ${result?.error || 'Unknown error'}`);
    }
  }
  
  async _acceptOffer() {
    const offer = this.stateManager.getRandomOffer();
    if (!offer) {
      logger.debug(`[${this.userId}] No offers available`);
      return;
    }
    
    const potentialTakers = this.stateManager.getPotentialTakers(offer);
    if (potentialTakers.length === 0) {
      logger.debug(`[${this.userId}] No valid takers for offer #${offer.id}`);
      return;
    }
    
    const taker = randomChoice(potentialTakers);
    
    // Simulate race condition
    const shouldRace = Math.random() < CONFIG.RACE_CONDITION_PROBABILITY;
    if (shouldRace && potentialTakers.length > 1) {
      await this._simulateRaceCondition(offer, potentialTakers);
      return;
    }
    
    const startTime = Date.now();
    const result = await this._apiCall(
      'POST',
      `/api/offers/${offer.id}/take`,
      { takerNim: taker }
    );
    
    this.metrics.recordResponseTime(Date.now() - startTime);
    
    const outcome = {
      success: result && !result.error,
      raceCondition: result?.error?.includes('already taken'),
      validationError: result?.error && !result.error.includes('already taken')
    };
    
    this.metrics.recordAcceptAttempt(this.persona, outcome);
    
    if (outcome.success) {
      logger.success(`[${this.userId}] Accepted offer #${offer.id}`);
    } else if (outcome.raceCondition) {
      logger.warn(`[${this.userId}] Lost race condition on offer #${offer.id}`);
    } else {
      logger.debug(`[${this.userId}] Failed to accept offer #${offer.id}: ${result?.error}`);
    }
  }
  
  async _simulateRaceCondition(offer, potentialTakers) {
    logger.info(`[${this.userId}] Simulating race condition on offer #${offer.id}`);
    
    const numRacers = Math.min(randomInt(2, 4), potentialTakers.length);
    const racers = potentialTakers.slice(0, numRacers);
    
    const promises = racers.map((taker, idx) => {
      return new Promise(async (resolve) => {
        // Stagger requests slightly
        await sleep(randomInt(0, 100));
        
        const startTime = Date.now();
        const result = await this._apiCall(
          'POST',
          `/api/offers/${offer.id}/take`,
          { takerNim: taker }
        );
        
        this.metrics.recordResponseTime(Date.now() - startTime);
        
        const outcome = {
          success: result && !result.error,
          raceCondition: result?.error?.includes('already taken'),
          validationError: result?.error && !result.error.includes('already taken')
        };
        
        this.metrics.recordAcceptAttempt(this.persona, outcome);
        resolve(outcome);
      });
    });
    
    const results = await Promise.all(promises);
    const winners = results.filter(r => r.success);
    const losers = results.filter(r => r.raceCondition);
    
    logger.info(`[${this.userId}] Race result: ${winners.length} won, ${losers.length} lost`);
  }
  
  async _apiCall(method, path, data = null, retries = CONFIG.MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const config = {
          method,
          url: `${this.apiBase}${path}`,
          ...(data && { data })
        };
        
        const response = await axios(config);
        return response.data;
      } catch (error) {
        const errorMsg = error.response?.data?.error || error.message;
        
        // Don't retry on expected errors
        if (errorMsg.includes('already has an active offer') ||
            errorMsg.includes('already taken') ||
            errorMsg.includes('not enrolled') ||
            errorMsg.includes('cannot take your own')) {
          return { error: errorMsg };
        }
        
        // Retry on network/server errors
        if (attempt < retries) {
          const backoff = CONFIG.RETRY_BACKOFF_MS * attempt;
          logger.debug(`[${this.userId}] Retry ${attempt}/${retries} after ${backoff}ms: ${errorMsg}`);
          await sleep(backoff);
        } else {
          this.metrics.recordNetworkError();
          logger.error(`[${this.userId}] API call failed after ${retries} attempts`);
          return { error: errorMsg };
        }
      }
    }
    
    return { error: 'Max retries exceeded' };
  }
}

// ============================================================================
// LOAD PROFILE GENERATOR
// ============================================================================

class LoadProfile {
  static rampUp(duration, target) {
    // Gradually increase from 0 to target over duration
    const intervals = [];
    const steps = 10;
    const stepDuration = duration / steps;
    
    for (let i = 1; i <= steps; i++) {
      intervals.push({
        users: Math.floor((i / steps) * target),
        duration: stepDuration
      });
    }
    
    return intervals;
  }
  
  static steady(duration, users) {
    return [{ users, duration }];
  }
  
  static spike(duration, baseline, spike) {
    return [
      { users: baseline, duration: duration * 0.3 },
      { users: spike, duration: duration * 0.2 },
      { users: baseline, duration: duration * 0.5 }
    ];
  }
}

// ============================================================================
// SIMULATOR ORCHESTRATOR
// ============================================================================

class SimulatorOrchestrator {
  constructor(config) {
    this.config = config;
    this.stateManager = new StateManager(config.API_BASE);
    this.metrics = new MetricsCollector();
    this.activeUsers = [];
    this.stopRequested = false;
    this.refreshInterval = null;
  }
  
  async run() {
    try {
      logger.section('🚀 STARTING CLASS BARTER LOAD SIMULATOR');
      
      // Initialize
      await this.stateManager.initialize();
      
      if (this.stateManager.getState().validPairs.length === 0) {
        logger.error('No valid barter pairs found. Cannot run simulation.');
        return;
      }
      
      logger.info(`Found ${this.stateManager.getState().validPairs.length} valid barter pairs`);
      
      // Start periodic data refresh
      this.refreshInterval = setInterval(
        () => this.stateManager.refresh(),
        CONFIG.DATA_REFRESH_INTERVAL_MS
      );
      
      // Display configuration
      this._displayConfig();
      
      // Run simulation
      logger.section('📊 SIMULATION IN PROGRESS');
      await this._runLoadProfile();
      
      // Cleanup
      clearInterval(this.refreshInterval);
      this.metrics.finish();
      
      // Report results
      this._displayReport();
      
      logger.success('Simulation completed successfully');
      
    } catch (error) {
      logger.error('Simulation failed', error.message);
      throw error;
    }
  }
  
  _displayConfig() {
    logger.section('⚙️  CONFIGURATION');
    logger.metric('API Base', CONFIG.API_BASE);
    logger.metric('Duration', CONFIG.DURATION_SECONDS, 's');
    logger.metric('Ramp-up Time', CONFIG.RAMP_UP_SECONDS, 's');
    logger.metric('Peak Concurrent Users', CONFIG.CONCURRENT_USERS);
    logger.metric('Data Refresh Interval', CONFIG.DATA_REFRESH_INTERVAL_MS / 1000, 's');
    logger.metric('Race Condition Probability', (CONFIG.RACE_CONDITION_PROBABILITY * 100).toFixed(0), '%');
    
    console.log('\n  ' + c.bold('User Persona Distribution:'));
    Object.entries(CONFIG.USER_PERSONAS).forEach(([persona, pct]) => {
      logger.metric(`  ${persona}`, (pct * 100).toFixed(0), '%');
    });
  }
  
  async _runLoadProfile() {
    const rampUpDuration = CONFIG.RAMP_UP_SECONDS * 1000;
    const steadyDuration = (CONFIG.DURATION_SECONDS - CONFIG.RAMP_UP_SECONDS) * 1000;
    
    // Ramp-up phase
    logger.info(`Starting ramp-up phase (${CONFIG.RAMP_UP_SECONDS}s)`);
    const rampUpProfile = LoadProfile.rampUp(rampUpDuration, CONFIG.CONCURRENT_USERS);
    
    for (const interval of rampUpProfile) {
      if (this.stopRequested) break;
      
      const toAdd = interval.users - this.activeUsers.length;
      if (toAdd > 0) {
        for (let i = 0; i < toAdd; i++) {
          this._addUser();
        }
      }
      
      logger.info(`Current load: ${this.activeUsers.length} concurrent users`);
      await sleep(interval.duration);
    }
    
    // Steady state
    logger.info(`Entering steady state phase (${CONFIG.DURATION_SECONDS - CONFIG.RAMP_UP_SECONDS}s)`);
    logger.info(`Maintaining ${CONFIG.CONCURRENT_USERS} concurrent users`);
    
    const startSteady = Date.now();
    const updateInterval = 10000; // Update every 10s
    
    while (Date.now() - startSteady < steadyDuration && !this.stopRequested) {
      await sleep(updateInterval);
      
      const elapsed = Math.floor((Date.now() - startSteady) / 1000);
      const remaining = Math.floor((steadyDuration - (Date.now() - startSteady)) / 1000);
      logger.info(`Progress: ${elapsed}s elapsed, ${remaining}s remaining | ${this.metrics.metrics.totalActions} actions performed`);
    }
    
    // Shutdown
    logger.info('Shutting down user simulators...');
    this.activeUsers.forEach(user => user.stop());
    
    // Wait for users to finish
    await sleep(2000);
  }
  
  _addUser() {
    const userId = `user-${this.activeUsers.length + 1}`;
    const persona = this._selectPersona();
    
    const user = new UserSimulator(
      userId,
      persona,
      this.stateManager,
      CONFIG.API_BASE,
      this.metrics
    );
    
    this.activeUsers.push(user);
    
    // Start user in background
    user.start().catch(err => {
      logger.error(`User ${userId} crashed`, err.message);
    });
    
    logger.debug(`Added ${userId} (${persona})`);
  }
  
  _selectPersona() {
    const rand = Math.random();
    let cumulative = 0;
    
    for (const [persona, probability] of Object.entries(CONFIG.USER_PERSONAS)) {
      cumulative += probability;
      if (rand < cumulative) {
        return persona;
      }
    }
    
    return 'moderate'; // fallback
  }
  
  _displayReport() {
    logger.section('📊 SIMULATION RESULTS');
    
    const report = this.metrics.getReport();
    
    // Overall metrics
    console.log(c.bold('\n  Overall Performance:'));
    logger.metric('Total Duration', report.duration.toFixed(2), 's');
    logger.metric('Total Actions', report.totalActions);
    logger.metric('Actions/Second', report.actionsPerSecond);
    logger.metric('Peak Concurrent Users', report.peakConcurrentUsers);
    
    // Offer metrics
    console.log(c.bold('\n  Offer Activity:'));
    logger.metric('Browse Actions', report.browseActions);
    logger.metric('Create Attempts', report.createAttempts);
    logger.metric('Offers Created', report.offersCreated);
    logger.metric('Accept Attempts', report.acceptAttempts);
    logger.metric('Offers Accepted', report.offersAccepted);
    logger.metric('Accept Success Rate', report.successRate);
    logger.metric('Take/Offer Ratio', report.takeToOfferRatio);
    
    // Issues
    console.log(c.bold('\n  Concurrency & Errors:'));
    logger.metric('Race Condition Losses', report.raceConditionLosses);
    logger.metric('Validation Failures', report.validationFailures);
    logger.metric('Network Errors', report.networkErrors);
    
    // Performance
    console.log(c.bold('\n  Response Times:'));
    logger.metric('Average', report.avgResponseTimeMs, 'ms');
    logger.metric('95th Percentile', report.p95ResponseTimeMs, 'ms');
    logger.metric('99th Percentile', report.p99ResponseTimeMs, 'ms');
    logger.metric('Avg Think Time', report.avgThinkTimeMs, 'ms');
    
    // Per-persona breakdown
    console.log(c.bold('\n  Activity by Persona:'));
    Object.entries(report.byPersona).forEach(([persona, stats]) => {
      console.log(c.gray(`\n  ${persona.toUpperCase()}:`));
      logger.metric('  Total Actions', stats.actions);
      logger.metric('  Browsed', stats.browsed);
      logger.metric('  Created', stats.created);
      logger.metric('  Accepted', stats.accepted);
    });
    
    console.log('\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const orchestrator = new SimulatorOrchestrator(CONFIG);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.warn('\nReceived SIGINT, shutting down gracefully...');
    orchestrator.stopRequested = true;
  });
  
  try {
    await orchestrator.run();
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { SimulatorOrchestrator, StateManager, MetricsCollector, UserSimulator };