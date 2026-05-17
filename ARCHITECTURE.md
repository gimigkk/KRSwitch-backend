# 📐 KRSwitch Backend — Architectural Flows & Data Blueprints

This blueprint maps the runtime lifecycle, transaction blocks, and data topologies inside the KRSwitch backend engine.

---

## 1. Backend Service Boundaries

The Express API orchestrates route validations, cookie hardening, and WebSocket connectivity. The PostgreSQL database operations run via Prisma ORM:

```mermaid
graph TD
    %% Client & Server Interfaces
    FE["React Client Interface"]
    GO["Google OAuth Service"]

    subgraph ServiceLayer ["Express 5 Engine & API Gateway"]
        AuthMiddleware["Auth Middleware (Token Parser Loop)"]
        Router["Express Core Router"]
        SocketServer["Socket.IO Connection Server"]
    end

    subgraph DataLayer ["Data Access & Storage"]
        Prisma["Prisma ORM Client"]
        Postgres[("PostgreSQL 16 Engine")]
    end

    %% Flow lines
    FE -->|HTTP API Requests| AuthMiddleware
    FE <-->|Bidirectional WebSockets| SocketServer
    
    AuthMiddleware -->|Validated State| Router
    Router -->|Transaction queries| Prisma
    Prisma <-->|Connection Pool| Postgres
    
    Router <-->|PKCE Code verification| GO
```

---

## 2. Google OAuth 2.0 PKCE Verification

The callback service performs the state validation, exchanges authentication codes, loops cookies, and establishes secure SameSite contexts:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Browser
    participant BE as Express API Server
    participant GO as Google OAuth Service
    participant DB as PostgreSQL Database

    Client->>BE: GET /auth/google (Init PKCE challenge)
    BE-->>BE: Generate Code Verifier & Cryptographic State
    BE-->>Client: Set short-lived 'oauth_ctx' cookie (HttpOnly, Secure, SameSite=Lax)
    BE-->>Client: Redirect to Google Login
    Client->>GO: Authenticate
    GO-->>Client: Redirect to /auth/google/callback?code=CODE&state=STATE
    Client->>BE: GET /auth/google/callback
    BE-->>BE: Verify 'oauth_ctx' state parameter
    BE->>GO: POST /token (Exchange Code Verifier)
    GO-->>BE: Return ID Token & profile data
    BE->>DB: Check if user exists & isActive === true
    DB-->>BE: Return active user model
    
    Note over BE,Client: Hardened Session: Purge stale 'token' cookies from subdomains
    BE-->>Client: Set new JWT 'token' cookie (7d, HttpOnly, SameSite=Lax)
    BE-->>Client: Redirect to Client Dashboard
```

> [!NOTE]
> **Sequential Cookie Purge**: To bypass browser zombie session locking across different local subdomains, the Auth Middleware parses the full header token array sequentially and invalidates stale scopes before binding the new active JWT payload.

---

## 3. Atomic Barter Matchmaking Engine

Schedule swaps run strictly within isolated PostgreSQL database locks (`prisma.$transaction`) to prevent concurrency double-claiming:

```mermaid
flowchart TD
    classDef startStop fill:#1b1b1b,stroke:#059669,stroke-width:2px,color:#fff;
    classDef process fill:#2a2a2a,stroke:#374151,stroke-width:1px,color:#fff;
    classDef decision fill:#1e293b,stroke:#047857,stroke-width:1.5px,color:#fff;

    Start([Barter offer created]):::startStop
    Start --> InitTx[1. Initialize isolated prisma.$transaction]:::process
    InitTx --> LockDB[2. DB-Lock check: Counter-offer exists? <br> myClassId === wantedClassId && wantedClassId === myClassId]:::process
    
    LockDB --> MatchExist{3. Counter-Offer exists?}:::decision
    
    MatchExist -- "No" --> SaveOpen[4. Create open offer in database]:::process
    SaveOpen --> EmitNew[5. Broadcast Socket event: new-offer]:::process
    EmitNew --> SuccessReturn([End: Offer published]):::startStop

    MatchExist -- "Yes" --> ValidateActive{5. Participants still enrolled in original classes?}:::decision
    
    ValidateActive -- "No" --> RollbackTx[6. Terminate Transaction & Rollback state]:::process
    RollbackTx --> ReturnFail([End: Match skipped, offer remains open]):::startStop

    ValidateActive -- "Yes" --> ScheduleCheck{6. Swapped schedules overlap for either user?}:::decision

    ScheduleCheck -- "Yes" --> RollbackTx
    
    ScheduleCheck -- "No" --> SwapEnrollments[7. Swap parallelClassId values in enrollments table]:::process
    SwapEnrollments --> UpdateOfferStatus[8. Update statuses of both offers to matched]:::process
    UpdateOfferStatus --> CancelStale[9. Run cancelStaleOffers: cancel other pending conflicting offers]:::process
    CancelStale --> CreateNotifs[10. Generate notification records]:::process
    CreateNotifs --> CommitTx[11. Commit PostgreSQL transaction]:::process
    CommitTx --> EmitSuccess[12. Broadcast Socket.IO events: offer-taken & enrollments-swapped]:::process
    EmitSuccess --> EndSuccess([End: Swap complete]):::startStop
```

> [!IMPORTANT]
> **Schedule Overlap Rule**: The interval conflict algorithm evaluates overlapping blocks (`startA < endB && startB < endA`) based on zero-padded standard days and hours. If a conflict is discovered at step 6, the transaction aborts instantly.

---

## 4. WebSocket Event Topology

The Socket.IO server establishes authentication boundaries and broadcasts state updates across channels:

*   **Auth Room Boundary**: Connections must complete token verification inside `10 seconds`. Stale socket keys force disconnections.
*   **System Channels**:
    *   `online-count`: Current active socket footprint.
    *   `new-offer`: Informs clients to append listings to feed pages.
    *   `offer-taken`: Broadcasts trade completions to clean client listings.
    *   `enrollments-swapped`: Broadcasts swapped schedules parameters.

---

## 5. Load Simulator Engine Flow

The simulation orchestrator (`simulator.js`) stresses API layers under behavioral weight loads:

```
[ orchestrator ]
       │
       ├─► 1. Query valid barter targets
       ├─► 2. Initialize Telemetry log
       ├─► 3. Spin up concurrent virtual users (Ramping)
       │
       ▼
 [ User Personas ]
       │
       ├─► Aggressive (15%) ────► Think: 200-1000ms   ──► Action: Accept Offers (85%)
       ├─► Moderate (40%)   ────► Think: 500-2500ms   ──► Action: Accept / Browse (65%)
       ├─► Passive (30%)    ────► Think: 1000-4000ms  ──► Action: Browse / Create (45%)
       └─► Lurkers (15%)    ────► Think: 2000-6000ms  ──► Action: Browse Only (95%)
       │
       ▼
  [ API /take Endpoint ]
       │
       ├─► Staggered concurrent HTTP POST requests within 100ms
       └─► PostgreSQL transactional lock guarantees atomic single winner
```

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
