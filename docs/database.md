# Database

## 1. Database Schema

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

## 2. Prisma Database ERD (prisma-erd-generator)
Generates dynamic ERD files during Prisma database generation:
```bash
npm install --save-dev prisma-erd-generator @mermaid-js/mermaid-cli
```
Add to `prisma/schema.prisma`:
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

## 3. Simulation & Seeding Utilities

### Seeding Engine (`enhanced-seed.js`)
An algorithm designed to populate the system with 151 students across 7 courses under strict constraints:
* **Section Distribution**: Auto-calculates capacity distributions, resolving section assignments (`Kn` to `Pn/Rn` classes) symmetrically with zero conflicts.
* **CSV Sync**: Outputs generated layouts back into mock CSV files within `/mock_data` to synchronize source structures.
