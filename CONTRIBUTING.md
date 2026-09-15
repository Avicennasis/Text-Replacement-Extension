# Contributing to Text-Replacement-Extension

Thanks for considering a contribution. Bug reports, docs fixes, and small
improvements are all welcome.

## Dev setup

```bash
git clone https://github.com/Avicennasis/Text-Replacement-Extension.git
cd Text-Replacement-Extension
```

There is no `package.json` and no build tooling to install — the extension is
plain JavaScript, `build.sh` assembles `dist/` for each browser, and the tests
are standalone Node scripts.

## Running the tests

```bash
./build.sh
for t in benchmark validate_import_test should_process_node_test unit_test \
         build_regex_test storage_size_test security_logging_test safe_word_map_test; do
    node "tests/$t.js" || exit 1
done
```

CI (`.github/workflows/test.yml`) runs the same suite on Node 24, then
validates the manifests, the strict CSP, and that both browser builds are
identical apart from `manifest.json`.

## Code style

There is no separate lint/format tool to install. Follow `.editorconfig` and
the style of the surrounding file. All resources must stay bundled locally —
CI fails on any external URL in non-comment source code.

## PR checklist

- [ ] Tests added or updated; the suite above is green locally.
- [ ] `./build.sh` and all standalone Node test scripts above are green.
- [ ] README and docs updated if public behavior changed.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.

## Code of Conduct

Be respectful; assume good faith. Disagree on ideas, not people.
