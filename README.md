# KRSwitch Backend — Schedule Exchange API Engine

This service manages parallel class schedules, processes atomic barter exchanges, secures administrative setups, and syncs real-time events over WebSockets.

---

## 🛠️ System Architectures

### 1. Two-Way Atomic Matchmaking
The matchmaking logic runs inside a transactional context (`prisma.$transaction`) to prevent concurrency race conditions:
* **Conflict Prevention**: Prior to executing schedule swaps, the engine checks time overlaps (`startA < endB && startB < endA`) based on days and hours formatted in `HH:MM`.
* **Cascade Cancellation**: Upon a successful swap, all other open offers owned by the participants that conflict with their newly assigned schedules, or reference sections they no longer hold, are automatically marked as `cancelled` under reasons `no_longer_enrolled` or `schedule_conflict`.
* **Race Condition Blocks**: When multiple HTTP POST requests attempt to `/take` the same offer at the same millisecond, database-level locking ensures only the first request succeeds while subsequent requests return a `400 Bad Request` with an explicit message.

> [!IMPORTANT]
> **Transaction Locks**: Matchmaking queries utilize PostgreSQL row-level locks within the transaction block. This guards critical database states against double-claim swaps when parallel clients select the same barter offer concurrently.

### 2. Session Management & Cookie Hardening
To prevent persistent session issues across localhost and subdomain boundaries, the authentication pipeline uses the following strategies:
* **Domain Purging**: Stale authenticated cookies are proactively cleared from both host-only, localhost subdomains, and configured remote origins during logout and invalid checks.
* **Token Loop**: If the request headers contain duplicate or stale tokens, the verification middleware parses them in sequence until a valid, active session is identified.
* **Status Checks**: Route guards check `isActive === true` inside the database, immediately revoking access from disabled user records regardless of token expiration.

> [!WARNING]
> **Cookie Scopes**: Ensure your `.env` config defines `COOKIE_DOMAIN` strictly to match your execution domain. Mismatched cookie domain configurations can lead to stale JWT parsing errors and session locks in browsers.

### 3. Atomic Database Operations
Administrative CSV imports (`/import-students`, `/import-classes`) are atomic:
* **Transaction Rollback**: If any record fails schema constraint validation, the transaction rolls back completely to protect integrity.
* **CSV Injection Guard**: Formulas prefixes (`=`, `+`, `-`, `@`) are stripped or escaped during parsing to guard spreadsheet exports against formula injections.

---

## 📊 Database Schema

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

## ⚡ Simulation & Seeding Utilities

### 1. Seeding Engine (`enhanced-seed.js`)
An algorithm designed to populate the system with 151 students across 7 courses under strict constraints:
* **Section Distribution**: Auto-calculates capacity distributions, resolving section assignments (`Kn` to `Pn/Rn` classes) symmetrically with zero conflicts.
* **CSV Sync**: Outputs generated layouts back into mock CSV files within `/mock_data` to synchronize source structures.

### 2. High-Load Simulator (`simulator.js`)
A CLI load testing client designed to stress backend transactional APIs under load profiles:
* **User Personas**: Configures concurrent actors across 4 distinct behavioral sets (Aggressive, Moderate, Passive, Lurker) with variable think times and browse/take weight ratios.
* **Race Simulator**: Staggers concurrent `/take` requests inside a 100ms window, collecting success rates and percentiles.
* **Telemetry**: Outputs avg latency, throughput, and p95/p99 latency indexes.

---

## ⚙️ Local Development & Setup

### 1. Configure Environment Variables
Create a `.env` file in the root backend directory:
```env
PORT=5000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/krswitch?schema=public"
JWT_SECRET="use_a_secure_random_key"
GOOGLE_CLIENT_ID="google_oauth_client_id"
GOOGLE_CLIENT_SECRET="google_oauth_client_secret"
BACKEND_URL="http://localhost:5000"
FRONTEND_URL="http://localhost:5173"
COOKIE_DOMAIN="localhost"
```

### 2. Command Reference
```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Run database seed
npm run seed:barter

# Run in watch mode
npm run dev
```

---

## 🧪 Testing Guidelines

Unit and integration tests are powered by **Vitest** and **Supertest**:
```bash
# Run tests
npm test

# Generate coverage:
npm run test:coverage
```
*   **Unit Tests (`src/tests/unit/`)**: Validates logical models, overlapping intervals, and signature validations.
*   **Integration Tests (`src/tests/integration/`)**: Evaluates HTTP routes, cookie injection payloads, and transactional rollbacks.

---

## 📡 WebSocket Event API

WebSockets run over **Socket.IO** with mandatory token validations:

### 1. Connection Handshake
Clients must request a token from `GET /api/socket-token` and submit it inside the `authenticate` channel within 10 seconds of socket connection:
```js
socket.emit('authenticate', socketToken);
```

### 2. Socket Events
*   `online-count` *(integer)*: Returns total active user connections.
*   `new-offer` *(object)*: Triggered when an offer is posted.
*   `offer-taken` *(object)*: Broadcasted when an offer is swapped or cancelled.
*   `enrollments-swapped` *(object)*: Emitted upon successful trades.

---

## 🚀 Production Configuration
*   **Security Headers**: Configured via Helmet to permit Google OAuth callback windows.
*   **Rate Limits**: Capped at 200 requests per 15 minutes for `/api/*` and 30 requests per 15 minutes for `/auth/*`.
*   **Docker Deployment**: Use `docker-compose up -d --build` to deploy services alongside PostgreSQL.

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
