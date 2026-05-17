# 🚀 KRSwitch Backend — Developer Onboarding Playbook

This playbook provides configuration steps, code walkthrough exercises, and document auto-generation instructions for the backend service.

---

## 📅 Onboarding Checklist

### 1. Database Initialization
Verify **Node.js 20+** and **PostgreSQL 16** are active locally.
1. Spin up a local PostgreSQL instance.
2. In this folder (`KRSwitch-backend`), copy `.env.example` to `.env` (or create it based on the README).
3. Ensure `DATABASE_URL` matches your local database settings.

> [!IMPORTANT]
> **PostgreSQL Configuration**: The matchmaking system relies heavily on atomic transactions. Ensure your PostgreSQL connection supports concurrent locking scopes and is not bottlenecked by client pool limits.

### 2. Run Backend Service
Initialize dependencies, apply database migrations, and seed mock records:
```bash
npm install
npm run migrate       # Runs Prisma migrations on PostgreSQL
npm run seed:barter   # Seeds 151 students, 7 courses, and pre-matched barters
npm run dev           # Runs API on http://localhost:5000
```
Verify the service is active by calling `curl http://localhost:5000/health`.

### 3. Verify Tests
```bash
npm test
```

---

## 🛠️ Codebase Walkthrough Exercises

Complete these two tasks to understand backend route logic, database operations, and schema validations:

### Exercise 1: Custom Audit Log parameters
* **File**: [adminRoutes.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/routes/adminRoutes.ts)
* **Goal**: Trace database-driven audit logging.
* **Task**:
  1. Navigate to the `/users` POST router endpoint.
  2. Change the string details parameter of the `logActivity` call when creating a new student to append their email address.
  3. Create a test student in the Admin tab "Database Mahasiswa" and verify the visual logs table instantly matches your modification.

### Exercise 2: Custom Validation Rules
* **File**: [offerController.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/controllers/offerController.ts)
* **Goal**: Trace API schema validations.
* **Task**:
  1. Locate `createOfferSchema` Zod definition.
  2. Append rules requiring `myClassId` and `wantedClassId` to be positive, non-zero integers.
  3. Append a matching test case in `offerController.test.ts`.

> [!TIP]
> **Hot Module Reloading**: When completing these exercises, backend modifications will automatically trigger server restarts via ts-node-dev. You do not need to manually boot the server between files updates.

---

## 📊 Dependency Graphs & Code Docs Generation

Use these packages to dynamically map directories and auto-generate code documentations for the backend service:

### 1. Module Dependencies (Madge)
Generates dependency charts for source files:
```bash
npm install --save-dev madge

# Render backend dependencies to SVG:
npx madge --image backend-graph.svg --layout dot src/server.ts
```

> [!TIP]
> **Graphviz Requirement**: Generating graphical SVG files from Madge outputs requires the `graphviz` library installed globally on your operating system (e.g., `sudo apt-get install graphviz` on Ubuntu/Debian).

### 2. Prisma Database ERD (prisma-erd-generator)
Generates dynamic ERD files during Prisma database generation:
```bash
npm install --save-dev prisma-erd-generator @mermaid-js/mermaid-cli
```
Add to [schema.prisma](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/prisma/schema.prisma):
```prisma
generator erd {
  provider = "prisma-erd-generator"
  output   = "../db-erd.svg"
  theme    = "dark"
}
```
Regenerate:
```bash
npx prisma generate
```

### 3. TypeScript API Reference Site (TypeDoc)
Generates interactive HTML reference sites directly from JSDoc annotations:
```bash
npm install --save-dev typedoc

# Build docs:
npx typedoc --out docs src/
```
Open `docs/index.html` to explore the generated references.

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
