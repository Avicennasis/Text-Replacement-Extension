# Code Review TODO

## Round 2 (completed in commit d728c96)

- [x] H1–H10, M1–M13, L1–L11, T1–T4 — All implemented
- [x] T5 — `mock_chrome.js` retained (used by `benchmark_performance.py`)

---

## Round 3

### MEDIUM Priority

- [ ] **M1** `content.js` — `replaceCallback` uses truthy check instead of `in` operator for wordMap lookups
- [ ] **M2** `content.js` — `updateRegexes` doesn't validate `wordMap` parameter type (no `safeWordMap` equivalent)
- [ ] **M3** `content.js` — No post-replacement length guard on inflated text nodes
- [ ] **M4** `manage.js` — Case-only rename guard blocks valid renames for case-sensitive rules
- [ ] **M5** `manage.js` — Missing `RESERVED_KEYS` check on rule rename in `updateReplacement`
- [ ] **M6** `manage.js` — Missing case-insensitive collision check on rule rename
- [ ] **M7** `manage.js` — `removeReplacement` deletes without verifying key still exists
- [ ] **M8** `manage.js` — Empty-state row not removed when first rule is added via direct append
- [ ] **M9** `manage.js` — `filterRules` counts empty-state row in `totalCount`
- [ ] **M10** `manage.js` — `RESERVED_KEYS` should be a Set for consistency with `VALID_FIELDS`
- [ ] **M11** `manage.css` — No `prefers-reduced-motion` support (WCAG accessibility)
- [ ] **M12** `benchmark.js` — `'da quick'` correctness check appears incorrect (cascade replaces `The` first)

### LOW Priority

- [ ] **L1** `content.js` — Double `shouldProcessNode` check is undocumented defense-in-depth
- [ ] **L2** `content.js` — No `RESERVED_KEYS` filter in `updateRegexes()`
- [ ] **L3** `content.js` — Shared timeout budget across regex passes is undocumented
- [ ] **L4** `manage.js` — `estimateStorageSize` wraps wordMap slightly inflating estimate
- [ ] **L5** `manage.js` — `showStatus` doesn't clear CSS classes on timeout
- [ ] **L6** `manage.js` — `confirm()` import dialog has no abort option (merge vs replace vs cancel)
- [ ] **L7** `manage.js` — `exportRules` doesn't handle `getManifest()` failure
- [ ] **L8** `manage.js` — `addReplacement` collision check only runs one direction (new case-insensitive only)
- [ ] **L9** `manage.js` — `safeWordMap` returns raw storage reference (no defensive copy)
- [ ] **L10** `manage.js` — Empty-state `colspan="5"` is hardcoded
- [ ] **L11** `manage.js` — `exportRules` creates two `Date` objects that could span midnight
- [ ] **L12** `README.md` — CSP documentation stale (`object-src 'self'` should be `'none'`)
- [ ] **L13** `ci.yml` — CI doesn't validate `action.default_icon` file references
- [ ] **L14** `manage.css` — Table container clips overflow without horizontal scroll
- [ ] **L15** `CLAUDE.md` — `MAX_TEXT_NODE_LENGTH` missing from Key Limits table
- [ ] **L16** `TODO.md` — Item T5 incorrectly marked `mock_chrome.js` as dead code (now fixed)
- [ ] **L17** `ci.yml` — Redundant `/* ... */` comment pattern in CI URL scanner
- [ ] **L18** `manage.js`/`manage.html` — No `aria-live` improvements for dynamic status announcements
