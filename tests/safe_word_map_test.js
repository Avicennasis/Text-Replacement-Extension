const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------------
// SANDBOX SETUP
// ---------------------------------------------------------------------------

const lastWarn = { message: null };

const sandbox = {
    console: {
        log: console.log,
        warn: (msg) => {
            lastWarn.message = msg;
        },
        error: console.error
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    Blob: class { constructor() {} },
    JSON: JSON,
    Object: Object,
    Array: Array,
    chrome: {
        runtime: { lastError: null },
        storage: {
            sync: {
                QUOTA_BYTES: 102400,
                QUOTA_BYTES_PER_ITEM: 8192,
                get: (_keys, cb) => cb({ extensionEnabled: true, wordMap: {} }),
                set: (_data, cb) => { if (cb) cb(); }
            },
            local: {
                get: (_keys, cb) => cb({}),
                set: (_data, cb) => { if (cb) cb(); }
            },
            onChanged: { addListener: () => {} }
        }
    },
    document: {
        addEventListener: () => {},
        getElementById: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
        querySelector: () => null,
        querySelectorAll: () => []
    },
    window: {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    FileReader: class { readAsText() {} addEventListener() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    alert: () => {},
    confirm: () => false
};

sandbox.window = sandbox;

// Load manage.js into the sandbox
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'manage.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

if (typeof sandbox.safeWordMap !== 'function') {
    console.error('FATAL: manage.js did not expose safeWordMap()');
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

function resetWarn() {
    lastWarn.message = null;
}

// ---------------------------------------------------------------------------
// TESTS: safeWordMap
// ---------------------------------------------------------------------------

console.log('\nsafeWordMap tests\n');

// 1. Valid object
(() => {
    resetWarn();
    const input = { a: { replacement: 'b', enabled: true, caseSensitive: false } };
    const result = sandbox.safeWordMap(input);
    // safeWordMap returns a sanitized, prototype-less COPY (not the same
    // reference) to defend against prototype pollution. Verify the data is
    // preserved and the result carries no prototype.
    assert(result.a && result.a.replacement === 'b', 'Preserves valid rule data');
    assert(Object.getPrototypeOf(result) === null, 'Returns a prototype-less object');
    assert(lastWarn.message === null, 'No warning for valid object');
})();

// 2. undefined
(() => {
    resetWarn();
    const result = sandbox.safeWordMap(undefined);
    assert(typeof result === 'object' && result !== null && Object.keys(result).length === 0, 'Returns {} for undefined');
    assert(lastWarn.message === null, 'No warning for undefined');
})();

// 3. null
(() => {
    resetWarn();
    const result = sandbox.safeWordMap(null);
    assert(typeof result === 'object' && result !== null && Object.keys(result).length === 0, 'Returns {} for null');
    // Logger.warn calls console.warn with a prefix
    assert(lastWarn.message && lastWarn.message.includes('corrupted'), 'Logs warning for null');
})();

// 4. Array
(() => {
    resetWarn();
    const result = sandbox.safeWordMap([1, 2, 3]);
    assert(typeof result === 'object' && !Array.isArray(result) && result !== null && Object.keys(result).length === 0, 'Returns {} for array');
    assert(lastWarn.message && lastWarn.message.includes('corrupted'), 'Logs warning for array');
})();

// 5. String
(() => {
    resetWarn();
    const result = sandbox.safeWordMap('not an object');
    assert(typeof result === 'object' && result !== null && Object.keys(result).length === 0, 'Returns {} for string');
    assert(lastWarn.message && lastWarn.message.includes('corrupted'), 'Logs warning for string');
})();

// 6. Number
(() => {
    resetWarn();
    const result = sandbox.safeWordMap(42);
    assert(typeof result === 'object' && result !== null && Object.keys(result).length === 0, 'Returns {} for number');
    assert(lastWarn.message && lastWarn.message.includes('corrupted'), 'Logs warning for number');
})();

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('  SAFEWORDMAP TESTS FAILED');
    process.exit(1);
}
