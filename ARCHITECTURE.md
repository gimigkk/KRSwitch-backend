# KRSwitch — System Architecture & Data Flows

This document details the system architecture, authentication lifecycles, and atomic transactional flows for the KRSwitch platform.

---

## 1. System Topology

KRSwitch is a real-time, decoupled client-server application. The diagram below maps the components, network boundaries, and database paths:

```mermaid
graph TD
    %% User Nodes
    Student["Student Browser"]
    Admin["Admin Browser"]

    %% Frontend Group
    subgraph FrontendApp ["Client (React 19 + Vite 7 + Tailwind CSS v4)"]
        UI["React Component Tree"]
        WSClient["Socket.IO Client"]
        Axios["Axios API Client"]
    end

    %% Backend Group
    subgraph BackendApp ["Server (Express 5 + Node 20)"]
        Express["Express API Server"]
        WSServer["Socket.IO Server"]
        PrismaClient["Prisma ORM Client"]
        AuthMiddleware["Auth Middleware"]
    end

    %% External & DB
    GoogleAuth["Google OAuth 2.0 (PKCE)"]
    Postgres[("PostgreSQL 16 DB")]

    %% Relations
    Student --> UI
    Admin --> UI
    
    UI --> Axios
    UI --> WSClient
    
    Axios --> AuthMiddleware
    AuthMiddleware --> Express
    WSClient <--> WSServer
    
    Express --> PrismaClient
    PrismaClient <--> Postgres
    
    Express <--> GoogleAuth
    UI <--> GoogleAuth
```

---

## 2. Authentication & Session Validation Flow

To prevent session locking due to duplicate browser scopes (e.g., mixing host-only and `localhost` subdomains), the authentication service uses a sequential cookie parsing loop and targeted scope purge:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant FE as React Frontend
    participant BE as Express Backend
    participant GO as Google OAuth

    User->>FE: Click Login
    FE->>BE: GET /auth/google (Request PKCE challenge)
    BE-->>BE: Generate Code Verifier & cryptographic state
    BE-->>User: Set short-lived 'oauth_ctx' cookie (HttpOnly, Secure, SameSite=Lax)
    BE-->>User: Redirect to Google
    User->>GO: Authenticate & Authorize
    GO-->>User: Redirect to callback with code & state
    User->>BE: GET /auth/google/callback?code=CODE&state=STATE
    BE-->>BE: Verify 'oauth_ctx' state parameter
    BE->>GO: POST /token (Exchange code)
    GO-->>BE: Return profile details
    BE-->>BE: DB check: User isActive === true
    
    Note over BE,User: Clear stale 'token' cookies across localhost and host domains
    BE-->>User: Set new JWT session 'token' cookie (7d, HttpOnly, SameSite=Lax)
    BE-->>User: Redirect to FE with ?success=true
    FE->>User: Close OAuth popup
    FE->>BE: GET /api/me (Request profile context)
    BE->>User: Parse cookie list (loops tokens to bypass ghost cookies)
    BE-->>FE: Return user context
```

> [!NOTE]
> **Ghost Cookie Handling**: If duplicate JWT session cookies exist across subdomains, the backend auth middleware iterates through all incoming token values sequentially until a valid signature is found, preventing arbitrary lockouts.

---

## 3. Atomic Barter Matchmaking Engine

Barter matching runs in a PostgreSQL transaction (`prisma.$transaction`) to block race conditions. The logic below determines if a trade is executed immediately or placed in the open ledger:

```mermaid
flowchart TD
    classDef startStop fill:#1b1b1b,stroke:#059669,stroke-width:2px,color:#fff;
    classDef process fill:#2a2a2a,stroke:#374151,stroke-width:1px,color:#fff;
    classDef decision fill:#1e293b,stroke:#047857,stroke-width:1.5px,color:#fff;

    Start([Student creates Barter Offer]):::startStop
    Start --> InitTx[1. Initialize isolated prisma.$transaction]:::process
    InitTx --> LockDB[2. Query counter-offer: myClassId === wantedClassId && wantedClassId === myClassId]:::process
    
    LockDB --> MatchExist{3. Matching counter-offer exists?}:::decision
    
    MatchExist -- "No" --> SaveOpen[4. Create status: open barter offer]:::process
    SaveOpen --> EmitNew[5. Broadcast Socket.IO event: new-offer]:::process
    EmitNew --> SuccessReturn([End: Offer published]):::startStop

    MatchExist -- "Yes" --> ValidateActive{5. Both participants enrolled in expected sections?}:::decision
    
    ValidateActive -- "No" --> RollbackTx[6. Abort transaction & Rollback state]:::process
    RollbackTx --> ReturnFail([End: Match skipped, offer remains open]):::startStop

    ValidateActive -- "Yes" --> ScheduleCheck{6. Swapped schedules overlap for either user?}:::decision

    ScheduleCheck -- "Yes" --> RollbackTx
    
    ScheduleCheck -- "No" --> SwapEnrollments[7. Swap parallelClassId values in enrollments table]:::process
    SwapEnrollments --> UpdateOfferStatus[8. Update statuses of both offers to matched]:::process
    UpdateOfferStatus --> CancelStale[9. Run cancelStaleOffers: cancel other pending conflicting offers]:::process
    CancelStale --> CreateNotifs[10. Generate system notification records]:::process
    CreateNotifs --> CommitTx[11. Commit PostgreSQL transaction]:::process
    CommitTx --> EmitSuccess[12. Broadcast Socket.IO events: offer-taken & enrollments-swapped]:::process
    EmitSuccess --> EndSuccess([End: Swap complete]):::startStop
```

> [!IMPORTANT]
> **Transactional Isolation**: The matchmaking phase queries and updates student registrations in an atomic database lock block. If schedule overlaps are caught or a counter-offer is concurrently claimed, the transaction rolls back cleanly with no partial modifications saved.

---

## 4. WebSocket Event Topology

Real-time state synchronization is managed via **Socket.IO**:

```
                  ┌────────────────────────┐
                  │    Socket.IO Server    │
                  └───────────┬────────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌──────────────────┐               ┌──────────────────┐
   │ Broadcast Room   │               │ Private Rooms    │
   │  (Public Feed)   │               │ ('user-{nim}')   │
   └─────────┬────────┘               └────────┬─────────┘
             │                                 │
   ┌─────────┼─────────┐             ┌─────────┼─────────┐
   ▼         ▼         ▼             ▼         ▼         ▼
online-   new-      offer-        new-      enrollment-  auth-
count     offer     taken         notif     updated      error
```

* **Broadcast Room**: Pushes real-time class feed alterations to all active browsers immediately.
* **Private Rooms**: Handles target-specific messages (e.g., transaction results or administrative schedule changes) strictly to the authenticated student's session.

> [!TIP]
> **WebSocket Security Check**: Unauthenticated socket connections are allowed to connect but placed inside a **10-second authentication window**. If they fail to emit the validated token handshake, the connection is forcefully closed.

---

## 5. Load Simulator Topology

The simulation engine (`simulator.js`) mimics concurrent actions using configured behaviors:

```
[ orchestrator ]
       │
       ├─► 1. Query current valid barter pairs
       ├─► 2. Initialize Telemetry log
       ├─► 3. Spin up concurrent virtual users (Ramp up)
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
       └─► Atomic DB transaction locks row; 1st succeeds, others return 400
       │
       ▼
[ Telemetry Analytics ]
       │
       ├─► Calculate Avg Response Times & Throughput
       └─► Calculate p95 and p99 latency percentiles
```

---

## 👥 Developer Credits

This project is engineered and maintained with ❤️ by:
1. **Gilang Muhamad Widiagung**
2. **Azka Julian**
3. **Muhammad Arifaushan**
