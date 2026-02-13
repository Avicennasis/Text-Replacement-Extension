# Code Review TODO

## Round 2 (completed in commit d728c96)

- [x] All 39 findings implemented

## Round 3 (completed in commit 21a1cab)

- [x] All 28 findings implemented

---

## Round 4

### MEDIUM Priority

- [ ] **M1** `content.js` — Toggle-on without prior wordMap load leaves regexes null
- [ ] **M2** `content.js` — Stale debounced `reprocessTimeout` not cleared on disable
- [ ] **M3** `content.js` — `processElement` creates wasteful TreeWalker on IGNORED_TAGS elements
- [ ] **M4** `content.js` — Per-rule type validation missing in `updateRegexes`
- [ ] **M5** `content.js` — No `MAX_RULES` enforcement for corrupted storage
- [ ] **M6** `manage.js` — `validateImportedRules` missing `Array.isArray` on individual rule values
- [ ] **M7** `manage.js` — Blob URL leak if export download throws (needs try/finally)
- [ ] **M8** `manage.css` — Missing standard `background-clip: text` (unprefixed)
- [ ] **M9** `manage.html`/`manage.css` — Missing `color-scheme: dark` meta tag
- [ ] **M10** `manage.css` — `::before` pseudo-element uses legacy single-colon syntax
- [ ] **M11** `manage.css` — Responsive breakpoint doesn't cover table layout or body padding
- [ ] **M12** `ci.yml` — CI URL scanner doesn't detect protocol-relative URLs
- [ ] **M13** `benchmark.js` — Benchmark doesn't test `escapeRegExp` with special regex chars
- [ ] **M14** `ci.yml` — CI doesn't validate manifest `version` fields match
- [ ] **M15** `build.sh` — Path traversal via `../` in target arguments
- [ ] **M16** `manage.css` — `transition: all` on buttons delays focus indicator visibility
- [ ] **M17** `content.js` — `DOMContentLoaded` fallback doesn't check `readyState` for bfcache

### LOW Priority

- [ ] **L1** `content.js` — Stale line number reference in comment
- [ ] **L2** `content.js` — `matchCounter` cross-pass inheritance undocumented
- [ ] **L3** `content.js` — SVG text elements not in IGNORED_TAGS
- [ ] **L4** `content.js` — `observer.observe()` has no error handling
- [ ] **L5** `content.js` — Extension context invalidation not handled in `onChanged`
- [ ] **L6** `content.js` — FILTER_REJECT rationale comment missing from `processElement`
- [ ] **L7** `manage.js` — Rename collision check missing symmetric case-sensitive direction
- [ ] **L8** `manage.js` — Search debounce captures event object instead of value eagerly
- [ ] **L9** `manage.js` — `filterRules` still uses `forEach` (inconsistent with convention)
- [ ] **L10** `manage.js` — `estimateStorageSize` keyOverhead=9 comment unclear
- [ ] **L11** `manage.js` — Import merge doesn't strip RESERVED_KEYS from existing storage
- [ ] **L12** `manage.js` — No `scrollIntoView` for newly added rule row
- [ ] **L13** `manage.js` — `confirm()` dialog doesn't truncate long `originalText`
- [ ] **L14** `manage.css` — Missing `box-sizing: border-box` global reset
- [ ] **L15** `manage.css` — No `::placeholder` styling for dark theme
- [ ] **L16** `mock_chrome.js` — Doesn't mock `getManifest()`
- [ ] **L17** `ci.yml` — CI doesn't validate manifest `permissions`/`host_permissions` match
- [ ] **L18** `benchmark.js` — Doesn't exercise `MAX_TEXT_NODE_LENGTH` guard
- [ ] **L19** `benchmark.js` — `REGEX_TIMEOUT_MS` patch should use regex, exit on failure
- [ ] **L20** docs — `benchmark_performance.py` undocumented in CLAUDE.md/README
- [ ] **L21** `manage.html` — Missing favicon declaration
- [ ] **L22** `benchmark.js` — Uses emoji that may not render on all terminals
- [ ] **L23** `benchmark.js` — Sandbox doesn't explicitly mock `setTimeout`/`clearTimeout`
- [ ] **L24** `content.js` — `shouldProcessNode` doesn't guard against non-element parentNode
