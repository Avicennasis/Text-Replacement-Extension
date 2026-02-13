const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { performance } = require('perf_hooks');

// Mock DOM and Browser Environment
const sandbox = {
  console: console,
  performance: performance,
  window: {},
  Set: Set, // Ensure Set is available if not automatic
  document: {
    body: {},
    createTreeWalker: () => ({ nextNode: () => false }), // Mock for initial run
  },
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
    constructor(callback) {}
    observe() {}
    disconnect() {}
  },
  chrome: {
    runtime: { lastError: null },
    storage: {
      sync: {
        get: (keys, cb) => {
             // Return defaults to avoid errors
             cb({ extensionEnabled: true, wordMap: {} });
        }
      },
      onChanged: {
        addListener: () => {}
      }
    }
  }
};

// Add self-reference for window
sandbox.window = sandbox;

// Read content.js
let code = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

// Increase timeout for benchmark purposes
const patchedCode = code.replace('const REGEX_TIMEOUT_MS = 100;', 'const REGEX_TIMEOUT_MS = 10000;');
if (patchedCode === code) {
    console.error('WARNING: Failed to patch REGEX_TIMEOUT_MS. The constant may have been renamed or moved.');
    console.error('         Benchmark may timeout on large inputs.');
}
code = patchedCode;

// Run content.js in the sandbox
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Verify that content.js exposed the expected functions to the sandbox.
// If content.js is ever refactored to use an IIFE, module pattern, or
// ES modules, these function declarations would no longer be global.
if (typeof sandbox.processNode !== 'function') {
    console.error('FATAL: content.js did not expose processNode() — it may have been wrapped in a module or IIFE.');
    process.exit(1);
}
if (typeof sandbox.updateRegexes !== 'function') {
    console.error('FATAL: content.js did not expose updateRegexes() — it may have been wrapped in a module or IIFE.');
    process.exit(1);
}

// ---------------------------------------------------------
// BENCHMARK SETUP
// ---------------------------------------------------------

// 1. Setup Rules
const wordMap = {};
// specific replacements to force heavy regex usage
for (let i = 0; i < 1000; i++) {
  wordMap[`word${i}`] = { replacement: `REPLACED${i}`, caseSensitive: false, enabled: true };
}
// Add some common words to trigger frequent matches
wordMap['the'] = { replacement: 'da', caseSensitive: false, enabled: true };
wordMap['and'] = { replacement: '&', caseSensitive: false, enabled: true };
wordMap['is'] = { replacement: '=', caseSensitive: false, enabled: true };
// Add a single letter to really hammer the callback if logic allows (e.g., 'a' -> '@')
wordMap['a'] = { replacement: '@', caseSensitive: false, enabled: true };

// Add case-sensitive rules to exercise the sensitiveRegex path.
// Without these, only the insensitive regex is tested, leaving the
// two-pass cascade behavior (sensitive first, then insensitive) unverified.
wordMap['The'] = { replacement: 'DA-CASE', caseSensitive: true, enabled: true };
wordMap['Quick'] = { replacement: 'SLOW-CASE', caseSensitive: true, enabled: true };
wordMap['Fox'] = { replacement: 'WOLF-CASE', caseSensitive: true, enabled: true };

// Add a disabled rule to verify it is excluded from processing.
wordMap['DISABLED_WORD'] = { replacement: 'SHOULD_NOT_APPEAR', caseSensitive: false, enabled: false };

// Apply rules
sandbox.updateRegexes(wordMap);

// 2. Create Heavy Text Node
// We want enough text to make the benchmark meaningful (e.g., taking > 10ms)
let text = "";
const basePattern = "The quick brown fox jumps over the lazy dog. word50 word999 word0 is and the. ";
for (let i = 0; i < 10000; i++) {
  text += basePattern;
}

const textNode = {
  nodeType: 3, // Node.TEXT_NODE
  nodeValue: text,
  parentNode: {
    tagName: 'DIV',
    isContentEditable: false
  }
};

console.log(`Text length: ${text.length} chars`);
console.log(`Rules count: ${Object.keys(wordMap).length}`);

// 3. Measure Performance
const ITERATIONS = 20;
let totalTime = 0;

console.log("Starting benchmark...");

// Warmup
sandbox.processNode(textNode);

for (let i = 0; i < ITERATIONS; i++) {
  // Reset text node value for each run
  textNode.nodeValue = text;

  const start = performance.now();
  sandbox.processNode(textNode);
  const end = performance.now();
  totalTime += (end - start);
}

const avgTime = totalTime / ITERATIONS;
console.log(`Average time per run: ${avgTime.toFixed(4)} ms`);

// 4. Verify Correctness
// Correctness verification — check multiple replacements across both
// case-sensitive and case-insensitive paths.
const result = textNode.nodeValue;
const checks = [
    { search: 'da lazy', label: "'the' → 'da' (case-insensitive)" },
    { search: 'DA-CASE', label: "'The' → 'DA-CASE' (case-sensitive)" },
    { search: 'SLOW-CASE', label: "'Quick' → 'SLOW-CASE' (case-sensitive)" },
];

let allPassed = true;
for (const check of checks) {
    if (result.includes(check.search)) {
        console.log(`  ✓ PASS: ${check.label}`);
    } else {
        console.log(`  ✗ FAIL: ${check.label} — "${check.search}" not found in output`);
        allPassed = false;
    }
}

// Verify disabled rules are NOT applied
if (result.includes('SHOULD_NOT_APPEAR')) {
    console.log('  ✗ FAIL: Disabled rule was applied (should have been skipped)');
    allPassed = false;
} else {
    console.log('  ✓ PASS: Disabled rule correctly skipped');
}

if (!allPassed) {
    console.log('\n  VERIFICATION FAILED — some replacements did not work correctly');
    process.exit(1);
}
