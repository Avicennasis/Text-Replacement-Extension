# Round 2 Code Review — TODO

## HIGH Priority

- [ ] **H1** `content.js` — Add text node size limit (50,000 chars) in `processNode` to prevent hangs on huge nodes
- [ ] **H2** `content.js` — Change re-throw to log-and-continue for non-timeout errors in `processNode`
- [ ] **H3** `manage.js` + `manage.css` — Replace `row.style.opacity` with CSS class `.rule-disabled`
- [ ] **H4** `manage.js` — Reset file input immediately in `importRules` (before validation)
- [ ] **H5** `manage.js` — Add `maxlength` to dynamically-created inline-edit inputs
- [ ] **H6** `manage.css` — Fix `outline: none` → `outline: 2px solid transparent` (3 locations)
- [ ] **H7** `manifests` — Change `object-src 'self'` → `object-src 'none'` in both manifests
- [ ] **H8** `ci.yml` — Add CSP existence check + `unsafe-eval` check
- [ ] **H9** `ci.yml` — Add Node.js setup + `node tests/benchmark.js` step
- [ ] **H10** `build.sh` — Add `src/images/` directory validation to pre-flight check

## MEDIUM Priority

- [ ] **M1** `content.js` — Debounce `processDocument` calls from storage changes (200ms)
- [ ] **M2** `content.js` — Move sensitive node content from `Logger.warn` to `Logger.debug`
- [ ] **M3** `content.js` — Add Unicode behavior documentation block
- [ ] **M4** `content.js` — Document Shadow DOM and iframe limitations
- [ ] **M5** `manage.js` — Add `__proto__`/`constructor`/`prototype` key guard in `validateImportedRules` and `addReplacement`
- [ ] **M6** `manage.js` — Use `chrome.runtime.getManifest().version` for export version
- [ ] **M7** `manage.js` — Add type guard for corrupted `wordMap` (non-object fallback)
- [ ] **M8** `manage.js` — Fix race condition comment: "reduces likelihood" not "prevents"
- [ ] **M9** `manage.js` — Fix inaccurate `innerHTML` comment
- [ ] **M10** `manage.js` + `manage.css` — Replace `row.style.display` in `filterRules` with CSS class
- [ ] **M11** `content.js` — Add `DOMContentLoaded` fallback for MutationObserver if `document.body` is null
- [ ] **M12** `content.js` — Add warning log for case-insensitive map collisions in `updateRegexes`
- [ ] **M13** `background.js` — Add error handling for `chrome.tabs.create`

## LOW Priority

- [ ] **L1** `content.js` — Document why `characterData` is excluded from MutationObserver
- [ ] **L2** `content.js` — Replace string-based error detection with custom `RegexTimeoutError` class
- [ ] **L3** `content.js` — Add defensive `lastIndex = 0` reset before each `.replace()` call
- [ ] **L4** `manage.js` — Add `field` parameter validation in `updateReplacement`
- [ ] **L5** `manage.js` — Add empty-state message when rules table has zero rules
- [ ] **L6** `manage.js` — Cache `Object.keys(wordMap).length` in `exportRules`
- [ ] **L7** `manage.html` — Add `aria-label="Replacement rules"` to `<table>`
- [ ] **L8** `ci.yml` — Add images directory comparison to builds-identical check
- [ ] **L9** `background.js` — Clarify that `browserAction` fallback is dead code (MV3-only)
- [ ] **L10** `manage.css` — Add `flex-wrap: wrap` + responsive media query to `.add-section`
- [ ] **L11** `build.sh` — Quote `$#` on line 29

## TEST Fixes

- [ ] **T1** `benchmark.js` — Add case-sensitive rules to test both regex paths
- [ ] **T2** `benchmark.js` — Add multiple replacement verification checks
- [ ] **T3** `benchmark.js` — Add success check for `REGEX_TIMEOUT_MS` patching
- [ ] **T4** `benchmark.js` — Add function existence check after `vm.runInContext`
- [ ] **T5** `mock_chrome.js` — Remove dead code (no test harness uses it)
