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
