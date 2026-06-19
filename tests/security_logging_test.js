const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------------
// SANDBOX SETUP
// ---------------------------------------------------------------------------

const logs = [];
const sandbox = {
    console: {
        log: (m, ...args) => {
            logs.push({ level: 'log', msg: m, args });
        },
        warn: (m, ...args) => {
            logs.push({ level: 'warn', msg: m, args });
        },
        error: (m, ...args) => {
            logs.push({ level: 'error', msg: m, args });
        }
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    Blob: class { constructor(parts) { this.size = parts.join('').length; } },
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
                get: (keys, cb) => {
                    const res = {};
                    if (typeof keys === 'string') {
                        res[keys] = sandbox.mockStorage[keys];
                    } else if (Array.isArray(keys)) {
                        keys.forEach(k => res[k] = sandbox.mockStorage[k]);
                    } else if (typeof keys === 'object' && keys !== null) {
                        Object.keys(keys).forEach(k => {
                            res[k] = sandbox.mockStorage[k] !== undefined ? sandbox.mockStorage[k] : keys[k];
                        });
                    }
                    cb(res);
                },
                set: (data, cb) => {
                    Object.assign(sandbox.mockStorage, data);
                    if (cb) cb();
                }
            },
            onChanged: { addListener: () => {} }
        }
    },
    document: {
        addEventListener: () => {},
        getElementById: (id) => ({
            id: id,
            value: '',
            addEventListener: () => {},
            click: () => {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            replaceChildren: () => {},
            closest: () => ({ remove: () => {} })
        }),
        createElement: (tag) => ({
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            appendChild: () => {},
            setAttribute: () => {},
            remove: () => {},
            addEventListener: () => {},
            cells: [
                { firstElementChild: { value: '' } },
                { firstElementChild: { value: '' } },
                { firstElementChild: { value: '' } },
                { firstElementChild: { value: '' } },
                { firstElementChild: { value: '' } }
            ]
        }),
        createDocumentFragment: () => ({
            appendChild: () => {}
        }),
        querySelector: () => null,
        querySelectorAll: () => [],
        body: {
            appendChild: () => {},
            removeChild: () => {}
        }
    },
    window: {},
    URL: { createObjectURL: () => 'blob:abc', revokeObjectURL: () => {} },
    FileReader: class {
        readAsText(file) {
            setTimeout(() => {
                if (this.onload) {
                    this.onload({ target: { result: file.content } });
                }
            }, 0);
        }
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    alert: () => {},
    confirm: () => true,
    mockStorage: {},
};

sandbox.window = sandbox;

let code = fs.readFileSync(path.join(__dirname, '..', 'src', 'manage.js'), 'utf8');
// Patch ENABLE_DEBUG_LOGGING to true so we can test debug logs
code = code.replace('const ENABLE_DEBUG_LOGGING = false;', 'const ENABLE_DEBUG_LOGGING = true;');

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

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
// SECURITY TESTS
// ---------------------------------------------------------------------------

async function runTests() {
    console.log('\nSecurity & Privacy Tests\n');

    // 1. Prototype Pollution via import
    await (async () => {
        logs.length = 0;
        const maliciousJson = '{"rules": {"__proto__": {"polluted": "yes"}, "normal": {"replacement": "safe"}}}';
        const file = { name: 'test.json', content: maliciousJson, size: maliciousJson.length };

        sandbox.importRules(file);

        // importRules is async (FileReader + chrome.storage.sync.get)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if global Object.prototype is polluted
        const polluted = {}.polluted === 'yes';
        assert(!polluted, 'Importing __proto__ does not pollute global Object.prototype');

        // Check if the wordMap itself is polluted
        const wordMap = sandbox.mockStorage.wordMap;
        if (wordMap) {
            // Note: with spread operator { ...wordMap }, __proto__ properties are not copied to own properties
            // but the wordMap itself could have a polluted __proto__ if it was assigned directly.
            const hasPollutedProto = wordMap.__proto__ && wordMap.__proto__.polluted === 'yes';
            assert(!hasPollutedProto, 'Merged wordMap should not have polluted __proto__');
        } else {
            console.log('  [SKIP] wordMap not found in storage (maybe import failed as expected)');
        }
    })();

    // 2. Sensitive Data Logging - Import
    await (async () => {
        logs.length = 0;
        const invalidJson = '{"rules": "not_an_object", "secret": "leaked_during_import"}';
        const file = { name: 'test.json', content: invalidJson, size: invalidJson.length };

        sandbox.importRules(file);
        await new Promise(resolve => setTimeout(resolve, 100));

        const leaked = logs.some(log => JSON.stringify(log).includes('leaked_during_import') || JSON.stringify(log).includes('not_an_object'));
        assert(!leaked, 'Sensitive data from invalid import JSON is not logged in error messages');
    })();

    // 3. Prototype Pollution via corrupted storage
    await (async () => {
        const corrupted = JSON.parse('{"__proto__": {"storagePolluted": "yes"}}');
        const result = sandbox.safeWordMap(corrupted);

        assert(!({}.storagePolluted === 'yes'), 'safeWordMap does not pollute global prototype from corrupted storage');
        assert(Object.getPrototypeOf(result) === null, 'safeWordMap returns a prototype-less object');
        assert(result.storagePolluted === undefined, 'safeWordMap does not include polluted properties');
    })();

    // 4. Sensitive Data Logging - Search
    await (async () => {
        logs.length = 0;
        const originalQuerySelectorAll = sandbox.document.querySelectorAll;
        sandbox.document.querySelectorAll = () => [{
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            cells: [
                { firstElementChild: { value: 'target' } },
                { firstElementChild: { value: 'replacement' } }
            ]
        }];

        sandbox.filterRules('MY_SECRET_QUERY');

        const leaked = logs.some(log => JSON.stringify(log).includes('MY_SECRET_QUERY'));
        assert(!leaked, 'Search queries are not logged in debug logs');

        sandbox.document.querySelectorAll = originalQuerySelectorAll;
    })();

    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log('  Some tests failed as expected on vulnerable code.');
    } else {
        console.log('  All security tests passed.');
    }
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
