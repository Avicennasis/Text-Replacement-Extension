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

for (const fn of ['escapeRegExp', 'buildRegex', 'isEditable']) {
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

if (typeof manageSandbox.findCaseInsensitiveCollision !== 'function') {
  console.error('FATAL: manage.js did not expose findCaseInsensitiveCollision().');
  process.exit(1);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
