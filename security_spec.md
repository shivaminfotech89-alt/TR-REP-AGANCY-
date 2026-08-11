# Security Specification

## Data Invariants
1. A job must have an ownerId matching the authenticated user's UID.
2. An inspection must reference a valid job and have an ownerId matching the user's UID.
3. String fields must not exceed specified lengths to prevent Denial of Wallet.

## The Dirty Dozen Payloads
1. Create Job with invalid ownerId (Identity Spoofing).
2. Create Job with unauthenticated user.
3. Update Job with extra ghost field `isAdmin: true`.
4. Update Job's `ownerId` (Identity modification).
5. Create Job with missing required field `make`.
6. Create Job with oversized `jobNo` (Resource Poisoning).
7. Create Inspection without `jobId`.
8. Create Inspection with invalid `jobId` type (number).
9. Update Inspection modifying `ownerId`.
10. Read Job without authentication.
11. Read Job not owned by user.
12. List Jobs not owned by user.
