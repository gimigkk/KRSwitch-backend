/**
 * KRSwitch Production Load Test — 150 Full Concurrent WebSocket + HTTP Users
 * Tests 150 persistent WebSocket connections and concurrent HTTP API traffic against production.
 *
 * Usage:  node loadtest-prod.js
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const PROD_URL = 'https://krswitch.gimiaw.web.id';
const JWT_SECRET = 'RPL2Kelompok7KRSwitchIlkomerz61';

const TARGET_USERS = 150;      // 150 simultaneous WebSocket + HTTP users
const RAMP_UP_SEC = 30;         // ramp from 0→150 over 30s
const STEADY_SEC = 90;          // hold 150 connected users for 90s
const COOLDOWN_SEC = 10;
const HTTP_INTERVAL_MS = 6000;  // HTTP fetch every ~6s per user to avoid rate-limit burnout
const WS_AUTH_TIMEOUT = 10000;

const USERS = [];

// ═══════════════════════════════════════════════════════════════
// ANSI HELPERS
// ═══════════════════════════════════════════════════════════════
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  gray: s => `\x1b[90m${s}\x1b[0m`,
  red: s => `\x1b[91m${s}\x1b[0m`,
  green: s => `\x1b[92m${s}\x1b[0m`,
  yellow: s => `\x1b[93m${s}\x1b[0m`,
  blue: s => `\x1b[94m${s}\x1b[0m`,
  cyan: s => `\x1b[96m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  boldCyan: s => `\x1b[1m\x1b[96m${s}\x1b[0m`,
};

const ts = () => C.gray(`[${new Date().toISOString().slice(11, 23)}]`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ═══════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════

const M = {
  httpReqs: 0, httpOk: 0, http429: 0, http4xx: 0, http5xx: 0, httpFail: 0,
  wsConnected: 0, wsAuthOk: 0, wsAuthFail: 0, wsDisconnects: 0, wsErrors: 0,
  wsDeviceLimitHit: 0,
  latencies: [],
  wsConnLatencies: [],
  activeWs: 0, peakWs: 0,
  onlineCountUpdates: 0, lastOnlineCount: 0,
  startTime: 0,
};

function recordLatency(arr, ms) { if (arr.length < 50000) arr.push(ms); }
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(Math.ceil(p / 100 * s.length) - 1, s.length - 1)];
}

// ═══════════════════════════════════════════════════════════════
// AUTH TOKEN & COOKIES
// ═══════════════════════════════════════════════════════════════

function makeToken(user) {
  return jwt.sign(
    { nim: user.nim, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeSessionCookie(user) {
  return `token=${makeToken(user)}`;
}

// ═══════════════════════════════════════════════════════════════
// PROD USERS
// ═══════════════════════════════════════════════════════════════

const RAW_USERS = `M0403241002|Hauzan Ziyadatul Khoir|g61ilkom19hauzan@apps.ipb.ac.id|student
M0403241004|Fadhla|1a4fadhla@apps.ipb.ac.id|student
M0403241005|Lazarus Prima Promuditha|lazarusprima@apps.ipb.ac.id|student
M0403241006|Candra Agung Alief Prasetyo|candraprasetyo@apps.ipb.ac.id|student
M0403241007|Nadya Shafwah Rizalti|nadyarizalti@apps.ipb.ac.id|student
M0403241009|Bilall Hendry|bilallhendry@apps.ipb.ac.id|student
M0403241010|Safira Ayu Damayanti|safiraayu71.damayanti@apps.ipb.ac.id|student
M0403241011|Aaliyah Nofarizki|aalnfrzkaaliyah@apps.ipb.ac.id|student
M0403241012|Nugraheni Dwi Ayu Putri|ndayuputri@apps.ipb.ac.id|student
M0403241015|Muhammad Farrel Alfachrezi|farrelalfachrezi@apps.ipb.ac.id|student
M0403241016|Raihanah Azka Zhafira|hanahzhafira@apps.ipb.ac.id|student
M0403241020|Faizah Nayda Shalihah|naydafaizah@apps.ipb.ac.id|student
M0403241024|Najma Lathifah Tsaqib|najmalathifah@apps.ipb.ac.id|student
M0403241025|Alden Nara Nabiha Kayana Hylmi|aldennara@apps.ipb.ac.id|student
M0403241027|Avriell Shianne Chrisly|avriellshiannechrisly@apps.ipb.ac.id|student
M0403241029|Azka Julian Putra Wahyudi|azkajulian@apps.ipb.ac.id|student
M0403241032|Nasywa Azzahra Naadhirah|nasywaazzahra@apps.ipb.ac.id|student
M0403241034|Salwa Nadira|xymoonadira@apps.ipb.ac.id|student
M0403241035|Anisa Nur Rohmah|cosmicanisa@apps.ipb.ac.id|student
M0403241041|Nadine Putri Agustin|nadine_putriagustin@apps.ipb.ac.id|student
M0403241043|Kemas Adirangga Nayar|kemas.nayar@apps.ipb.ac.id|student
M0403241049|Maulana Syarif Hidayatullah|maulanamaulana@apps.ipb.ac.id|student
M0403241051|Fairuz Hibatullah|faizhibatullah@apps.ipb.ac.id|student
M0403241054|Annisa Azzahra Kusmawan|nisa123azzahra@apps.ipb.ac.id|student
M0403241056|Fatima Feyruz Chalisa|fatimafeyruz@apps.ipb.ac.id|student
M0403241057|Muhammad Zakwan Sakhiy|m.zakwansakhiy@apps.ipb.ac.id|student
M0403241058|Syazana Aqila Kiashatina|zanaaqila@apps.ipb.ac.id|student
M0403241061|Mickhael Keith Richard Simangunsong|keithrichard@apps.ipb.ac.id|student
M0403241062|Alvian Tri Amalia Hendriawan|alviantri02hendriawan@apps.ipb.ac.id|student
M0403241063|Suryani Prayudia Handayani|suryani59prayudia@apps.ipb.ac.id|student
M0403241064|Muhamad Raihan Pratama Putra Setyatmoko|raihanpratama@apps.ipb.ac.id|student
M0403241065|Jeslyn Angelica Widjaja|angelicaajeslyn@apps.ipb.ac.id|student
M0403241067|Mirabel Nasywa Rajendraputri|allaboutzmirabel@apps.ipb.ac.id|student
M0403241068|Zidny Ilman Nafi|zidny26ilmannafi@apps.ipb.ac.id|student
M0403241069|Naufal Rizki Riyadi|naufalriyadi@apps.ipb.ac.id|student
M0403241075|Muh Arifaushan|muharifaushan@apps.ipb.ac.id|student
M0403241076|Lian Tora Adi Nugroho|liantora@apps.ipb.ac.id|student
M0403241082|Julius Calvin Kurniadi|juliuscalvin_kurniadi@apps.ipb.ac.id|student
M0403241084|Melandri Rasya Arindhi|rasyamelandri@apps.ipb.ac.id|student
M0403241087|Ilham Edgar Maulana Goesasi|hamgarianmaulana@apps.ipb.ac.id|student
M0403241089|Asty Athetha Loethan|qetaloethan@apps.ipb.ac.id|student
M0403241090|Ahmad Rafif Ilmany|rafifilmany@apps.ipb.ac.id|student
M0403241092|Sinar Marthin Simanjuntak|sinarmarthin@apps.ipb.ac.id|student
M0403241096|Isyana Ajeng Khairani|ajkisyana@apps.ipb.ac.id|student
M0403241098|Nanda Zahran Syafiq|cococacananda@apps.ipb.ac.id|student
M0403241101|Kevin Neisa Aulia Iskandar|kevinneisa@apps.ipb.ac.id|student
M0403241102|Nafil Khautal Budiono|nkhautalbudiono@apps.ipb.ac.id|student
M0403241106|Prima Jaya Kusumah|773prima@apps.ipb.ac.id|student
M0403241113|Ardian Fadhlurrahman|yanfadhlurrahman@apps.ipb.ac.id|student
M0403241115|Muhammad Syaamil|297syaamil@apps.ipb.ac.id|student
M0403241116|Rafiqi Zaldi Riyatno|rafiqizaldi@apps.ipb.ac.id|student
M0403241117|Gilang Muhamad Widiagung|gnaligilang@apps.ipb.ac.id|student
M0403241119|Aurel Nayna Raysavira|ollenayna@apps.ipb.ac.id|student
M0403241120|Muhammad Naufal Dzaki Jatmika|naufaldzaki@apps.ipb.ac.id|student
M0403241121|Nabil Musannif Siregar|nabilnifsiregar@apps.ipb.ac.id|student
M0403241122|Muhammad Rezonaldo Yunus|rezonaldorezonaldo@apps.ipb.ac.id|student
M0403241128|Syahwali Khan Habibi Harahap|syahwalikhan@apps.ipb.ac.id|student
M0403241129|Muhammad Alif Baha Badiuzzaman|alifbaha@apps.ipb.ac.id|student
M0403241132|Zidhan Erlan Sunanda|zidhanerlansunanda@apps.ipb.ac.id|student
M0403241139|Ananta Sakha Pramodya|cron1xsakha@apps.ipb.ac.id|student
M0403241141|Rendi Ramadana|ramadanarendi@apps.ipb.ac.id|student
M0403241142|Muhammad Fauzan Rizvi|m_fauzan_rizvi@apps.ipb.ac.id|student
M0403241165|Faqih Sahar Ramadhan|saharramadhan@apps.ipb.ac.id|student
M0403241168|Dhikral Baihaqi|dhikralbaihaqi@apps.ipb.ac.id|student
M0403241173|Nawra Ghaya Tsabita|ghayanawra@apps.ipb.ac.id|student
M0403241176|Muhammad Farhan Assafari|mhmmdfarssaffarhan@apps.ipb.ac.id|student
M0403241185|Tesalonika Natalie Sofi Siregar|tesalonikasofi@apps.ipb.ac.id|student`;

function loadUsers() {
  RAW_USERS.trim().split('\n').forEach(line => {
    const [nim, name, email, role] = line.split('|');
    USERS.push({ nim, name, email, role });
  });
  console.log(`${ts()} ${C.green(`Loaded ${USERS.length} real users`)}`);
}

// ═══════════════════════════════════════════════════════════════
// VIRTUAL CLIENT (Persistent WS + Concurrent HTTP)
// ═══════════════════════════════════════════════════════════════

const API = axios.create({
  baseURL: PROD_URL,
  timeout: 15000,
  headers: { 'User-Agent': 'KRSwitch-LoadTest/2.0' },
  validateStatus: () => true,
});

class VirtualUserClient {
  constructor(id, user, stopSignal) {
    this.id = id;
    this.user = user;
    this.stopSignal = stopSignal;
    this.socket = null;
    this.cookie = makeSessionCookie(user);
    this.token = makeToken(user);
    this.authenticated = false;
    this.httpTimer = null;
  }

  async start() {
    const t0 = Date.now();

    // 1. Establish persistent Socket.IO WebSocket connection
    this.socket = ioClient(PROD_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: WS_AUTH_TIMEOUT,
      forceNew: true,
    });

    this.socket.on('connect', () => {
      M.wsConnected++;
      this.socket.emit('authenticate', this.token);
    });

    this.socket.on('online-count', count => {
      if (!this.authenticated) {
        this.authenticated = true;
        M.wsAuthOk++;
        M.activeWs++;
        if (M.activeWs > M.peakWs) M.peakWs = M.activeWs;
        recordLatency(M.wsConnLatencies, Date.now() - t0);
      }
      M.onlineCountUpdates++;
      M.lastOnlineCount = count;
    });

    this.socket.on('auth-error', data => {
      if (data?.error?.includes('Device limit')) {
        M.wsDeviceLimitHit++;
      } else {
        M.wsAuthFail++;
      }
    });

    this.socket.on('disconnect', () => {
      if (this.authenticated) {
        this.authenticated = false;
        M.activeWs--;
        M.wsDisconnects++;
      }
    });

    this.socket.on('connect_error', () => {
      M.wsErrors++;
    });

    // 2. Start HTTP activity loop
    this.runHttpLoop();
  }

  async runHttpLoop() {
    while (!this.stopSignal.stop) {
      await sleep(rand(2000, HTTP_INTERVAL_MS));
      if (this.stopSignal.stop) break;

      const t0 = Date.now();
      M.httpReqs++;

      try {
        const res = await API.get('/api/offers', {
          headers: { Cookie: this.cookie },
        });

        const lat = Date.now() - t0;
        recordLatency(M.latencies, lat);

        if (res.status >= 200 && res.status < 400) {
          M.httpOk++;
        } else if (res.status === 429) {
          M.http429++;
        } else if (res.status >= 400 && res.status < 500) {
          M.http4xx++;
        } else {
          M.http5xx++;
        }
      } catch (err) {
        M.httpFail++;
      }
    }

    // Clean up socket on stop
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PROGRESS REPORTER
// ═══════════════════════════════════════════════════════════════

function printProgress(phase) {
  const elapsed = ((Date.now() - M.startTime) / 1000).toFixed(0);
  const avgLat = M.latencies.length ? (M.latencies.reduce((a, b) => a + b, 0) / M.latencies.length).toFixed(0) : '-';
  console.log(
    `${ts()} ${C.cyan(`[${phase}]`)} ` +
    `${C.bold(elapsed + 's')} | ` +
    `WS Active: ${C.green(M.activeWs)}/${TARGET_USERS} | ` +
    `HTTP Ok: ${C.green(M.httpOk)} | ` +
    `HTTP 429: ${M.http429 ? C.yellow(M.http429) : '0'} | ` +
    `Avg HTTP Latency: ${avgLat}ms | ` +
    `Online Broadcast: ${M.lastOnlineCount}`
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function main() {
  loadUsers();
  M.startTime = Date.now();

  console.log('\n' + C.boldCyan('═'.repeat(70)));
  console.log(C.boldCyan(`  🚀 KRSwitch Production Load Test — ${TARGET_USERS} Full Concurrent WS Users`));
  console.log(C.boldCyan('═'.repeat(70)));
  console.log(`${ts()} Target: ${C.bold(PROD_URL)}`);
  console.log(`${ts()} Strategy: Every virtual user maintains 1 persistent WebSocket + periodic HTTP requests`);
  console.log(`${ts()} Profile: ${RAMP_UP_SEC}s ramp → ${STEADY_SEC}s steady → ${COOLDOWN_SEC}s cooldown\n`);

  // Quick sanity check
  try {
    const r = await API.get('/api/offers', { headers: { Cookie: makeSessionCookie(USERS[0]) }, timeout: 10000 });
    console.log(`${ts()} ${C.green('✓ Sanity check passed')} — GET /api/offers → ${r.status}`);
  } catch (e) {
    console.log(`${ts()} ${C.red('✗ Sanity check FAILED')} — ${e.message}`);
    console.log(`${ts()} ${C.yellow('Continuing anyway...')}`);
  }

  const stopSignal = { stop: false };
  const clients = [];

  // Progress ticker every 4 seconds
  const progressTimer = setInterval(() => printProgress(clients.length < TARGET_USERS ? 'RAMP-UP' : 'STEADY'), 4000);

  // ── RAMP UP ──
  console.log(`\n${ts()} ${C.cyan('▶ RAMP-UP PHASE')} — Spawning ${TARGET_USERS} full clients over ${RAMP_UP_SEC}s`);
  const spawnIntervalMs = (RAMP_UP_SEC * 1000) / TARGET_USERS;

  for (let i = 0; i < TARGET_USERS; i++) {
    if (stopSignal.stop) break;

    // Distribute among real users (round-robin: ~2.2 sockets per NIM, limit is 4)
    const user = USERS[i % USERS.length];
    const client = new VirtualUserClient(i + 1, user, stopSignal);
    clients.push(client);
    client.start();

    await sleep(spawnIntervalMs);
  }

  // ── STEADY STATE ──
  console.log(`\n${ts()} ${C.cyan('▶ STEADY STATE')} — Holding ${TARGET_USERS} concurrent WebSockets for ${STEADY_SEC}s`);
  await sleep(STEADY_SEC * 1000);

  // ── COOLDOWN ──
  console.log(`\n${ts()} ${C.cyan('▶ COOLDOWN')} — Disconnecting all ${TARGET_USERS} clients`);
  stopSignal.stop = true;
  await sleep(COOLDOWN_SEC * 1000);
  clearInterval(progressTimer);

  // ── REPORT ──
  const totalSec = ((Date.now() - M.startTime) / 1000).toFixed(1);
  const avgLat = M.latencies.length ? (M.latencies.reduce((a, b) => a + b, 0) / M.latencies.length).toFixed(1) : 0;
  const avgWsLat = M.wsConnLatencies.length ? (M.wsConnLatencies.reduce((a, b) => a + b, 0) / M.wsConnLatencies.length).toFixed(1) : 0;

  console.log('\n' + C.boldCyan('═'.repeat(70)));
  console.log(C.boldCyan('  📊 150 CONCURRENT WEBSOCKET LOAD TEST RESULTS'));
  console.log(C.boldCyan('═'.repeat(70)));

  const row = (label, val, unit = '') => {
    console.log(`  ${C.gray(label.padEnd(38, '.'))} ${C.bold(String(val))}${unit}`);
  };

  console.log(C.bold('\n  General:'));
  row('Total Test Duration', totalSec, 's');
  row('Target Concurrent WS Connections', TARGET_USERS);
  row('Unique DB Users Used', USERS.length);

  console.log(C.bold('\n  WebSocket Performance:'));
  row('Connection Attempts', M.wsConnected);
  row('Successfully Authenticated WS', M.wsAuthOk);
  row('Auth Failed', M.wsAuthFail);
  row('Device Limit Rejected (Max 4/NIM)', M.wsDeviceLimitHit);
  row('Connection Errors', M.wsErrors);
  row('Disconnects during test', M.wsDisconnects);
  row('PEAK CONCURRENT ACTIVE WEBSOCKETS', M.peakWs);
  row('Avg WS Connect+Auth Latency', avgWsLat, 'ms');
  row('P95 WS Connect+Auth Latency', pct(M.wsConnLatencies, 95).toFixed(1), 'ms');
  row('P99 WS Connect+Auth Latency', pct(M.wsConnLatencies, 99).toFixed(1), 'ms');
  row('Online Count Broadcast Received', M.lastOnlineCount);
  row('Online Broadcast Updates', M.onlineCountUpdates);

  console.log(C.bold('\n  HTTP API Concurrent Performance:'));
  row('Total HTTP Requests', M.httpReqs);
  row('Successful (2xx/3xx)', M.httpOk);
  row('Rate Limited (429)', M.http429);
  row('Other Client Errors (4xx)', M.http4xx);
  row('Server Errors (5xx)', M.http5xx);
  row('Network/Timeout Errors', M.httpFail);
  row('Avg HTTP Response Time', avgLat, 'ms');
  row('P50 HTTP Latency', pct(M.latencies, 50).toFixed(1), 'ms');
  row('P95 HTTP Latency', pct(M.latencies, 95).toFixed(1), 'ms');
  row('P99 HTTP Latency', pct(M.latencies, 99).toFixed(1), 'ms');

  const totalOps = M.httpReqs + M.wsConnected;
  const totalErrs = M.http5xx + M.httpFail + M.wsErrors + M.wsAuthFail;
  const errRate = totalOps > 0 ? ((totalErrs / totalOps) * 100).toFixed(2) : 0;

  console.log(C.bold('\n  Overall Stability:'));
  row('Total Operations', totalOps);
  row('Total Server/Conn Errors', totalErrs);
  row('Error Rate', errRate, '%');

  console.log('\n' + C.boldCyan('═'.repeat(70)));
  if (M.peakWs >= 140 && errRate < 1) {
    console.log(C.green(`  ✅ VERDICT: PASSED — Prod handled ${M.peakWs} CONCURRENT WEBSOCKETS flawlessly!`));
  } else if (M.peakWs >= 100) {
    console.log(C.yellow(`  ⚠️  VERDICT: MARGINAL — Reached ${M.peakWs} concurrent WebSockets`));
  } else {
    console.log(C.red(`  ❌ VERDICT: FAILED — Only reached ${M.peakWs} concurrent WebSockets`));
  }
  console.log(C.boldCyan('═'.repeat(70)) + '\n');

  process.exit(0);
}

process.on('SIGINT', () => {
  console.log(`\n${ts()} ${C.yellow('Interrupted — stopping...')}`);
  process.exit(0);
});

main().catch(err => {
  console.error(C.red('Fatal:'), err);
  process.exit(1);
});
