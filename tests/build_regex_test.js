const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------------
// SANDBOX SETUP
// content.js runs in a browser extension context. We mock enough to let it load.
// ---------------------------------------------------------------------------

const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    performance: { now: () => Date.now() },
    Node: {
        TEXT_NODE: 3,
        ELEMENT_NODE: 1
    },
    NodeFilter: {
        SHOW_TEXT: 4,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2
    },
    MutationObserver: class {
        constructor() {}
        observe() {}
        disconnect() {}
    },
    chrome: {
        runtime: { lastError: null },
        storage: {
            sync: {
                get: (keys, cb) => cb({ extensionEnabled: true, wordMap: {} }),
            },
            onChanged: { addListener: () => {} }
        }
    },
    document: {
        documentElement: {
            observe: () => {}
        },
        addEventListener: () => {},
        body: null
    }
};

sandbox.window = sandbox;

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Verify functions are exposed
if (typeof sandbox.escapeRegExp !== 'function') {
    console.error('FATAL: content.js did not expose escapeRegExp()');
    process.exit(1);
}
if (typeof sandbox.buildRegex !== 'function') {
    console.error('FATAL: content.js did not expose buildRegex()');
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

function assertEquals(actual, expected, label) {
    if (actual === expected) {
        console.log(`  [PASS] ${label}`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label} (Expected: "${expected}", Actual: "${actual}")`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// TESTS: escapeRegExp
// ---------------------------------------------------------------------------

console.log('\n--- Testing escapeRegExp ---');

assertEquals(sandbox.escapeRegExp('hello'), 'hello', 'Escapes normal string');
assertEquals(sandbox.escapeRegExp('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\', 'Escapes all special characters');
assertEquals(sandbox.escapeRegExp('$5.00'), '\\$5\\.00', 'Escapes currency and dot');

// ---------------------------------------------------------------------------
// TESTS: buildRegex
// ---------------------------------------------------------------------------

console.log('\n--- Testing buildRegex ---');

// 1. Empty and invalid inputs
assertEquals(sandbox.buildRegex([], true), null, 'Returns null for empty array');
assertEquals(sandbox.buildRegex([''], true), null, 'Returns null for array with only empty string');
assertEquals(sandbox.buildRegex(['   '], true).source, '   ', 'Keeps whitespace-only strings');
// Re-testing empty filter
assertEquals(sandbox.buildRegex(['', ''], false), null, 'Returns null for array with multiple empty strings');

// 2. Flags
assert(sandbox.buildRegex(['test'], true).flags.includes('g') && !sandbox.buildRegex(['test'], true).flags.includes('i'), 'Case-sensitive has "g" flag, no "i"');
assert(sandbox.buildRegex(['test'], false).flags.includes('g') && sandbox.buildRegex(['test'], false).flags.includes('i'), 'Case-insensitive has "gi" flags');

// 3. Sorting (Longest first)
// Pattern should be "superman|super" not "super|superman"
const sortedRegex = sandbox.buildRegex(['super', 'superman'], true);
assertEquals(sortedRegex.source, '\\bsuperman\\b|\\bsuper\\b', 'Sorts words by length (longest first)');

// 4. Word Boundaries (\b)
// "cat" -> "\bcat\b" (starts and ends with word char)
assertEquals(sandbox.buildRegex(['cat'], true).source, '\\bcat\\b', 'Adds boundaries to word characters');

// "$5" -> "$5" (starts with non-word char)
// Note: $ is NOT a word character. \w is [a-zA-Z0-9_]
// 5 IS a word character.
// word = "$5"
// /^\w/.test("$5") -> false (starts with $)
// /\w$/.test("$5") -> true (ends with 5)
// expected: "$5\b"
assertEquals(sandbox.buildRegex(['$5'], true).source, '\\$5\\b', 'Suffix boundary if ends with word char, but no prefix if starts with non-word');

// "test!" -> "\btest!" (ends with non-word char)
assertEquals(sandbox.buildRegex(['test!'], true).source, '\\btest!', 'Prefix boundary if starts with word char, but no suffix if ends with non-word');

// "!!!test" -> "!!!test\b" (starts with non-word, ends with word)
assertEquals(sandbox.buildRegex(['!!!test'], true).source, '!!!test\\b', 'Prefix: no, Suffix: yes');

// Mixed boundaries in alternation
const mixedRegex = sandbox.buildRegex(['cat', '$5'], true);
assertEquals(mixedRegex.source, '\\bcat\\b|\\$5\\b', 'Correct boundaries for multiple mixed words');

// 5. Integration of sorting and boundaries
const integrationRegex = sandbox.buildRegex(['a', 'abc', '$1'], true);
// abc (length 3, word chars) -> \babc\b
// $1 (length 2, non-word start, word end) -> \$1\b
// a (length 1, word char) -> \ba\b
assertEquals(integrationRegex.source, '\\babc\\b|\\$1\\b|\\ba\\b', 'Full integration: sorting and boundary logic');

// ---------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
