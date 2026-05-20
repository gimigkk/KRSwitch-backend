# API Reference

## 1. Atomic Database Operations
Administrative CSV imports (`/import-students`, `/import-classes`) are atomic:
* **Transaction Rollback**: If any record fails schema constraint validation, the transaction rolls back completely to protect integrity.
* **CSV Injection Guard**: Formulas prefixes (`=`, `+`, `-`, `@`) are stripped or escaped during parsing to guard spreadsheet exports against formula injections.

## 2. Two-Way Atomic Matchmaking
The matchmaking logic runs inside a transactional context (`prisma.$transaction`) to prevent concurrency race conditions:
* **Conflict Prevention**: Prior to executing schedule swaps, the engine checks time overlaps (`startA < endB && startB < endA`) based on days and hours formatted in `HH:MM`.
* **Cascade Cancellation**: Upon a successful swap, all other open offers owned by the participants that conflict with their newly assigned schedules, or reference sections they no longer hold, are automatically marked as `cancelled`.
* **Race Condition Blocks**: When multiple HTTP POST requests attempt to `/take` the same offer at the same millisecond, database-level locking ensures only the first request succeeds while subsequent requests return a `400 Bad Request`.

> [!IMPORTANT]
> **Transaction Locks**: Matchmaking queries utilize PostgreSQL row-level locks within the transaction block. This guards critical database states against double-claim swaps when parallel clients select the same barter offer concurrently.

### Matchmaking Engine Diagram
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

## 3. Exercise: Custom Validation Rules
* **Goal**: Trace API schema validations in `offerController.ts`.
* **Task**:
  1. Locate `createOfferSchema` Zod definition.
  2. Append rules requiring `myClassId` and `wantedClassId` to be positive, non-zero integers.
  3. Append a matching test case in `offerController.test.ts`.
