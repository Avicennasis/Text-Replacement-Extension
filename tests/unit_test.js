// =============================================================================
// UNIT TESTS: utility functions in content.js and manage.js
// =============================================================================
//
// PRIVACY NOTE FOR NON-DEVELOPERS:
// This file is a TEST. It does not run in your browser, only on a developer's
// computer and on our automated checks (GitHub Actions). Tests cannot read
// your data, talk to the internet, or affect what the extension does on a
// website. They only check our own code against fake, made-up examples.
//
// WHAT IS BEING TESTED:
// The extension is built out of small helper functions that each do one
// specific job. This file exercises a few of those helpers directly:
//
//   - escapeRegExp(text):
//       Takes a piece of text the user wants to find (like "$5.00") and
//       prepares it for the matching engine, so that special punctuation
//       in the user's text gets treated as plain letters instead of as
//       pattern code.
//
//   - buildRegex(words, caseSensitive):
//       Combines all of a user's "find" words into a single matcher that
//       the extension uses to scan pages quickly.
//
//   - isEditable(node):
//       Asks "is the user typing here right now?" so we never change text
//       inside places like comment boxes or in-page document editors.
//
//   - findCaseInsensitiveCollision(rules, newText):
//       When the user adds a new rule, this checks whether they already
//       have one that matches the same word ignoring upper/lower case
//       (for example, both "cat" and "Cat" without case-sensitive matching
//       would fight each other).
//
// HOW THESE TESTS WORK:
// We load the real source files into a small fake browser sandbox (just
// enough to make them happy), then call the helper functions with simple
// inputs and check the answers.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  // Compare with JSON to handle objects and arrays cleanly. We don't deep-
  // compare regex objects with this — for those, callers convert to strings.
  const a = typeof actual === 'object' ? JSON.stringify(actual) : actual;
  const e = typeof expected === 'object' ? JSON.stringify(expected) : expected;
  if (a === e) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}: expected ${e}, got ${a}`);
  }
}

// ---------------------------------------------------------------------------
// Sandbox 1: content.js — exposes escapeRegExp, buildRegex, isEditable.
// We provide just enough fake browser objects for the file to load.
// ---------------------------------------------------------------------------
const contentSandbox = {
  console,
  setTimeout,
  clearTimeout,
  performance: require('perf_hooks').performance,
  window: {},
  document: {
    body: {},
    createTreeWalker: () => ({ nextNode: () => false }),
  },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  Set,
  MutationObserver: class { observe() {} disconnect() {} },
  chrome: {
    runtime: { lastError: null },
    storage: {
      sync: { get: (_k, cb) => cb({ extensionEnabled: true, wordMap: {} }) },
      onChanged: { addListener: () => {} },
    },
  },
};
contentSandbox.window = contentSandbox;
const contentCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
vm.createContext(contentSandbox);
vm.runInContext(contentCode, contentSandbox);

for (const fn of ['escapeRegExp', 'buildRegex', 'isEditable', 'updateRegexes']) {
  if (typeof contentSandbox[fn] !== 'function') {
    console.error(`FATAL: content.js did not expose ${fn}() to global scope.`);
    process.exit(1);
  }
}

// =============================================================================
// escapeRegExp()
// =============================================================================
// The job: turn each "special" punctuation character in the user's text into
// a literal one, by sticking a backslash in front of it. The matcher engine
// otherwise treats characters like ".", "*", "?", "(", ")" as pattern syntax.
console.log('escapeRegExp():');

check('plain text passes through unchanged', contentSandbox.escapeRegExp('cat'), 'cat');
check('empty string passes through unchanged', contentSandbox.escapeRegExp(''), '');

// Each of these characters is "special" to a regex engine. Without escaping,
// "$5.00" would be interpreted as: "$ end-of-line, 5, any-character, 0, 0".
check('dollar sign is escaped', contentSandbox.escapeRegExp('$'), '\\$');
check('period is escaped', contentSandbox.escapeRegExp('.'), '\\.');
check('asterisk is escaped', contentSandbox.escapeRegExp('*'), '\\*');
check('plus is escaped', contentSandbox.escapeRegExp('+'), '\\+');
check('question mark is escaped', contentSandbox.escapeRegExp('?'), '\\?');
check('caret is escaped', contentSandbox.escapeRegExp('^'), '\\^');
check('open paren is escaped', contentSandbox.escapeRegExp('('), '\\(');
check('close paren is escaped', contentSandbox.escapeRegExp(')'), '\\)');
check('open bracket is escaped', contentSandbox.escapeRegExp('['), '\\[');
check('close bracket is escaped', contentSandbox.escapeRegExp(']'), '\\]');
check('open brace is escaped', contentSandbox.escapeRegExp('{'), '\\{');
check('close brace is escaped', contentSandbox.escapeRegExp('}'), '\\}');
check('pipe is escaped', contentSandbox.escapeRegExp('|'), '\\|');
check('backslash is escaped', contentSandbox.escapeRegExp('\\'), '\\\\');

// Realistic mixed inputs.
check('"$5.00" becomes "\\$5\\.00"', contentSandbox.escapeRegExp('$5.00'), '\\$5\\.00');
check('"C++" becomes "C\\+\\+"', contentSandbox.escapeRegExp('C++'), 'C\\+\\+');
check('"(test)" becomes "\\(test\\)"', contentSandbox.escapeRegExp('(test)'), '\\(test\\)');

// Letters and digits should NOT pick up backslashes.
check('letters and digits are unchanged', contentSandbox.escapeRegExp('abc123'), 'abc123');
check('whitespace is unchanged', contentSandbox.escapeRegExp('hello world'), 'hello world');

// =============================================================================
// buildRegex()
// =============================================================================
// The job: take a list of words the user wants to find and combine them into
// a single matcher. The matcher must:
//   - Find each word as a whole word (so "cat" doesn't match inside "catch").
//   - Match the longer of two overlapping words first ("$5.00" before "$5").
//   - Treat the user's text literally (escape special characters).
//   - Be empty when there are no words to look for.
console.log('\nbuildRegex():');

check('empty list returns null', contentSandbox.buildRegex([], false), null);
check('list of empty strings returns null', contentSandbox.buildRegex(['', ''], false), null);

// A single word builds a simple "word boundary" matcher.
const single = contentSandbox.buildRegex(['cat'], false);
// Note: we don't use `instanceof RegExp` here because the regex object was
// created inside the sandbox using the sandbox's own RegExp constructor —
// it's a "different" RegExp class from this test file's perspective. We
// check the constructor name instead, which works across sandbox boundaries.
check('single word produces a regex', single && single.constructor && single.constructor.name, 'RegExp');
check('single word matches the word', single.test('I have a cat.'), true);
check('single word does NOT match inside another word', contentSandbox.buildRegex(['cat'], false).test('catalog'), false);

// Case-insensitive matching uses the 'gi' flags.
const ci = contentSandbox.buildRegex(['cat'], false);
check('case-insensitive flag set', ci.flags.includes('i'), true);
check('case-insensitive matches different cases', contentSandbox.buildRegex(['cat'], false).test('CAT'), true);

// Case-sensitive matching uses just 'g' (no 'i').
const cs = contentSandbox.buildRegex(['cat'], true);
check('case-sensitive flag NOT set', cs.flags.includes('i'), false);
check('case-sensitive does NOT match different case', contentSandbox.buildRegex(['cat'], true).test('CAT'), false);

// Longest-match-first: when two patterns could match overlapping text, the
// regex engine takes whichever comes earlier in the alternation. "$5.00"
// should be tried before "$5" so "I paid $5.00" replaces the full price.
const longestFirst = contentSandbox.buildRegex(['$5', '$5.00'], false);
const sourceText = longestFirst.source;
const idx500 = sourceText.indexOf('5\\.00');
const idx5 = sourceText.indexOf('5(?!');
// The regex should mention $5.00 BEFORE $5. Since both share the "$5"
// prefix, we use a wider check: the "5\.00" substring should appear
// before the bare "5" with a word boundary after it.
check('longer pattern appears first in alternation', idx500 !== -1 && (idx5 === -1 || idx500 < idx5), true);

// Word boundaries: "$5" starts with the non-word character "$" (no leading
// \b), but ends with the digit "5" (a trailing \b is added). So:
//   - "$5" alone or followed by non-word chars: matches.
//   - "$500": no match — the trailing \b sees digit-then-digit, no boundary.
// This is the documented behaviour from the source comment near line 178.
const moneyRe = contentSandbox.buildRegex(['$5'], false);
check('"$5" matches "$5 only" (followed by space)', moneyRe.test('paid $5 only'), true);
check('"$5" does NOT match inside "$500" (digit follows)', contentSandbox.buildRegex(['$5'], false).test('$500'), false);
const wordRe = contentSandbox.buildRegex(['cat'], false);
check('"cat" does NOT match in "concatenate"', wordRe.test('concatenate'), false);

// =============================================================================
// isEditable()
// =============================================================================
// The job: tell us whether a piece of the page is something the user could
// type into right now — like a comment box, an in-page document editor, or
// any other "you can edit this" region. We refuse to change text in those
// places so we never look like we're hijacking the keyboard.
console.log('\nisEditable():');

check(
  'plain element is not editable',
  contentSandbox.isEditable({ isContentEditable: false, parentNode: null }),
  false
);
check(
  'directly editable element returns true',
  contentSandbox.isEditable({ isContentEditable: true, parentNode: null }),
  true
);
check(
  'element with editable parent returns true',
  contentSandbox.isEditable({
    isContentEditable: false,
    parentNode: { isContentEditable: true },
  }),
  true
);
check(
  'element with non-editable parent returns false',
  contentSandbox.isEditable({
    isContentEditable: false,
    parentNode: { isContentEditable: false },
  }),
  false
);
check(
  'element with no parent and no flag returns false',
  contentSandbox.isEditable({ isContentEditable: false }),
  false
);

// =============================================================================
// updateRegexes()
// =============================================================================
// The job: take the user's full set of saved rules and rebuild three things
// the page-scanning code needs to do its work:
//   1. Two fast lookup tables — one keyed by exact text, one keyed by the
//      lowercased version of the text — so that during scanning we can ask
//      "is this word a rule?" and get an answer in one step instead of
//      walking through every rule.
//   2. Two compiled matchers — one for "match exact letter case only" rules
//      and one for "match any letter case" rules.
// It also defends against bad data (corrupted storage, manual tampering,
// imported files with wrong shapes) by skipping anything that doesn't look
// like a real rule, and by capping the total number of rules at 255 so a
// huge list can never freeze the page.
console.log('\nupdateRegexes():');

// updateRegexes calls Logger.warn (which routes to console.warn) when it
// finds bad input. We silence console.warn for the duration of these tests
// so the test output stays readable. We re-install a counter when we want
// to confirm a warning actually fired.
const originalConsoleWarn = contentSandbox.console.warn;
contentSandbox.console.warn = () => {};

// Helper: turn the snapshot returned by updateRegexes() into a small,
// easy-to-assert summary. The cache objects use Object.create(null), so
// they have no prototype — Object.keys() works as expected.
function summarize(snapshot) {
  return {
    cacheKeys: Object.keys(snapshot.wordMapCache).sort(),
    cacheLowerKeys: Object.keys(snapshot.wordMapCacheLower).sort(),
    sensitiveRegexSource: snapshot.sensitiveRegex ? snapshot.sensitiveRegex.source : null,
    insensitiveRegexSource: snapshot.insensitiveRegex ? snapshot.insensitiveRegex.source : null,
  };
}

// --- Defensive: invalid input clears state, no crash. ---
//
// If storage is corrupted (e.g., the user manually edited it, or an import
// file overwrote the wordMap with a string), we throw away everything and
// stop matching. Better to do nothing than to mis-replace text.
let s = summarize(contentSandbox.updateRegexes(null));
check('null input clears wordMapCache', s.cacheKeys.length, 0);
check('null input clears wordMapCacheLower', s.cacheLowerKeys.length, 0);
check('null input clears sensitiveRegex', s.sensitiveRegexSource, null);
check('null input clears insensitiveRegex', s.insensitiveRegexSource, null);

s = summarize(contentSandbox.updateRegexes(undefined));
check('undefined input leaves caches empty', s.cacheKeys.length, 0);

s = summarize(contentSandbox.updateRegexes('not an object'));
check('string input leaves caches empty', s.cacheKeys.length, 0);

s = summarize(contentSandbox.updateRegexes(42));
check('number input leaves caches empty', s.cacheKeys.length, 0);

s = summarize(contentSandbox.updateRegexes([{ replacement: 'no' }]));
check('array input leaves caches empty', s.cacheKeys.length, 0);

// --- Happy path: a small map of healthy rules. ---
s = summarize(contentSandbox.updateRegexes({
  cat:  { replacement: 'dog',  caseSensitive: false, enabled: true },
  Bird: { replacement: 'fish', caseSensitive: true,  enabled: true },
}));
check('two healthy rules populate wordMapCache', s.cacheKeys, ['Bird', 'cat']);
// Only the case-insensitive rule is added to the lowercase lookup map.
// Case-sensitive rules ("Bird") deliberately stay out of it because they
// must match exact case at scan time.
check('only insensitive rule is in wordMapCacheLower', s.cacheLowerKeys, ['cat']);
check('sensitiveRegex is built when sensitive rules exist', s.sensitiveRegexSource !== null, true);
check('insensitiveRegex is built when insensitive rules exist', s.insensitiveRegexSource !== null, true);

// --- enabled: false rules are excluded entirely. ---
s = summarize(contentSandbox.updateRegexes({
  on:  { replacement: 'lit',  caseSensitive: false, enabled: true },
  off: { replacement: 'dark', caseSensitive: false, enabled: false },
}));
check('enabled rule appears in cache', s.cacheKeys.includes('on'), true);
check('disabled rule does NOT appear in cache', s.cacheKeys.includes('off'), false);

// --- enabled: undefined treats the rule as enabled (backwards compatibility
//     with rules saved before the toggle existed). ---
s = summarize(contentSandbox.updateRegexes({
  legacy: { replacement: 'kept', caseSensitive: false }, // no `enabled` field
}));
check('rule with no enabled field is treated as enabled', s.cacheKeys, ['legacy']);

// --- Reserved property names are skipped. The Object.create(null) caches
//     already protect against prototype pollution at the storage layer, but
//     letting "__proto__" or "constructor" through to the regex compiler
//     would still produce nonsense. ---
s = summarize(contentSandbox.updateRegexes({
  __proto__:   { replacement: 'evil', caseSensitive: false, enabled: true },
  constructor: { replacement: 'evil', caseSensitive: false, enabled: true },
  prototype:   { replacement: 'evil', caseSensitive: false, enabled: true },
  good:        { replacement: 'fine', caseSensitive: false, enabled: true },
}));
check('__proto__ key is skipped', s.cacheKeys.includes('__proto__'), false);
check('constructor key is skipped', s.cacheKeys.includes('constructor'), false);
check('prototype key is skipped', s.cacheKeys.includes('prototype'), false);
check('non-reserved key alongside reserved keys still passes through', s.cacheKeys.includes('good'), true);

// --- Malformed values are skipped (storage corruption defense). ---
s = summarize(contentSandbox.updateRegexes({
  goodRule:   { replacement: 'fine', caseSensitive: false, enabled: true },
  brokenStr:  'not an object',
  brokenNum:  42,
  brokenArr:  ['nope'],
  brokenNull: null,
}));
check('healthy rule survives alongside malformed siblings', s.cacheKeys.includes('goodRule'), true);
check('string-valued rule is skipped', s.cacheKeys.includes('brokenStr'), false);
check('number-valued rule is skipped', s.cacheKeys.includes('brokenNum'), false);
check('array-valued rule is skipped', s.cacheKeys.includes('brokenArr'), false);
check('null-valued rule is skipped', s.cacheKeys.includes('brokenNull'), false);

// --- Truncation at 255 rules. The cap mirrors MAX_RULES in manage.js and
//     prevents a tampered or imported wordMap from compiling a regex with
//     thousands of alternatives (which could freeze the page). ---
const overlimit = {};
for (let i = 0; i < 300; i++) {
  overlimit[`rule_${i}`] = { replacement: `r${i}`, caseSensitive: false, enabled: true };
}
s = summarize(contentSandbox.updateRegexes(overlimit));
check('exactly 255 rules survive when 300 are submitted', s.cacheKeys.length, 255);

// Boundary: exactly 255 rules pass through unchanged (the cap is inclusive).
const exactly255 = {};
for (let i = 0; i < 255; i++) {
  exactly255[`r_${i}`] = { replacement: `x${i}`, caseSensitive: false, enabled: true };
}
s = summarize(contentSandbox.updateRegexes(exactly255));
check('exactly 255 rules at the boundary all pass through', s.cacheKeys.length, 255);

// --- Case-insensitive collisions warn but don't crash. The lowercase lookup
//     map is keyed by the lowercased text, so two different-cased rules
//     ("Cat" and "CAT") that are both case-insensitive will overwrite each
//     other in the map. updateRegexes warns about this and lets the last
//     write win — the user has already been told via the manage.js UI that
//     collisions exist, so we don't refuse to load. ---
let warningCount = 0;
contentSandbox.console.warn = () => { warningCount++; };
s = summarize(contentSandbox.updateRegexes({
  Cat: { replacement: 'feline', caseSensitive: false, enabled: true },
  CAT: { replacement: 'TIGER',  caseSensitive: false, enabled: true },
}));
check('case-insensitive collision triggers a warning', warningCount > 0, true);
check('both colliding keys still appear in the exact-text cache',
  s.cacheKeys.includes('Cat') && s.cacheKeys.includes('CAT'), true);
// Only one entry exists in the lowercase cache (the last write wins).
check('lowercase cache holds exactly one entry for the colliding pair', s.cacheLowerKeys, ['cat']);
contentSandbox.console.warn = () => {}; // silence again for remaining tests

// --- All-disabled wordMap leaves regexes empty (no work to do). ---
s = summarize(contentSandbox.updateRegexes({
  a: { replacement: 'A', caseSensitive: false, enabled: false },
  b: { replacement: 'B', caseSensitive: true,  enabled: false },
}));
check('all-disabled rules clear sensitiveRegex', s.sensitiveRegexSource, null);
check('all-disabled rules clear insensitiveRegex', s.insensitiveRegexSource, null);
check('all-disabled rules leave the exact-text cache empty', s.cacheKeys.length, 0);

// Restore the original console.warn so any later tests in this file see real warnings.
contentSandbox.console.warn = originalConsoleWarn;

// ---------------------------------------------------------------------------
// Sandbox 2: manage.js — exposes findCaseInsensitiveCollision.
// manage.js touches a few more browser globals, so we mock those too.
// ---------------------------------------------------------------------------
const manageSandbox = {
  console,
  setTimeout,
  clearTimeout,
  Set,
  Blob,
  JSON,
  Object,
  Array,
  chrome: {
    runtime: { lastError: null },
    storage: {
      sync: {
        QUOTA_BYTES: 102400,
        QUOTA_BYTES_PER_ITEM: 8192,
        get: (_k, cb) => cb({ extensionEnabled: true, wordMap: {} }),
        set: (_d, cb) => { if (cb) cb(); },
      },
      onChanged: { addListener: () => {} },
    },
  },
  document: {
    addEventListener: () => {},
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  window: {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  FileReader: class { readAsText() {} addEventListener() {} },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  alert: () => {},
  confirm: () => false,
};
manageSandbox.window = manageSandbox;
const manageCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'manage.js'), 'utf8');
vm.createContext(manageSandbox);
vm.runInContext(manageCode, manageSandbox);

for (const fn of ['findCaseInsensitiveCollision', 'validateStorageQuota']) {
  if (typeof manageSandbox[fn] !== 'function') {
    console.error(`FATAL: manage.js did not expose ${fn}() to global scope.`);
    process.exit(1);
  }
}

// =============================================================================
// findCaseInsensitiveCollision()
// =============================================================================
// The job: when the user types a new rule, see whether they already have a
// case-insensitive rule that matches the same word. If two rules both want
// to act on the same word with no case-sensitivity, only one of them would
// actually fire — and which one is unpredictable. So we warn the user.
console.log('\nfindCaseInsensitiveCollision():');

const fn = manageSandbox.findCaseInsensitiveCollision;

// No collisions at all.
check('empty rule list returns null', fn({}, 'cat'), null);
check('no matching rules returns null', fn({ dog: { caseSensitive: false } }, 'cat'), null);

// Plain duplicate, both insensitive: collision.
check(
  'exact same key with case-insensitive existing rule collides',
  fn({ cat: { caseSensitive: false } }, 'cat'),
  'cat'
);

// Different case but both insensitive: collision (and the existing key is
// returned, not the new one — the test is on the input rule against the
// existing rules).
check(
  '"Cat" collides with existing "cat" (both insensitive)',
  fn({ cat: { caseSensitive: false } }, 'Cat'),
  'cat'
);
check(
  '"cat" collides with existing "CAT" (both insensitive)',
  fn({ CAT: { caseSensitive: false } }, 'cat'),
  'CAT'
);

// Case-sensitive existing rule does NOT collide — it only fires on its
// exact spelling, so co-existing with an insensitive rule on the same
// word is fine in practice.
check(
  'case-sensitive existing rule does NOT cause collision',
  fn({ Cat: { caseSensitive: true } }, 'cat'),
  null
);

// excludeKey: when the user is renaming a rule, we ask: "ignore this key
// while checking, since it's the rule being edited." Otherwise the rename
// would always look like a collision with itself.
check(
  'excludeKey skips matching rule (used during rename)',
  fn({ cat: { caseSensitive: false } }, 'cat', 'cat'),
  null
);
check(
  'excludeKey only skips that one key, not other matches',
  fn(
    { cat: { caseSensitive: false }, kitten: { caseSensitive: false } },
    'CAT',
    'kitten'
  ),
  'cat'
);

// Defensive: skip corrupted rule entries (null, non-object).
check(
  'null rule entry is skipped, not crashed on',
  fn({ broken: null, cat: { caseSensitive: false } }, 'CAT'),
  'cat'
);
check(
  'non-object rule entry is skipped',
  fn({ broken: 'oops', cat: { caseSensitive: false } }, 'CAT'),
  'cat'
);

// =============================================================================
// validateStorageQuota()
// =============================================================================
// The job: before the extension saves a set of rules, check whether they will
// fit in the browser's storage. Browsers limit how much data an extension can
// keep, both per-key (a stricter limit) and overall. If the user is about to
// exceed either limit, this function returns a friendly error message that
// the UI can show — and the save is cancelled. If everything fits, it
// returns null.
//
// Two limits are enforced:
//   - QUOTA_BYTES_PER_ITEM: 8 KB. All rules are stored under a single key
//     ("wordMap"), so this is the binding constraint in practice — the
//     combined size of every rule must fit under 8 KB.
//   - QUOTA_BYTES (a.k.a. SYNC_QUOTA_BYTES): 100 KB total across all keys.
//     Only relevant if the extension ever stores additional keys; right now
//     it doesn't, so hitting this limit before the per-item one is unusual.
console.log('\nvalidateStorageQuota():');

const vsq = manageSandbox.validateStorageQuota;

// --- Empty wordMap is always within limits. ---
check('empty wordMap returns null', vsq({}), null);

// --- A handful of small rules is well under the 8 KB per-item limit. ---
const tinyMap = {
  cat:  { replacement: 'dog',     caseSensitive: false, enabled: true },
  yes:  { replacement: 'no',      caseSensitive: false, enabled: true },
  blue: { replacement: 'green',   caseSensitive: false, enabled: true },
};
check('a few small rules return null (well under 8 KB)', vsq(tinyMap), null);

// --- A wordMap that exceeds 8 KB returns the per-item error. We synthesize
//     this by building rules with very long replacement strings until we
//     blow past the 8 KB threshold. Each rule serializes to roughly
//     80 + replacement-length bytes when JSON.stringified. ---
const overItemMap = {};
for (let i = 0; i < 30; i++) {
  // 400-character replacement × 30 rules ≈ 12 KB serialized — comfortably
  // over the 8 KB QUOTA_BYTES_PER_ITEM limit.
  overItemMap[`rule_${i}`] = {
    replacement: 'x'.repeat(400),
    caseSensitive: false,
    enabled: true,
  };
}
const overItemResult = vsq(overItemMap);
check('over-8KB wordMap returns a non-null error string',
  typeof overItemResult === 'string' && overItemResult.length > 0, true);
check('over-8KB error mentions the per-item limit',
  overItemResult && overItemResult.includes('per-item sync limit'), true);
check('over-8KB error includes the actual size in KB',
  overItemResult && /\d+(\.\d+)? KB/.test(overItemResult), true);

// --- Boundary: a wordMap that still fits comfortably under 8 KB returns null.
//     Each rule serializes to roughly 90 + replacement-length bytes (the
//     JSON wrapper {"replacement":"...","caseSensitive":false,"enabled":true}
//     plus the key). We pick 40 rules × 80-char replacement ≈ 5 KB, leaving
//     a healthy margin under the 8 KB QUOTA_BYTES_PER_ITEM cap. ---
const boundaryMap = {};
for (let i = 0; i < 40; i++) {
  boundaryMap[`r${i}`] = {
    replacement: 'y'.repeat(80),
    caseSensitive: false,
    enabled: true,
  };
}
check('wordMap comfortably under 8 KB returns null', vsq(boundaryMap), null);

// --- A wordMap structured to exceed the 100 KB total limit. Because the
//     per-item check runs FIRST and would catch this too (the per-item
//     limit is the binding one in practice), we cannot easily isolate
//     the total-quota branch with normal data. The check is exercised
//     anyway, just to confirm the function does not crash on huge inputs
//     and returns a non-null error message. ---
const hugeMap = {};
for (let i = 0; i < 200; i++) {
  hugeMap[`big_${i}`] = {
    replacement: 'z'.repeat(800),
    caseSensitive: false,
    enabled: true,
  };
}
const hugeResult = vsq(hugeMap);
check('massive wordMap returns a non-null error', typeof hugeResult === 'string', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
