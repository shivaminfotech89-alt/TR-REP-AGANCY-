# Security Specification

## Data Invariants
1. Every document must have `ownerId` matching the authenticated user's UID.
2. Jobs, inspections, estimates, bills, oil accounts, and challans are owner-scoped.
3. Inspection `data` must be a map (structured fields), not free-form oversized strings.
4. Job `createdAt` and `ownerId` are immutable after create.
5. Estimate / bill / oil / challan `createdAt` and `ownerId` are immutable after create.
6. String fields must not exceed specified lengths (DoW protection).
7. Circle office estimate limits are agency-configurable but not privilege-escalating.

## The Dirty Dozen Payloads
1. Create Job with invalid ownerId (Identity Spoofing).
2. Create Job with unauthenticated user.
3. Update Job with extra ghost field `isAdmin: true`.
4. Update Job's `ownerId` (Identity modification).
5. Create Job with missing required field `make`.
6. Create Job with oversized `jobNo` (Resource Poisoning).
7. Create Inspection without `jobId`.
8. Create Inspection with `data` as string instead of map.
9. Update Inspection modifying `ownerId`.
10. Read Job without authentication.
11. Read Estimate not owned by user.
12. Create Bill for another user's jobs via forged ownerId.
