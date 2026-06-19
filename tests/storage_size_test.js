const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------------
// SANDBOX SETUP
// manage.js runs in a browser extension context. We mock just enough to let
// the file load without errors so we can call estimateStorageSize() in isolation.
// ---------------------------------------------------------------------------

// Mock Blob for Node.js environment to accurately count UTF-8 bytes
class MockBlob {
    constructor(parts) {
        this.size = parts.reduce((acc, part) => {
            if (typeof part === 'string') {
                return acc + Buffer.byteLength(part, 'utf8');
            }
            return acc + (part.length || 0);
        }, 0);
    }
}

const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    Blob: MockBlob,
    JSON: JSON,
    Object: Object,
    Array: Array,
    chrome: {
        runtime: {
            lastError: null,
            getManifest: () => ({ version: '1.0.0' })
        },
        storage: {
            sync: {
                QUOTA_BYTES: 102400,
                QUOTA_BYTES_PER_ITEM: 8192,
                get: (_keys, cb) => cb({ extensionEnabled: true, wordMap: {} }),
                set: (_data, cb) => { if (cb) cb(); }
            },
            onChanged: { addListener: () => {} }
        }
    },
    // Stub enough DOM for DOMContentLoaded listener and UI code
    document: {
        addEventListener: () => {},
        getElementById: () => ({
            addEventListener: () => {},
            setAttribute: () => {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            appendChild: () => {},
            removeChild: () => {},
            querySelector: () => null,
            querySelectorAll: () => []
        }),
        createElement: () => ({
            style: {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            appendChild: () => {},
            setAttribute: () => {},
            addEventListener: () => {}
        }),
        querySelector: () => null,
        querySelectorAll: () => []
    },
    window: {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    FileReader: class { readAsText() {} addEventListener() {} },
    confirm: () => false,
    Logger: {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {}
    }
};

sandbox.window = sandbox;

// Load manage.js into the sandbox
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'manage.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Verify that estimateStorageSize is accessible
if (typeof sandbox.estimateStorageSize !== 'function') {
    console.error('FATAL: manage.js did not expose estimateStorageSize()');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// TEST HARNESS
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  [PASS] ${label}`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// TESTS: estimateStorageSize
// ---------------------------------------------------------------------------

console.log('\nestimateStorageSize — testing storage estimation\n');

// 1. Empty wordMap
(() => {
    const wordMap = {};
    const expected = 2 + 9; // "{}" is 2 bytes + 9 bytes overhead
    const result = sandbox.estimateStorageSize(wordMap);
    assert(result === expected, `Empty wordMap: expected ${expected}, got ${result}`);
})();

// 2. Simple wordMap
(() => {
    const wordMap = { "cat": { "replacement": "dog", "caseSensitive": false, "enabled": true } };
    const json = JSON.stringify(wordMap);
    const expected = Buffer.byteLength(json, 'utf8') + 9;
    const result = sandbox.estimateStorageSize(wordMap);
    assert(result === expected, `Simple wordMap: expected ${expected}, got ${result}`);
})();

// 3. Multi-byte Unicode characters
(() => {
    const wordMap = { "🚀": { "replacement": "✨", "caseSensitive": false, "enabled": true } };
    const json = JSON.stringify(wordMap);
    const expected = Buffer.byteLength(json, 'utf8') + 9;
    const result = sandbox.estimateStorageSize(wordMap);
    assert(result === expected, `Unicode wordMap: expected ${expected}, got ${result}`);
})();

// 4. Multiple rules
(() => {
    const wordMap = {
        "cat": { "replacement": "dog", "caseSensitive": false, "enabled": true },
        "fish": { "replacement": "chips", "caseSensitive": true, "enabled": false }
    };
    const json = JSON.stringify(wordMap);
    const expected = Buffer.byteLength(json, 'utf8') + 9;
    const result = sandbox.estimateStorageSize(wordMap);
    assert(result === expected, `Multiple rules: expected ${expected}, got ${result}`);
})();

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('  STORAGE SIZE TESTS FAILED');
    process.exit(1);
}
