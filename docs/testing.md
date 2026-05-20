# Testing

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

## ⚡ High-Load Simulator Engine Flow

The simulation orchestrator (`simulator.js`) is a CLI load testing client designed to stress backend transactional APIs under load profiles:

* **User Personas**: Configures concurrent actors across 4 distinct behavioral sets (Aggressive, Moderate, Passive, Lurker) with variable think times and browse/take weight ratios.
* **Race Simulator**: Staggers concurrent `/take` requests inside a 100ms window, collecting success rates and percentiles.
* **Telemetry**: Outputs avg latency, throughput, and p95/p99 latency indexes.

```text
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
