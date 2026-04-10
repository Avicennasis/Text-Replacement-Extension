# Code Review TODO

## Round 2 (completed in commit d728c96)

- [x] All 39 findings implemented

## Round 3 (completed in commit 21a1cab)

- [x] All 28 findings implemented

---

## Round 4 (completed in commit 7f68d32)

- [x] All 41 findings implemented

---

## code review (2026-04-09)

Reviewed 26 automated review sessions + 5 additional suggestions. Results:

**Accepted:**
- [x] Fix TypeError when importing JSON file containing `null` (commit 5d7e00a)
- [x] Observe `documentElement` instead of `document.body` for MutationObserver (commit 0b06bfa)
- [x] Extract `findCaseInsensitiveCollision()` to deduplicate collision checks (commit c1e2360)

**Rejected (with rationale):**
- `estimateStorageSize` tests — 3-line function, test would reimplement same calculation
- `shouldProcessNode` tests — already exercised by integration tests in benchmark.js
- `escapeRegExp` tests — single-line function, covered by benchmark correctness checks
- `RegexTimeoutError` tests — trivial Error subclass
- `safeWordMap` tests — 4-line type guard
- `validateStorageQuota` tests — trivial integer comparison, constants not mockable per-test
- `background.js` install handler tests — just two log statements
- `ConfigureAwait(false)` — no SynchronizationContext in Worker Services
- Filter performance (`rule-row` class) — max 255 rows, sub-microsecond querySelectorAll
- Collision loop optimization — max 255 rules, unmeasurable on button click
- `replaceCallback` cache optimization — V8 already optimizes property lookups on null-prototype objects
- `safeWordMap` returning `Object.create(null)` — redundant, reserved keys blocked at all entry points
- Auto-backup before import — big UX redesign for marginal safety gain
- MV2 `browserAction` fallback removal — zero-cost safety net
- `__defineGetter__`/`__defineSetter__` in RESERVED_KEYS — deprecated legacy methods, not a real vector
- 3 sessions were destructive regressions (stripped safety guards, removed `'use strict'`, etc.)

## Backlog (low priority)

- [ ] Replace `while/removeChild` loop (manage.js:415) with `replaceChildren()` — cleaner one-liner, stays within explicit DOM API convention
