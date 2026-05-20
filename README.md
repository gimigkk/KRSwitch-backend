# KRSwitch Backend — Schedule Exchange API Engine

The KRSwitch backend is a robust API engine built with Express and Prisma, designed to manage parallel class schedules, process atomic barter exchanges, and synchronize real-time events over WebSockets.

## 🌟 Core Engine Capabilities

*   **Atomic Matchmaking:** Schedule swaps run in isolated PostgreSQL transaction blocks to guarantee consistency and prevent race conditions (double-claiming).
*   **Real-Time Sync:** Socket.IO server pushes live feed updates, online telemetry, and swap notifications instantly to connected clients.
*   **Secure Authentication:** Hardened Google OAuth 2.0 PKCE flow with strict SameSite JWT cookie management and domain purging.
*   **High-Load Tested:** Validated through a custom CLI simulator to handle staggered concurrent transactions with sub-millisecond latencies.

## 📖 Documentation

The complete API and architecture documentation is available in the `docs/` directory:

- [Getting Started](docs/getting-started.md) - Database initialization, environment variables, and seeding.
- [Architecture](docs/architecture.md) - Express routing, middleware, and OAuth verification flow.
- [Database](docs/database.md) - PostgreSQL schema, Prisma ERD, and mock data generators.
- [API Reference](docs/api-reference.md) - Transactional logic and Zod validation schemas.
- [WebSockets & Real-Time](docs/websockets.md) - Connection handshakes and channel topologies.
- [Testing](docs/testing.md) - Vitest suites and load simulation engine setup.
