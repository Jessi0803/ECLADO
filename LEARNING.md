# Engineering Capability Development

This file tracks demonstrated engineering capability, not exposure to explanations and not feature completion. Unassessed means there is not yet enough direct evidence; it does not mean the skill is absent.

## Level Scale

- `Unassessed` — No direct evidence has been collected yet.
- `L0 Unknown` — Assessment shows the concept is not currently understood.
- `L1 Seen` — Recognizes the concept with substantial prompting.
- `L2 Developing` — Can propose a partial solution and discuss some risks with guidance.
- `L3 Independent` — Can explain, design, and debug the concept independently in normal cases.
- `L4 Strong` — Can lead design and review, explain trade-offs, and identify non-obvious failure modes.

## Competencies

### Swift / iOS

#### Swift Concurrency

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess only through an actual concurrency design or debugging interaction.

#### Actor / Data Isolation

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess only through an actual isolation, Sendable, or shared-state problem.

#### Memory Management

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through ownership, lifecycle, retain-cycle, or leak analysis.

#### UIKit Architecture

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through a real UIKit design or refactoring decision.

#### SwiftUI State Management

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through a real state ownership, observation, or navigation problem.

### Architecture

#### Modular Architecture

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through module boundaries, coupling, ownership, or dependency direction.

#### Dependency Injection

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through testability, composition, lifecycle, or dependency-boundary work.

### Backend / Database

#### Database Transactions

- Level: L1 Seen
- Last reviewed: 2026-09-24
- Evidence: Recognized that a duplicate shopping-credit consumption rejected by a database uniqueness rule must roll back the whole request rather than leave partial writes.
- Notes: Continue practicing transaction boundaries that combine order creation, balance checks, reservations, ledger entries, and rollback behavior.

#### Race Conditions

- Level: L2 Developing
- Last reviewed: 2026-09-23
- Evidence: Explained that optimistic concurrency detects stale state through a version rather than user identity; recognized that independent records should update concurrently while edits to the same inventory record require conflict handling.
- Notes: Continue practicing transaction boundaries, retry UX, and conflicts that occur between counting, stock movements, and finalization.

#### Idempotency

- Level: L1 Seen
- Last reviewed: 2026-09-24
- Evidence: Identified order state as the first guard against duplicate payment-callback processing and understood, after prompting, that a duplicate consume event must be rejected and rolled back.
- Notes: Continue practicing the difference between application-level state checks, database uniqueness, and returning a successful no-op response for already-processed callbacks.

#### Database Schema Design

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through constraints, normalization, snapshots, migrations, or data ownership.

### API / Security

#### Authentication vs Authorization

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through an actual identity and access-control decision.

#### API Authorization / IDOR

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through object-level access control and server-side ownership verification.

#### Server-side Validation

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through trust boundaries and authoritative validation design.

### E-commerce

#### Payment Webhooks

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through signature verification, retries, ordering, and payment-state updates.

#### Order State Design

- Level: Unassessed
- Last reviewed: Never
- Evidence: None yet.
- Notes: Assess through state transitions, invariants, recovery, and operational exceptions.

#### Inventory Consistency

- Level: L2 Developing
- Last reviewed: 2026-09-23
- Evidence: Distinguished physical on-hand inventory from sellable stock after order allocation, reasoned that unshipped/uncollected allocations remain physically onsite, applied a physical shortage as a delta to current sellable stock without reversing valid order deductions, identified that blank count entries must block finalization because blank cannot prove that an item was physically checked, chose a creation-time frozen item scope, required completed count sheets to remain immutable, preserved FIFO customer priority by converting the newest affected allocations to shortages first, and separated normal gift checkout validation from exceptional gift shortages discovered by a later physical count.
- Notes: Continue practicing the equation `physical = sellable + onsite allocated`, especially variance direction and avoiding a second deduction of inventory already reserved at payment; also practice recovery UX and atomic finalization.

#### Promotion / Coupon Architecture

- Level: L1 Seen
- Last reviewed: 2026-09-24
- Evidence: Correctly explained that shopping credit is a payment method rather than a discount, so using it after promotion and coupon calculations must not remove an already-earned free-shipping qualification.
- Notes: Continue practicing calculation order, qualification bases, stacking rules, and immutable order snapshots.

## Active Learning

- Database Transactions — atomic shopping-credit reservation and ledger updates
- Idempotency — duplicate order creation and payment-callback protection
- Promotion / Coupon Architecture — separating discounts from payment instruments

## Learning History

### 2026-09-23 — Inventory Consistency / Race Conditions — Collaborative stock count

- Problem: Design a stock-count workflow that can coexist with order allocation and multiple administrators without overwriting legitimate inventory movements.
- My initial reasoning: Create a stock snapshot, calculate gain/loss, apply the difference to the current stock, include gift inventory, and initially consider limiting changes to the creator to avoid synchronization issues.
- What I missed: Physical on-hand and sellable stock have different meanings; version-based conflict detection works even when two devices share the same account; the concurrency boundary should be per count item rather than the entire count session.
- Final understanding: Unshipped or uncollected allocations remain physically onsite. Count variance adjusts current sellable stock without reversing valid order deductions. Each count item can use its own version so different items update concurrently while stale edits to the same item are rejected. Finalization must require an explicit physical count for every item; blank is an incomplete state, while an entered value equal to the theoretical quantity is an intentional zero variance. The count scope is frozen when the session is created so newly created variants do not change its completion criteria. Completed count sheets are immutable. If a shortage exceeds currently sellable stock, sellable stock stops at zero and the newest onsite order allocations become shortages first, preserving older customer priority. Gift checkout still requires available stock, while a count-discovered shortage becomes an exceptional gift follow-up rather than blocking an accurate count.
- Evidence of understanding: Correctly explained version comparison, separated conflict control from user identity, identified the audit limitation of shared accounts, proposed allowing concurrent updates to independent inventory records, justified blocking completion when any item remains uncounted, chose a frozen and immutable count record, preserved FIFO fulfillment priority by removing allocation from newest orders first, identified why an unexpected post-allocation gift shortage needs an explicit operational recovery path without weakening normal checkout validation, and completed a follow-up check by connecting delta application to intervening order reservations, row versions to overwrite prevention, FIFO to shortage priority, and count-time gift shortages to exceptional reconciliation. After an initial mistake involving variance direction and double-counting reserved inventory, correctly applied `actual - (sellable + onsite allocated)` in a new example and derived the adjusted sellable stock independently.
- Level change: `Unassessed → L2 Developing` for Race Conditions and Inventory Consistency.

### 2026-09-24 — Database Transactions / Idempotency / Promotion Architecture — Shopping credit scope

- Problem: Define a permanent member shopping-credit system that cannot be double-spent, remains auditable, and composes correctly with promotions, coupons, shipping, cancellation, and payment callbacks.
- My initial reasoning: Was initially unsure how to prevent two browser tabs from spending the same balance, then identified that the second order should see zero available after the first reserves the credit and that cancellation should restore it. Chose immutable positive/negative usage records, an account summary backed by a ledger, and status checks for repeated payment callbacks.
- What I missed: A frontend balance check does not prevent concurrent requests; balance validation and reservation must be atomic. A state check alone does not stop two simultaneous callbacks, so the database also needs a unique order event and the duplicate request must become an idempotent no-op externally.
- Final understanding: Shopping credit moves through available, reserved, consumed, released, and refunded events. Account summaries and immutable ledger entries update together in one transaction. Duplicate consume events are prevented at the database level and repeated callbacks do not create another deduction. Shopping credit is a payment instrument applied after promotions, coupons, and shipping qualification, so spending it does not revoke earned free shipping.
- Evidence of understanding: Correctly derived that a second checkout sees zero after the balance is reserved, that cancellation returns the reservation to available balance, that ledger records must not be edited or deleted, that a rejected duplicate write rolls back, and independently explained why free shipping remains valid after shopping-credit payment.
- Level change: `Unassessed → L1 Seen` for Database Transactions, Idempotency, and Promotion / Coupon Architecture.

When a future interaction provides valid evidence, append an entry in this format:

### YYYY-MM-DD — Competency — Short topic

- Problem:
- My initial reasoning:
- What I missed:
- Final understanding:
- Evidence of understanding:
- Level change: `Previous → New` or `No change`
