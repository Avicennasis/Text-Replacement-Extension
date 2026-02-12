# Avic's Text Replacement Extension

A powerful, secure, and modern browser extension that automatically replaces text on websites you visit. Works with **Google Chrome**, **Microsoft Edge**, **Opera**, and **Firefox** — all from a single codebase.

> **Unified Codebase:** Both browsers share identical source code, with only the manifest file differing between Chromium and Firefox builds.

## Features

### Core Functionality
*   **Real-time Replacement**: Text is replaced instantly as you browse, including dynamically loaded content (infinite scroll, AJAX, etc.).
*   **Modern UI**: Features a sleek, dark-mode "Glassmorphism" interface with system fonts — no external CDN dependencies.
*   **Toggle Controls**
    *   **Master Switch**: Instantly enable or disable the entire extension.
    *   **Individual Rules**: Toggle specific text replacements on or off without deleting them.
*   **Case Sensitivity**: Choose whether to match exact capitalization or ignore case (`Cat` vs `cat`).

### Performance & Safety
*   **Smart Performance**:
    *   Processes only newly-added content (10-100x faster on dynamic sites like Twitter/Reddit)
    *   Instant O(1) lookup performance with up to 100+ rules (limited by browser's 8 KB sync storage per-item quota)
    *   100ms timeout protection prevents browser hangs on complex patterns
    *   Optimized regex compilation with longest-match-first sorting
    *   Throttled timeout checks (every 50th match) to minimize overhead
*   **Safety Features**:
    *   Maximum rule limits (255 chars per pattern) and browser storage quota checks prevent performance issues
    *   Intelligently skips inputs, text areas, and editable content to avoid breaking websites
    *   Browser storage quota validation with clear error messages
    *   Strict Content Security Policy (CSP) — no `unsafe-inline` for scripts or styles
    *   Import file validation checks types, lengths, and sanitizes values
    *   Comprehensive error handling with user-friendly messages

### Advanced Features
*   **Export/Import**: Backup your rules or share them between devices with JSON export/import
*   **Search & Filter**: Quickly find specific rules with real-time search (searches both original and replacement text)
*   **Accessibility**: Full WCAG 2.1 compliance with ARIA labels for screen reader users
*   **Privacy First**: No external dependencies, all data stored locally, zero tracking or analytics
*   **Debug Logging**: Optional debug mode for troubleshooting (toggle `ENABLE_DEBUG_LOGGING`)

## Transparency & Safety

Because this extension needs permission to "read and modify data on all websites" to function, we believe you have a right to know exactly what is happening under the hood.

This project is built on a commitment to **absolute transparency**:

*   **Extensive In-Code Documentation**: Every script in this codebase (`content.js`, `manage.js`, `background.js`, `manage.css`) is heavily commented. We have intentionally written these comments to be understood by non-developers, so you can verify for yourself that the code is safe and does nothing "sketchy."
*   **Zero Data Collection**: This extension does not track you, does not use analytics, and never talks to an external server. Your data stays 100% local (or synced via your own browser account).
*   **Open Source Commitment**: We provide this code fully open-source so you don't have to trust a "black box" with your browsing history. The idea is simple: a useful tool that respects your privacy.
*   **Automated CI Checks**: Our GitHub Actions workflow automatically verifies that no external URLs are loaded, the CSP remains strict, and both browser builds are identical.

## Building

This extension uses a simple build script that copies the shared source files and the correct browser-specific manifest into a `dist/` directory.

```bash
# Build for both browsers
./build.sh

# Build for a specific browser only
./build.sh chromium
./build.sh firefox
```

Output:
```
dist/chromium/   → Load in Chrome, Edge, or Opera
dist/firefox/    → Load in Firefox
```

## Installation

### Google Chrome

1.  Clone this repository and run `./build.sh`.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Toggle **Developer mode** in the top-right corner.
4.  Click **Load unpacked** and select the `dist/chromium/` folder.

### Microsoft Edge

1.  Clone this repository and run `./build.sh`.
2.  Open Edge and navigate to `edge://extensions`.
3.  Toggle **Developer mode** in the left sidebar.
4.  Click **Load unpacked** and select the `dist/chromium/` folder.

### Opera

1.  Clone this repository and run `./build.sh`.
2.  Open Opera and navigate to `opera://extensions`.
3.  Toggle **Developer mode** in the top-right corner.
4.  Click **Load unpacked** and select the `dist/chromium/` folder.

### Firefox

1.  Clone this repository and run `./build.sh`.
2.  Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3.  Click **Load Temporary Add-on** and select `dist/firefox/manifest.json`.

> **Note:** Edge and Opera are Chromium-based and fully support Chrome extensions. Firefox requires Manifest V3 support (version 109+).

## Usage

### Basic Usage
1.  **Open Settings**: Click the extension icon in your toolbar to open the **Text Replacements** dashboard.
2.  **Add a Rule**:
    *   **Original String**: The text you want to find (e.g., "dog").
    *   **Replacement String**: The text you want to see instead (e.g., "cat").
    *   **Match Case**: Toggle this if strictly "Dog" should be replaced but "dog" should not.
    *   Click **Add Rule**.
3.  **Manage Rules**:
    *   Edit rules directly in the table (changes save automatically).
    *   Toggle individual rules on/off without deleting them.
    *   Use the search box to quickly find specific rules.
    *   Remove rules with the Remove button.

### Advanced Features
*   **Export Rules**: Click "Export Rules" to download all your rules as a JSON file (great for backups!).
*   **Import Rules**: Click "Import Rules" to load rules from a JSON file.
    *   Choose "OK" to **replace** all existing rules.
    *   Choose "Cancel" to **merge** with existing rules (imported rules win on conflicts).
*   **Search Rules**: Use the search box above the table to filter rules in real-time.
*   **Debug Mode**: Set `ENABLE_DEBUG_LOGGING = true` in any JavaScript file to see detailed console logs.

## Technical Details

### Architecture
*   **Manifest V3**: Both Chromium and Firefox builds use the modern MV3 extension format.
*   **Cross-Browser**: Single shared codebase for Chrome, Edge, Opera, and Firefox.
*   **Content Scripts**: Runs on all pages to perform text replacement via DOM TreeWalker.
*   **Storage**: Uses `chrome.storage.sync` for cross-device synchronization.
*   **Observer Pattern**: MutationObserver watches for dynamic content changes.
*   **Build System**: Simple shell script copies shared source + correct manifest to `dist/`.

### Performance Optimizations
*   **Incremental Processing**: Only scans newly-added DOM nodes (not the entire page).
*   **O(1) Lookup**: Hash map-based replacement lookup for instant performance.
*   **Regex Optimization**: Compiles all patterns into two optimized regexes (case-sensitive/insensitive).
*   **Timeout Protection**: 100ms timeout prevents regex catastrophic backtracking, checked every 50th match to minimize overhead.
*   **DocumentFragment**: Table rows are built off-screen and appended in a single DOM mutation.
*   **Granular Updates**: Only rebuilds/rescans when necessary (not on every settings change).

### Security Features
*   **Strict CSP**: `script-src 'self'; object-src 'self'; style-src 'self'` — no `unsafe-inline`.
*   **No External Resources**: All fonts, scripts, and styles bundled locally. Zero network requests.
*   **Input Validation**: Validates pattern lengths, rule counts, storage quotas, and import file structure.
*   **Import Sanitization**: Imported rules are validated for correct types and safe lengths before saving.
*   **Safe DOM Manipulation**: Uses TreeWalker API, `appendChild`, and `removeChild` — never `innerHTML`.
*   **No `web_accessible_resources`**: Management page is not exposed to web pages, preventing clickjacking.
*   **CI Enforcement**: GitHub Actions verifies CSP strictness and absence of external URLs on every push.

### Code Quality
*   **Extensive Comments**: Every function documented in plain English for non-technical readers.
*   **Logging System**: Consistent, prefixed logging with debug mode toggle.
*   **Constants**: Magic numbers extracted to named constants with explanations.
*   **Error Recovery**: UI reverts to previous state on storage failures.
*   **Type Safety**: JSDoc annotations for better IDE support.
*   **Fresh Reads**: All write operations read fresh data from storage to prevent race conditions.

### Repository Structure
```
Text-Replacement-Extension/
├── src/                          # Shared source code (identical for all browsers)
│   ├── background.js             # Toolbar icon click handler
│   ├── content.js                # Text replacement engine (runs on every page)
│   ├── manage.js                 # Management page UI logic
│   ├── manage.html               # Management page structure
│   ├── manage.css                # Management page styles (external for CSP)
│   └── images/                   # Extension icons
├── manifests/
│   ├── chromium/manifest.json    # MV3 manifest for Chrome/Edge/Opera
│   └── firefox/manifest.json     # MV3 manifest for Firefox (with gecko settings)
├── .github/workflows/ci.yml     # Automated build & security checks
├── build.sh                      # Build script → dist/chromium/ and dist/firefox/
├── tests/                        # Benchmarks and test utilities
├── LICENSE                       # MIT License
└── README.md
```

## What's New in v2.1

This version unifies the Chromium and Firefox codebases and includes security hardening:

**Unified Codebase**
- Single source of truth for Chrome, Edge, Opera, and Firefox
- Firefox upgraded from Manifest V2 to Manifest V3 (requires Firefox 109+)
- Build script produces both browser targets from shared code
- GitHub Actions CI validates both builds automatically

**Security Hardening**
- Removed `web_accessible_resources` (eliminated clickjacking attack surface)
- Removed `'unsafe-inline'` from CSP `style-src` (CSS extracted to external file)
- Added import file validation (checks types, lengths, sanitizes booleans)
- Replaced `innerHTML` clearing with safe `removeChild` loop
- CI enforces CSP strictness and absence of external URLs

**Bug Fixes**
- Fixed `showStatus()` timer stacking (rapid messages no longer conflict)
- Removed dead validation code that could never execute
- Added `performance.now()` throttle for timeout checks (every 50th match)
- Improved `isEditable()` to check parent nodes for `contentEditable`
- Fixed race conditions: all write operations now read fresh from storage

**Documentation**
- All code comments rewritten for plain English / non-developer readability
- Privacy notices added to every source file header
- Technical jargon explained inline (DocumentFragment, debounce, CSP, etc.)

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Credits

**Author:** Léon "Avic" Simmons ([@Avicennasis](https://github.com/Avicennasis))

**Version:** 2.1 (Unified Codebase & Security Hardening)
