# Contributing to Text-Replacement-Extension

Thanks for considering a contribution. Bug reports, docs fixes, and small
improvements are all welcome.

## Dev setup

```bash
git clone https://github.com/Avicennasis/Text-Replacement-Extension.git
cd Text-Replacement-Extension
# No package manager — pure vanilla JS extension. Just edit src/ and rebuild:
./build.sh
```

## Running the tests

```bash
node tests/benchmark.js
```

CI runs the same benchmark plus build + manifest validation against
both Chromium and Firefox targets. Make sure those pass locally before
opening a PR.

## Project conventions

### Logger is duplicated on purpose

The `Logger` object is defined in three places: `src/content.js`, `src/manage.js`, and `src/background.js`. **Do not refactor this into a shared module.** In Manifest V3 the content script, extension page, and service worker run in isolated JS contexts with no shared module system that works across both Chromium and Firefox. The duplication is the cross-browser portability story.

### Benchmark patches must track production constants

`tests/benchmark.js` rewrites `src/content.js` at load time to relax the production safety limits so it can stress-test with large inputs. If you add or rename a safety constant in `content.js`, you must also patch it in `benchmark.js` -- otherwise the benchmark silently uses the production value (or fails the post-patch sanity check). The constants currently patched:

- `REGEX_TIMEOUT_MS` -- production 100ms, benchmark 10000ms
- `MAX_TEXT_NODE_LENGTH` -- production 50000, benchmark 2000000

`MAX_RULES` (255) is not patched; the benchmark stays under the limit instead.

### Key limits

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_RULES` | 255 | `src/manage.js` |
| `MAX_PATTERN_LENGTH` | 255 | `src/manage.js` |
| `REGEX_TIMEOUT_MS` | 100 ms | `src/content.js` |
| `MAX_TEXT_NODE_LENGTH` | 50000 | `src/content.js` |
| `MAX_IMPORT_FILE_SIZE` | 1 MB | `src/manage.js` |
| Sync storage per-item | 8 KB | browser API |
| Sync storage total | 100 KB | browser API |

### Comments are for non-developers

Code comments are written in plain English so non-technical users can audit what the extension does (this is a core promise of "Transparency & Safety" in the README). Explain the *why*, not just the *what*. Any new function that touches storage should carry a brief "data never leaves your browser" note.

### DOM safety

- Never use `innerHTML` -- use `createElement` / `appendChild` / `removeChild`.
- Use `Object.create(null)` for lookup maps to avoid prototype pollution.
- Skip `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEXTAREA`, `INPUT`, and editable nodes when walking the tree.

## PR checklist

- [ ] `node tests/benchmark.js` is green locally.
- [ ] `./build.sh` succeeds for both Chromium and Firefox targets.
- [ ] Source files are identical across browser builds (only manifests differ).
- [ ] No external URLs added to `src/` (privacy/security check).
- [ ] CSP unchanged or tightened — never add `'unsafe-inline'`.
- [ ] README and docs updated if public behavior changed.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
Be respectful; assume good faith.
