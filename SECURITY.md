# Security Policy

## Supported versions

Only the latest release tag is supported. Fixes will land on `main` and be
cut as a new patch release; older tags will not be back-patched.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email **Avicennasis@gmail.com** with:

- A description of the issue.
- Steps to reproduce (or a proof-of-concept).
- The version or commit SHA you found it against.
- Any suggested mitigation if you have one.

Expect an acknowledgement within a week. This is a side-project — there is
no bug bounty and no SLA — but security issues are taken seriously and a
fix and disclosure will be coordinated with you.

## Out of scope

- Issues in upstream dependencies (report upstream).
- Misconfiguration by consumers of this project.

## Threat model

Avic's Text Replacement is a **Manifest V3 browser extension**
(Chrome/Edge/Opera/Firefox) distributed via extension stores / local
install. There is no server component, no account system, no telemetry,
and no network traffic of any kind owned by this project (CI enforces
"no external URLs"; CSP is `script-src 'self'; object-src 'none'`).

### Trust boundaries

- **Content script ↔ web page** — the primary boundary. The content
  script runs with `<all_urls>` host permissions in every page; all page
  DOM content is untrusted input. Replacement is text-node-only
  (TreeWalker/MutationObserver) — the extension must never interpret
  page content as HTML or code.
- **Extension pages ↔ user-supplied rules** — replacement rules
  (including regex patterns) are user data stored in
  `browser.storage`. Import/export JSON is untrusted input and must be
  validated on import (prototype-pollution-safe maps via
  `Object.create(null)`; pathological-regex/DoS concerns are limited to
  the user's own browser).
- **MV3 context isolation** — background service worker, content
  script, and management UI are isolated contexts; messages between
  them are validated rather than trusted.
- **Distribution chain** — store-signed packages built from `build.sh`;
  users trust the store listing and the signing, not a fleet deploy.

### Sensitive data handled

The user's replacement rules only (stored in `browser.storage`,
local to the browser profile). Rules may incidentally reveal personal
preferences; no credentials, no browsing-history collection.

### Adversaries in scope

- Hostile web pages attempting to confuse or exploit the content
  script via crafted DOM (mutation storms, huge text nodes,
  prototype-pollution gadgets).
- Malicious rule-import files (crafted JSON).

### Adversaries out of scope

- A compromised browser, OS, or extension store.
- Other extensions with debugging-level permissions.
- Issues in upstream browsers' MV3 implementations.

### Fleet-spec note

The in-house-spec (v1.2.0) Authelia/Traefik proxy-auth assumptions do
**not** apply: this is a distributed browser extension with no deployed
service, no proxy, and no proxy-injected identity headers. If a hosted
component (rule-sync backend, web UI) is ever added, it must adopt the
full in-house-spec baseline (auth, CSRF, rate limiting, health
contract, metrics) at deploy time.
