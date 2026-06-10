# 2026-06-09 — in-house-spec v1.2.0 baseline audit

**Spec**: in-house-spec v1.2.0 (`IN-HOUSE-CONVENTIONS.md`)
**Auditor**: Claude (automated `bin/check-spec.py --audit` + manual review)
**Repo state at audit**: branch `main`, commit `c2b4993`

## Deployment-model assessment

Text-Replacement-Extension is **not a deployed fleet service**. It is a
Manifest V3 browser extension for Chrome/Edge/Opera/Firefox (pure
JS/HTML/CSS in `src/` + per-browser `manifests/`, packaged by `build.sh`
and distributed via extension stores / local install). No server
component, no network API, no systemd unit, no container. Wiki
(`projects/text-replacement-extension.md`) classifies it as
`kind: project`, `status: production`, `expects_url: false`
("installed locally, no hosted URL"). The in-house-spec's service
baseline (systemd/Docker profile, FastAPI auth/CSRF/rate-limiting/
health/metrics contracts, deploy.sh, Python dependency lockfiles)
therefore does not apply.

**Recommendation: adopt-on-deploy.** If a hosted companion service
(rule-sync backend, hosted management UI) is ever built, it must adopt
the full in-house-spec baseline at deploy time. Until then, only the
cheap universal items apply.

## Checker output (before)

`check-spec.py --audit Text-Replacement-Extension` — 7 findings:

1. missing required file: `requirements.in`
2. missing required file: `requirements.lock`
3. missing required file: `.pre-commit-config.yaml`
4. missing required file: `docs/audits/README.md`
5. missing required file: `deploy.sh`
6. `.gitignore` does not ignore `venv/`
7. missing unit file `Text-Replacement-Extension-host.service` (and no
   compose file for the Docker profile)

## Disposition

| Finding | Disposition |
|---|---|
| `requirements.in` / `requirements.lock` | **N/A** — no Python; pure-JS browser extension with zero runtime dependencies (no `package.json` either; CI enforces no external resources). Adopt-on-deploy for any future Python service component. |
| `.pre-commit-config.yaml` | **Deferred** — spec hook baseline is `py_compile` over Python entry points; none exist. A JS-appropriate hook set (eslint, manifest lint) would be a future improvement, not a spec mapping. CI already covers build/manifest/CSP/test checks. |
| `docs/audits/README.md` | **Fixed** — index created, this shard is the first entry. |
| `deploy.sh` | **N/A** — no deploy target; distribution is store packages built by `build.sh`/CI. Adopt-on-deploy. |
| `.gitignore` venv/ | **Fixed** — `venv/` added (cheap universal item; guards throwaway Python tooling venvs). |
| unit file / compose file | **N/A** — no runtime host. Adopt-on-deploy. |
| `SECURITY.md` threat model (§Documentation, manual check) | **Fixed** — threat model added: content-script/page boundary, user-rule import surface, MV3 context isolation, store distribution chain; Authelia assumption explicitly N/A. |

Checker quirk (same as TaskAlarm audit): expected unit name is derived
from the directory name verbatim (`Text-Replacement-Extension-host.service`).
Not actionable — unit is N/A.

## Checker output (after)

5 findings remain, all N/A or deferred per the table above
(`requirements.in`, `requirements.lock`, `.pre-commit-config.yaml`,
`deploy.sh`, unit/compose file). Findings 4 and 6 (docs/audits index,
`.gitignore` venv/) are resolved.

## Secrets scan

No inline secrets found. No `.env`, no hardcoded tokens, no credential
literals in tracked files; extension stores only user rules in
`browser.storage`.
