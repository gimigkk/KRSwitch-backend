# Getting Started

## 📅 Onboarding Checklist

### 1. Database Initialization
Verify **Node.js 20+** and **PostgreSQL 16** are active locally.
1. Spin up a local PostgreSQL instance.
2. In this folder (`KRSwitch-backend`), copy `.env.example` to `.env` (or create it).
3. Ensure `DATABASE_URL` matches your local database settings.

> [!IMPORTANT]
> **PostgreSQL Configuration**: The matchmaking system relies heavily on atomic transactions. Ensure your PostgreSQL connection supports concurrent locking scopes and is not bottlenecked by client pool limits.

### 2. Configure Environment Variables
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

### 3. Run Backend Service
Initialize dependencies, apply database migrations, and seed mock records:
```bash
npm install
npm run migrate       # Runs Prisma migrations on PostgreSQL
npm run seed:barter   # Seeds 151 students, 7 courses, and pre-matched barters
npm run dev           # Runs API on http://localhost:5000
```
Verify the service is active by calling `curl http://localhost:5000/health`.

## 🚀 Production Configuration
*   **Security Headers**: Configured via Helmet to permit Google OAuth callback windows.
*   **Rate Limits**: Capped at 200 requests per 15 minutes for `/api/*` and 30 requests per 15 minutes for `/auth/*`.
*   **Docker Deployment**: Use `docker-compose up -d --build` to deploy services alongside PostgreSQL.

## 🛠️ Codebase Walkthrough Exercises

### Exercise 1: Custom Audit Log parameters
* **Goal**: Trace database-driven audit logging.
* **Task**:
  1. Navigate to the `/users` POST router endpoint in `adminRoutes.ts`.
  2. Change the string details parameter of the `logActivity` call when creating a new student to append their email address.
  3. Create a test student in the Admin tab "Database Mahasiswa" and verify the visual logs table instantly matches your modification.

## 📊 Dependency Graphs & Code Docs Generation

### 1. Module Dependencies (Madge)
Generates dependency charts for source files:
```bash
npm install --save-dev madge
npx madge --image backend-graph.svg --layout dot src/server.ts
```

### 2. TypeScript API Reference Site (TypeDoc)
Generates interactive HTML reference sites directly from JSDoc annotations:
```bash
npm install --save-dev typedoc
npx typedoc --out docs src/
```
Open `docs/index.html` to explore the generated references.
