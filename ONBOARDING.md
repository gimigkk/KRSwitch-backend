# KRSwitch — Developer Onboarding Playbook

This playbook provides configuration steps, hands-on codebase exercises, and documentation auto-generation instructions for new developers.

---

## 📅 Onboarding Checklist

### 1. Database Initialization
Verify **Node.js 20+** and **PostgreSQL 16** are active locally.
1. Spin up a local PostgreSQL instance.
2. In the `KRSwitch-backend` root, copy `.env` file details based on the [Backend README](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/README.md).
3. Ensure `DATABASE_URL` matches your local database settings.

### 2. Run Backend Service
Initialize dependencies, apply database migrations, and seed mock records:
```bash
cd KRSwitch-backend
npm install
npm run migrate       # Runs Prisma migrations on PostgreSQL
npm run seed:barter   # Seeds 151 students, 7 courses, and pre-matched barters
npm run dev           # Runs API on http://localhost:5000
```
Verify via `curl http://localhost:5000/health`.

### 3. Run Frontend Client
```bash
cd KRSwitch-frontend
npm install
npm run dev           # Runs Vite dev server on http://localhost:5173
```
Access the client at `http://localhost:5173`.

### 4. Verify Tests
```bash
# In KRSwitch-backend:
npm test

# In KRSwitch-frontend:
npm run cypress:run
```

---

## 🛠️ Codebase Walkthrough Exercises

Complete these three tasks to understand the routing, validation, and rendering mechanics of the project:

### Exercise 1: Hover Styles & Re-render Checks
* **File**: [BarterCard.jsx](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-frontend/src/components/dash/BarterCard.jsx)
* **Goal**: Observe component rendering boundaries.
* **Task**:
  1. Modify the card's active border accent on hover.
  2. Place `console.log("Render card id:", offer.id)` inside the card component function body.
  3. Observe logs in the browser console when selecting filters. Note how component updates are memoized via `Dashboard.jsx`.

### Exercise 2: Add Audit Log Parameter
* **File**: [adminRoutes.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/routes/adminRoutes.ts)
* **Goal**: Trace database-driven audit logging.
* **Task**:
  1. Navigate to the `/users` POST router endpoint.
  2. Change the string details parameter of the `logActivity` call when creating a new student to append their email address.
  3. Create a test student in the Admin tab "Database Mahasiswa" and verify the visual logs table instantly matches your modification.

### Exercise 3: Add Validation Rules
* **File**: [offerController.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/controllers/offerController.ts)
* **Goal**: Trace API schema validations.
* **Task**:
  1. Locate `createOfferSchema` Zod definition.
  2. Append rules requiring `myClassId` and `wantedClassId` to be positive, non-zero integers.
  3. Append a matching test case in `offerController.test.ts`.

---

## 📊 Code Dependency Graphs & Documentation Generators

Use these packages to dynamically map directories and auto-generate code documentations:

### 1. Module Dependencies (Madge)
Generates dependency charts for source files:
```bash
npm install --save-dev madge

# Render backend dependencies to SVG:
npx madge --image backend-graph.svg --layout dot KRSwitch-backend/src/server.ts

# Render frontend components to SVG:
npx madge --image frontend-graph.svg --layout dot KRSwitch-frontend/src/main.jsx
```
*Requires `graphviz` package installed globally on the OS (`sudo apt-get install graphviz`).*

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
