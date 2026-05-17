# 🛡️ KRSwitch Backend — High-Performance Schedule Exchange Engine

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v20+-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Badge" />
  <img src="https://img.shields.io/badge/Express-v5.2-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express Badge" />
  <img src="https://img.shields.io/badge/Prisma-v7.3-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma Badge" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL Badge" />
  <img src="https://img.shields.io/badge/Socket.io-v4.8-010101?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.io Badge" />
  <img src="https://img.shields.io/badge/Vitest-v4.1-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="Vitest Badge" />
</p>

Welcome to the **KRSwitch Backend**, the core high-performance transaction and matchmaking engine powering the Class Barter System. Engineered for high concurrency, robust security, and millisecond-level responsiveness, this engine manages parallel class allocations, automates schedule swaps, secures administrative operations, and synchronizes system states in real time.

---

## 🚀 Key Architectural Pillars

### 1. The Two-Way Atomic Matchmaking Engine
The heart of KRSwitch is an auto-matching algorithm running in a strictly isolated, atomic database transaction (`prisma.$transaction`).
* **Conflict Isolation**: Before executing any swap, the engine calculates schedule conflicts (`A.start < B.end && B.start < A.end`) based on day/time overlap in `HH:MM` zero-padded format.
* **Auto-Purge & Cascade**: Once a swap completes, all other pending offers made by the participating users that conflict with their newly assigned schedules, or correspond to classes they no longer hold, are automatically marked as `cancelled` with specific reasons (`no_longer_enrolled` or `schedule_conflict`).
* **Race Condition Protection**: Concurrent takes of the same offer are blocked database-side. The first request locks the record, and subsequent requests are rejected gracefully with explicit API errors.

### 2. Aggressive Session & Zombie Cookie Hardening
To prevent persistent session "zombie" lockouts common with multi-scope local dev setups and subdomains, KRSwitch implements a multi-layered cookie clearing strategy:
* **Scope purges**: Active requests parsing tokens will traverse and clear cookies bound to host-only scopes, explicit IP addresses, and custom production domains.
* **Multi-token Loop**: If the browser sends duplicate/conflicting `token` headers (often a mix of stale and active cookies), the authentication middleware evaluates them sequentially until a valid, active session is found, preventing arbitrary session blockouts.
* **Active Status Guard**: Every protected route checks `isActive === true` on the database level, meaning disabled admins or banned students are instantly blocked even if their JWT has not expired.

### 3. CSV Import Transaction Guarantee (Atomicity)
Administrative CSV bulk uploads (`/import-students`, `/import-classes`) are executed inside transactional bounds.
* **Atomic Rollbacks**: If a single student NIM formatting, class time pattern (`HH:MM`), or database constraint fails midway through a 1,000-row file, the transaction rolls back completely, keeping the system clean.
* **HTML Stripping & CSV Injection Guard**: Every string imported via CSV is stripped of malicious HTML tags and validated against potential spreadsheet injection attacks by sanitizing prefix formula characters (`=`, `+`, `-`, `@`).

---

## 📊 Database Schema (Prisma Blueprint)

The backend utilizes **Prisma ORM** mapped onto a **PostgreSQL** instance. Below is the relational structure:

```mermaid
erDiagram
    User ||--o{ BarterOffer : "offered"
    User ||--o{ BarterOffer : "taken"
    User ||--o{ Enrollment : "has"
    User ||--o{ Notification : "receives"
    ParallelClass ||--o{ Enrollment : "houses"
    ParallelClass ||--o{ BarterOffer : "offeredClass"
    ParallelClass ||--o{ BarterOffer : "wantedClass"

    User {
        string nim PK
        string name
        string email UNIQUE
        string role "student | operator | super_admin"
        boolean isActive
    }

    ParallelClass {
        int id PK
        string courseCode
        string courseName
        string classCode
        string day
        string timeStart
        string timeEnd
        string room
    }

    Enrollment {
        int id PK
        string nim FK
        int parallelClassId FK
    }

    BarterOffer {
        int id PK
        string offererNim FK
        int myClassId FK
        int wantedClassId FK
        string status "open | matched | cancelled"
        datetime createdAt
        string takerNim FK
        datetime completedAt
    }

    Notification {
        int id PK
        string recipientNim FK
        string type
        boolean read
        json data
        datetime createdAt
    }

    ActivityLog {
        int id PK
        datetime timestamp
        string action_type
        string user_nim
        string details
    }
```

---

## ⚡ Seeding & High-Load Simulation Suites

KRSwitch is equipped with sophisticated simulation tools that let developers test concurrency and marketplace behavior.

### 1. Seeding Engine (`enhanced-seed.js`)
An advanced algorithm designed to seed the system with **151 students** and **7 courses**, simulating a capacity-capped war KRS:
* **Matched-Pair Optimization**: Solves the section distribution by aligning K (Lecture) and P/R (Practical) sections under a capacity constraint. It matches `Kn → Pn/Rn` pairs with perfect distribution (achieving 100% matched pairings for courses with symmetric section counts).
* **Timetable Overlaps**: Respects actual schedule overlaps (e.g., KOM120G-K3 overlaps with parts of KOM120C and KOM120H), ensuring seeded schedules represent authentic conflicts.
* **Autogenerator**: Dynamically updates template CSVs in `/mock_data` to match the exact generated database state.

### 2. Load Simulator (`simulator.js`)
An advanced marketplace load simulation tool simulating high concurrency, realistic user behaviors, and network bottlenecks:
* **Persona Profiles**: Instantiates virtual users acting under four distinct personas:
  * 🔴 **Aggressive (15%)**: Highly active, rapid decisions, short think times.
  * 🟡 **Moderate (40%)**: Balanced browse/create/take activity.
  * 🔵 **Passive (30%)**: Cautious browsing, long think times.
  * 🟢 **Lurkers (15%)**: Heavy browsing, rarely acts.
* **Race Condition Generator**: Triggers controlled, staggered API requests to `/take` the same offer within a 100ms window, stressing the atomic database transactions and logging metrics.
* **Telemetry Reporting**: Calculates average response times, p95 and p99 percentiles, throughput rates, network timeouts, and success/failure ratios.

---

## 📁 Directory Structure Tour

```
KRSwitch-backend/
├── prisma/
│   ├── dev.db                 # Local development SQLite (fallback)
│   └── schema.prisma          # PostgreSQL production blueprint
├── src/
│   ├── controllers/
│   │   └── offerController.ts # Barter offers, swap transactions, conflict logic
│   ├── middleware/
│   │   ├── authMiddleware.ts  # Token loop, multi-scope cookie clears, active checks
│   │   └── helpers.ts         # Async handler wrappers, validator helpers
│   ├── routes/
│   │   ├── admin.ts           # Basic client stats, health, tokens, notifications
│   │   ├── adminRoutes.ts     # CRUD, CSV Imports, Overrides, SuperAdmin settings
│   │   ├── auth.ts            # Google OAuth PKCE flow, session issues, logouts
│   │   └── offers.ts          # Core student barter API handlers
│   ├── socket/
│   │   └── socketHandler.ts   # WebSocket token validation & room attachments
│   ├── utils/
│   │   ├── activity.ts        # Real-time Audit Trail Logger
│   │   └── seeding.ts         # Enrollment shuffling tools
│   ├── server.ts              # Express initialization, middlewares & WS setup
│   └── tests/                 # Full unit and integration testing suite
├── enhanced-seed.js           # Matched-pair database seeder
├── simulator.js               # Concurrency & load simulator
└── Dockerfile                 # Multi-stage production container build
```

---

## 🛠️ Installation & Local Setup

### 1. Prerequisites
* **Node.js** 20.x or higher
* **npm** or **yarn**
* **PostgreSQL** database (Docker or local instance)

### 2. Configure Environment Variables
Create a `.env` file in the backend root directory:

```env
# Server Config
PORT=5000
NODE_ENV=development

# Database Connection
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/krswitch?schema=public"

# Authentication Secrets
JWT_SECRET="generate_a_long_random_cryptographic_string_here"

# Google OAuth Credentials (PKCE)
GOOGLE_CLIENT_ID="your_google_oauth_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_google_oauth_client_secret"

# Client Routing URLs
BACKEND_URL="http://localhost:5000"
CORS_ORIGIN="http://localhost:5173"
FRONTEND_URL="http://localhost:5173"

# Cookie Scopes
COOKIE_DOMAIN="localhost"
```

### 3. Setup Commands

```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Run database seed
npm run seed:barter

# Start in development mode (with auto-reload)
npm run dev
```

---

## 🧪 Testing Suite Guide

KRSwitch Backend features a comprehensive testing pipeline powered by **Vitest** and **Supertest** with mock database layers.

```bash
# Run all tests once
npm test

# Run tests in hot-reload (watch) mode
npm run test:watch

# Generate test coverage report
npm run test:coverage
```

### Test Structure Layout
* **Unit Tests (`src/tests/unit/`)**: Test functions in isolation. Includes timetable overlaps checking (`offerController.test.ts`), atomic matchmaking validations (`autoMatch.test.ts`), and authorization token parsing (`middleware.test.ts`).
* **Integration Tests (`src/tests/integration/`)**: Fully mocks the Prisma database client and runs API requests using Supertest, verifying response headers, cookie settings, Socket updates, and transaction rollbacks.

---

## 📡 WebSocket API reference

The WebSocket server runs over **Socket.IO** and implements client authentication:

### 1. Authentication Handshake
Clients must request a short-lived token from `GET /api/socket-token` and send it inside `authenticate` within 10 seconds of connection:
```js
socket.emit('authenticate', socketToken);
```
Unauthenticated connections are automatically disconnected. Authenticated clients are bound to a private room: `user-${nim}`.

### 2. Emitted Events (Broadcasts)
* `online-count` *(integer)*: Current active user count.
* `new-offer` *(object)*: Triggered when a student publishes an offer.
* `offer-taken` *(object)*: Emitted when an offer is matched or cancelled.
* `enrollments-swapped` *(object)*: Live updates of swapped participants schedules.

---

## 🚀 Production Guidelines & Docker

For production rollouts, the backend includes a optimized Docker setup utilizing multi-stage builds.

### 1. Build & Run via Docker Compose
To launch the backend, a PostgreSQL DB, and secure settings together:

```bash
docker-compose up -d --build
```

### 2. Production Security Optimizations
* **Helmet Middleware**: Configured to restrict opener and resource policies securely while facilitating OAuth popups.
* **Rate Limiting**: In production (`NODE_ENV=production`), rate limits protect endpoints:
  * `/api/*`: Capped at **200 requests per 15 minutes**.
  * `/auth/*`: Capped at **30 requests per 15 minutes** to prevent brute-forcing.
* **CORS Origin Array**: Strictly resolves incoming request origins to match authorized local and remote host headers.

---

*KRSwitch Backend is built for production reliability. For issues or contributions, check out the repository issues.*

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
