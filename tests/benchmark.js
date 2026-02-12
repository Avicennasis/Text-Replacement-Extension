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
let code = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

// Increase timeout for benchmark purposes
code = code.replace('const REGEX_TIMEOUT_MS = 100;', 'const REGEX_TIMEOUT_MS = 10000;');

// Run content.js in the sandbox
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

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
// Check if replacements happened
if (textNode.nodeValue.includes("da quick brown fox")) {
    console.log("✅ Verification Passed: Text was replaced.");
} else {
    console.error("❌ Verification Failed: Text was NOT replaced correctly.");
    console.log("Snippet:", textNode.nodeValue.substring(0, 100));
}
