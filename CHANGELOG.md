# Changelog

All notable changes to `Text-Replacement-Extension` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-02-12

### Added
- Unified Chromium and Firefox codebase from a single `src/` tree; `build.sh`
  produces `dist/chromium/` and `dist/firefox/`.
- Firefox upgraded from Manifest V2 to Manifest V3 (requires Firefox 109+).
- JSON export/import of replacement rules, with type/length validation.
- Real-time search/filter, per-rule and master enable toggles, and
  case-sensitivity control.
- Optional debug logging (`ENABLE_DEBUG_LOGGING`).

### Changed
- Firefox manifest now uses `browser_specific_settings.gecko`.
- CSS extracted to `manage.css` so the CSP can drop `'unsafe-inline'` from
  `style-src`.
- All code comments rewritten for plain-English readability; privacy headers
  added to each source file.

### Fixed
- `showStatus()` timer stacking — rapid messages no longer conflict.
- `isEditable()` now checks parent nodes for `contentEditable`.
- Race conditions: all write operations re-read fresh from storage.
- Removed dead validation code that could never execute.
- Added a `performance.now()` throttle for timeout checks (every 50th match).

### Security
- Removed `web_accessible_resources` (clickjacking attack surface).
- Removed `'unsafe-inline'` from the CSP `style-src`.
- Import file validation (types, lengths, sanitized booleans).
- Replaced `innerHTML` clearing with a safe `removeChild` loop.
- Prototype-pollution hardening: reserved-key stripping and prototype-less
  rule maps.
- CI enforces CSP strictness and rejects external URLs in source.
