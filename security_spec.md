# Security Specification — Trolley Titans

## 1. Data Invariants
1. **Single Active Session Per Trolley**: A trolley document (`/trolleys/{trolleyId}`) may only transition from `AVAILABLE` (`activeSessionId == null`) to `IN_USE` atomically inside a transaction that creates `/sessions/{sessionId}` with `trolleyId` matching the trolley and `status == 'ACTIVE'`.
2. **Staff-Only Payment & Session Closure**: Only verified staff (`isStaff()`) may mark `paymentStatus = 'PAID'`, set `physicalVerified = true`, transition `status` to `'PAID'` or `'CLOSED'`, and release `/trolleys/{trolleyId}` back to `AVAILABLE`. Authorized staff may also close an **empty** `ACTIVE` demo session (`itemCount == 0 && grandTotal == 0 && paymentStatus == 'UNPAID'`) directly to `status: 'CLOSED'` (keeping `paymentStatus: 'UNPAID'`) while atomically releasing its trolley; non-empty sessions still strictly require `paymentStatus == 'PAID'` and `physicalVerified == true`.
3. **Immutable Historical Bills**: `delete` is unconditionally denied (`if false`) on `/sessions`, `/trolleys`, and `/counters`. Once a session reaches `CLOSED`, no non-admin or terminal updates are allowed.
4. **Cart Lock After Payment**: Line items in `/sessions/{sessionId}/items/{itemId}` can only be created, updated, or deleted while the parent `/sessions/{sessionId}` has `status in ['ACTIVE', 'CHECKOUT_READY']` and `paymentStatus == 'UNPAID'`.
5. **No Open Reads/Writes**: Zero rules use `if true`. All documents require strict schema, key, type, boundary, and `request.time` timestamp validation.

## 2. Dirty Dozen Adversarial Payloads
1. **Hijack Occupied Trolley**: Customer attempts to overwrite `trolleys/T001` when `status == 'IN_USE'` -> `PERMISSION_DENIED` (blocked by `existing().status == 'AVAILABLE'`).
2. **Self-Approve Payment**: Customer updates `sessions/CUST001` setting `paymentStatus: 'PAID'` or `status: 'CLOSED'` -> `PERMISSION_DENIED` (only `isStaff()` allowed).
3. **Skip Payment Before Close on Non-Empty Cart**: Staff attempts to set `status: 'CLOSED'` when `paymentStatus == 'UNPAID'` and `itemCount > 0` or `grandTotal > 0` -> `PERMISSION_DENIED`.
4. **Orphan Session Without Trolley Lock**: Customer creates `sessions/CUST099` without atomically updating `trolleys/T001` in the same transaction -> `PERMISSION_DENIED` (blocked by `getAfter`).
5. **Modify Paid Cart**: Customer adds/deletes item in `sessions/CUST001/items/PROD001` after `paymentStatus == 'PAID'` -> `PERMISSION_DENIED` (blocked by parent `get()`).
6. **Shadow Field Injection**: Payload includes extra key `isAdmin: true` or `discount: 999` -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
7. **Timestamp Spoofing**: Payload sets `createdAt` or `updatedAt` to a client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **Negative Price / Excess GST**: Staff/bootstrap attempts to create product with `price: -10` or `gstRate: 500` -> `PERMISSION_DENIED`.
9. **Delete Bill History**: Anyone attempts `delete` on `sessions/CUST001` -> `PERMISSION_DENIED`.
10. **ID Poisoning**: Document ID contains 1KB string or special characters -> `PERMISSION_DENIED` (blocked by `isValidId`).
11. **Counter Manipulation**: Customer decrements or jumps `counters/customerSeq` (`nextNumber: 1` -> `nextNumber: 500`) -> `PERMISSION_DENIED` (requires `nextNumber == existing().nextNumber + 1`).
12. **Unverified Staff Spoof**: User with `email_verified: false` or non-allowlisted email attempts to mark `PAID`, close an empty session, or add staff -> `PERMISSION_DENIED`.
