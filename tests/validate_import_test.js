const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------------
// SANDBOX SETUP
// manage.js runs in a browser extension context that expects globals like
// chrome.storage, document, Blob, etc. We mock just enough to let the file
// load without errors so we can call validateImportedRules() in isolation.
// ---------------------------------------------------------------------------

const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    Blob: Blob,
    JSON: JSON,
    Object: Object,
    Array: Array,
    // manage.js reads these constants at load time
    chrome: {
        runtime: { lastError: null },
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

// Verify that validateImportedRules is accessible
if (typeof sandbox.validateImportedRules !== 'function') {
    console.error('FATAL: manage.js did not expose validateImportedRules() — it may have been wrapped in a module or IIFE.');
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
// TESTS: validateImportedRules
// ---------------------------------------------------------------------------

console.log('\nvalidateImportedRules — rejection cases\n');

// 1. Empty key
(() => {
    const rules = { '': { replacement: 'x', caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('empty'), 'Rejects empty key');
})();

// 2. Reserved keys
for (const key of ['__proto__', 'constructor', 'prototype']) {
    const rules = { [key]: { replacement: 'x', caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('reserved'), `Rejects reserved key: "${key}"`);
}

// 3. Key exceeding MAX_PATTERN_LENGTH (255)
(() => {
    const longKey = 'a'.repeat(256);
    const rules = { [longKey]: { replacement: 'x', caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('maximum pattern length'), 'Rejects key exceeding max length');
})();

// 4. Non-object values
for (const [label, val] of [['string', 'hello'], ['number', 42], ['null', null], ['array', [1, 2]], ['undefined', undefined]]) {
    const rules = { word: val };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('Invalid rule format'), `Rejects non-object value: ${label}`);
}

// 5. Missing replacement field
(() => {
    const rules = { word: { caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('replacement value'), 'Rejects missing replacement (undefined)');
})();

// 6. Non-string replacement
for (const [label, val] of [['number', 123], ['boolean', true], ['object', {}], ['array', []]]) {
    const rules = { word: { replacement: val, caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('replacement value'), `Rejects non-string replacement: ${label}`);
}

// 7. Replacement exceeding max length
(() => {
    const rules = { word: { replacement: 'b'.repeat(256), caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string' && result.includes('maximum length'), 'Rejects replacement exceeding max length');
})();

console.log('\nvalidateImportedRules — acceptance & sanitization\n');

// 8. Valid rule passes
(() => {
    const rules = { hello: { replacement: 'world', caseSensitive: true, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(result === null, 'Accepts valid rule');
})();

// 9. Multiple valid rules pass
(() => {
    const rules = {
        foo: { replacement: 'bar', caseSensitive: false, enabled: true },
        baz: { replacement: 'qux', caseSensitive: true, enabled: false }
    };
    const result = sandbox.validateImportedRules(rules);
    assert(result === null, 'Accepts multiple valid rules');
})();

// 10. Key at exactly MAX_PATTERN_LENGTH passes
(() => {
    const key = 'x'.repeat(255);
    const rules = { [key]: { replacement: 'y', caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(result === null, 'Accepts key at exactly max length (255)');
})();

// 11. Replacement at exactly MAX_PATTERN_LENGTH passes
(() => {
    const rules = { word: { replacement: 'z'.repeat(255), caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(result === null, 'Accepts replacement at exactly max length (255)');
})();

// 12. Boolean coercion for caseSensitive
(() => {
    const rules = { word: { replacement: 'x', caseSensitive: 1, enabled: true } };
    sandbox.validateImportedRules(rules);
    assert(rules.word.caseSensitive === true, 'Coerces truthy caseSensitive (1 → true)');
})();

(() => {
    const rules = { word: { replacement: 'x', caseSensitive: 0, enabled: true } };
    sandbox.validateImportedRules(rules);
    assert(rules.word.caseSensitive === false, 'Coerces falsy caseSensitive (0 → false)');
})();

// 13. Boolean coercion for enabled
(() => {
    const rules = { word: { replacement: 'x', caseSensitive: false, enabled: 'yes' } };
    sandbox.validateImportedRules(rules);
    assert(rules.word.enabled === true, 'Coerces truthy enabled ("yes" → true)');
})();

(() => {
    const rules = { word: { replacement: 'x', caseSensitive: false, enabled: '' } };
    sandbox.validateImportedRules(rules);
    assert(rules.word.enabled === false, 'Coerces falsy enabled ("" → false)');
})();

// 14. Unknown fields stripped
(() => {
    const rules = {
        word: {
            replacement: 'x',
            caseSensitive: true,
            enabled: true,
            author: 'someone',
            timestamp: 1234567890,
            notes: 'test note'
        }
    };
    sandbox.validateImportedRules(rules);
    const keys = Object.keys(rules.word).sort();
    assert(
        keys.length === 3 && keys[0] === 'caseSensitive' && keys[1] === 'enabled' && keys[2] === 'replacement',
        'Strips unknown fields (author, timestamp, notes removed)'
    );
})();

// 15. Defaults for missing optional booleans
(() => {
    const rules = { word: { replacement: 'x' } };
    sandbox.validateImportedRules(rules);
    assert(rules.word.caseSensitive === false, 'Defaults caseSensitive to false when missing');
    assert(rules.word.enabled === true, 'Defaults enabled to true when missing');
})();

// 16. Empty replacement string is valid
(() => {
    const rules = { word: { replacement: '', caseSensitive: false, enabled: true } };
    const result = sandbox.validateImportedRules(rules);
    assert(result === null, 'Accepts empty replacement string (deletion rule)');
})();

// 17. First invalid rule stops validation
(() => {
    const rules = {
        good: { replacement: 'fine', caseSensitive: false, enabled: true },
        '': { replacement: 'bad', caseSensitive: false, enabled: true },
        also_good: { replacement: 'ok', caseSensitive: false, enabled: true }
    };
    const result = sandbox.validateImportedRules(rules);
    assert(typeof result === 'string', 'Returns error on first invalid rule (does not continue)');
})();

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('  VALIDATION TESTS FAILED');
    process.exit(1);
}
