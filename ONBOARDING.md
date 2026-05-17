# 🚀 KRSwitch — Developer Onboarding & Documentation Playbook

Welcome to **KRSwitch**! This playbook is designed to get you from a fresh clone to writing production-ready code on day one. Below, you will find your first-day onboarding checklist, practical hands-on exercises to understand the codebase, and tools to generate interactive visual graphs and API documentation.

---

## 📅 Day 1 Onboarding Roadmap

Follow this step-by-step checklist to configure your workspace and verify your environment:

### `[ ]` Task 1: System Pre-requisites & Database Initialization
Ensure you have **Node.js 20+** and **PostgreSQL 16** installed on your system.
1. Spin up a local PostgreSQL instance.
2. In the `KRSwitch-backend` root, create a `.env` file from the blueprint in the [Backend README](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/README.md).
3. Verify that `DATABASE_URL` is pointing to your PostgreSQL instance.

### `[ ]` Task 2: Bootstrapping the Backend
Execute the following commands to install dependencies, run migrations, and seed mock data:
```bash
cd KRSwitch-backend
npm install
npm run migrate       # Applies PostgreSQL database schemas
npm run seed:barter   # Seeds 151 students, 7 courses, and pre-matched barters
npm run dev           # Launches Express API on http://localhost:5000
```
Verify the backend is active by hitting `http://localhost:5000/health`.

### `[ ]` Task 3: Bootstrapping the Frontend
Open a new terminal window to launch your client:
```bash
cd KRSwitch-frontend
npm install
npm run dev           # Launches Vite 7 dev server on http://localhost:5173
```
Visit `http://localhost:5173` to see the dark-mode dashboard.

### `[ ]` Task 4: Verifying the Test Suite
Ensure the codebase is working by executing the testing pipelines:
```bash
# In the backend terminal
npm test

# In the frontend terminal
npm run cypress:run
```
All tests should pass (green).

---

## 🛠️ Hands-On Codebase Walkthrough Exercises

To understand how the files fit together, complete these three onboarding exercises:

### Exercise 1: Customize a UI Accent & Track Re-renders
* **Goal**: Understand Tailwind CSS v4 configurations, component re-renders, and custom selectors.
* **Task**:
  1. Open [BarterCard.jsx](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-frontend/src/components/dash/BarterCard.jsx).
  2. Locate the hover scale transitions and modify the card border-color on hover to a brighter emerald ring.
  3. Inside the card component, place a simple console log (`console.log('Rendering Card #', offer.id)`) and observe the logs in your browser console as you change filters. Note how `useMemo` in `Dashboard.jsx` successfully shields these cards from unnecessary re-renders.

### Exercise 2: Add an Audit Log Event
* **Goal**: Trace how database mutations, Express routes, and audit trails function.
* **Task**:
  1. Open [adminRoutes.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/routes/adminRoutes.ts) and locate the `/users` POST route (`router.post('/users', ...)`).
  2. Modify the details string of `logActivity` when manually creating a student to include the email address of the created student.
  3. Spin up your backend, navigate to the Admin Dashboard under "Database Mahasiswa", create a test user, and verify that the "System Activity Logs" table instantly reflects your updated audit detail message via Socket.IO!

### Exercise 3: Add a Custom Validation Parameter
* **Goal**: Learn how API endpoints, Express controllers, and Zod schemas validate data inputs.
* **Task**:
  1. Open [offerController.ts](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/src/controllers/offerController.ts).
  2. Locate the `createOfferSchema` Zod model.
  3. Add a validator parameter to ensure that `myClassId` and `wantedClassId` are positive, non-zero integers, and write a corresponding unit test inside `offerController.test.ts`.

---

## 📊 Auto-Generating Visual Code Graphs & Interactive Docs

Since this codebase utilizes modern TypeScript and React structures, we can integrate tools to automatically map relationships, dependency graphs, and code hierarchies:

### 1. Generating Module Dependency Graphs (with Madge)
**Madge** is a developer-favorite NPM package that analyzes module structures, finds circular dependencies, and automatically generates an interactive graphical SVG of code hierarchies.

```bash
# 1. Install Madge globally or as a devDependency in your workspace
npm install --save-dev madge

# 2. Generate a visual module dependency tree for the Backend
npx madge --image backend-graph.svg --layout dot KRSwitch-backend/src/server.ts

# 3. Generate a visual component dependency tree for the Frontend
npx madge --image frontend-graph.svg --layout dot KRSwitch-frontend/src/main.jsx
```
*Note: Generating graphic SVGs requires `graphviz` installed on your operating system (`sudo apt-get install graphviz`).*

### 2. Generating Database Entity-Relationship Diagrams (with Prisma)
Rather than manually updating blueprints, you can use `prisma-erd-generator` to auto-generate a high-fidelity Mermaid/SVG ERD diagram every time you alter your database models.

1. Install the generator in `KRSwitch-backend`:
   ```bash
   npm install --save-dev prisma-erd-generator @mermaid-js/mermaid-cli
   ```
2. Append the following block to your [schema.prisma](file:///home/gimigkk/Desktop/Projects/KRSwitch/KRSwitch-backend/prisma/schema.prisma):
   ```prisma
   generator erd {
     provider = "prisma-erd-generator"
     output   = "../db-erd.svg"
     theme    = "dark"
   }
   ```
3. Run `npx prisma generate` to output an updated SVG diagram at your backend root automatically.

### 3. Generating API HTML Documentation Sites (with TypeDoc)
For rich JSDoc-derived TypeScript API documentations, **TypeDoc** compiles source comments into searchable, premium HTML sites.

```bash
# 1. Install TypeDoc in the backend
npm install --save-dev typedoc

# 2. Compile comments and source schemas into an HTML document portal
npx typedoc --out docs src/
```
Open `docs/index.html` in your browser to explore your self-documenting REST & Socket endpoint modules.

---

*KRSwitch is built to be modular, transparent, and exciting to work on. Welcome to the team!*

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
