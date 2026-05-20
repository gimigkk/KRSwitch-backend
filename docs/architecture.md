# Architecture

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

## 3. Session Management & Cookie Hardening
To prevent persistent session issues across localhost and subdomain boundaries, the authentication pipeline uses the following strategies:
* **Domain Purging**: Stale authenticated cookies are proactively cleared from both host-only, localhost subdomains, and configured remote origins during logout and invalid checks.
* **Token Loop**: If the request headers contain duplicate or stale tokens, the verification middleware parses them in sequence until a valid, active session is identified.
* **Status Checks**: Route guards check `isActive === true` inside the database, immediately revoking access from disabled user records regardless of token expiration.

> [!WARNING]
> **Cookie Scopes**: Ensure your `.env` config defines `COOKIE_DOMAIN` strictly to match your execution domain. Mismatched cookie domain configurations can lead to stale JWT parsing errors and session locks in browsers.
