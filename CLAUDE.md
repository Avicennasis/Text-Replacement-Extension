# CLAUDE.md — Text Replacement Extension

## Build & Test

```bash
# Build for both browsers (Chromium + Firefox)
./build.sh

# Build for a specific browser only
./build.sh chromium
./build.sh firefox

# Run replacement engine benchmarks
node tests/benchmark.js
```

Output lands in `dist/chromium/` and `dist/firefox/`. Load the appropriate directory as an unpacked extension in your browser.

## Project Conventions

### Logger Duplication
The `Logger` object is **intentionally duplicated** in `content.js`, `manage.js`, and `background.js`. In Manifest V3, these three contexts (content script, extension page, service worker) run in isolated JavaScript environments with no shared module system that works across all supported browsers. Do NOT refactor this into a shared module — it would break Firefox compatibility.

### Comments & Transparency
All code comments are written in **plain English for non-developer readers**. This is a core project commitment (see "Transparency & Safety" in README.md). When modifying code, maintain this documentation style — explain the *why*, not just the *what*.

### Privacy-First
- **Zero external resources**: No CDN fonts, no analytics, no external scripts.
- **No inline styles or scripts**: Strict CSP (`script-src 'self'; style-src 'self'`). Use CSS classes instead of `element.style`.
- Add "data never leaves your browser" comments to any new function that touches storage.

### DOM Safety
- Never use `innerHTML` — use `createElement`/`appendChild`/`removeChild`.
- Use `Object.create(null)` for lookup maps to prevent prototype pollution.
- Filter SCRIPT, STYLE, NOSCRIPT, TEXTAREA, INPUT tags and editable areas.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR and checks:
1. Build succeeds for both targets
2. Manifests are valid JSON with correct `manifest_version`
3. All files referenced in manifests exist
4. No external URLs in non-comment source code
5. CSP does not include `unsafe-inline`
6. Shared source files are identical across builds

## Key Limits

| Constant             | Value  | Location    |
|----------------------|--------|-------------|
| `MAX_RULES`          | 255    | manage.js   |
| `MAX_PATTERN_LENGTH` | 255    | manage.js   |
| `REGEX_TIMEOUT_MS`   | 100ms  | content.js  |
| `MAX_TEXT_NODE_LENGTH` | 50000  | content.js  |
| `MAX_IMPORT_FILE_SIZE` | 1 MB | manage.js   |
| Sync storage per-item | 8 KB  | Browser API |
| Sync storage total   | 100 KB | Browser API |
