// =============================================================================
// TEST: shouldProcessNode()
// =============================================================================
//
// PRIVACY NOTE FOR NON-DEVELOPERS:
// This file is a TEST. It does not run in your browser. It is only used by
// our developers and our automated checks (GitHub Actions) to make sure that
// the real extension code (in src/content.js) keeps doing the right thing
// when we change it. Tests like this one cannot read your data, talk to the
// internet, or affect what the extension does on a website. They only check
// our own code against fake, made-up examples.
//
// WHAT IS BEING TESTED:
// The extension scans every page you visit looking for text to replace. But
// it must be careful: there are some places on a page where changing text
// would break things. For example:
//   - Inside a <script> tag: that's program code, not visible text.
//   - Inside a <style> tag: that's design rules for the page.
//   - Inside a text input or text area: you might be typing there right now.
//   - Inside an SVG (a kind of drawing or chart): swapping words in a chart
//     could ruin how the picture looks.
//   - Inside a "rich text editor" (like a comment box on Reddit or a note
//     in Notion): again, you might be typing.
//
// The function called shouldProcessNode() is the bouncer at the door. For
// every chunk of text on the page, the extension asks: "Should I touch this
// one?" and shouldProcessNode answers yes or no. This test checks that the
// bouncer says yes/no in all the situations we care about.
//
// HOW THESE TESTS WORK:
// We build small fake "pretend pages" — just enough of a fake to fool the
// real shouldProcessNode function — and ask the function whether it would
// touch a piece of text inside that fake page. Then we compare its answer
// to the answer we want.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Real web addresses that the browser uses internally to label what kind of
// element something is. SVG drawings are labelled with one address, regular
// HTML elements (paragraphs, divs, etc.) with another. The extension uses
// these labels to decide what to leave alone.
const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

// Build a small "fake browser" sandbox so we can load the real content.js
// file without actually being inside a web page. The fake sandbox provides
// just enough pretend versions of browser features (Node, NodeFilter, etc.)
// for content.js to load without crashing. None of these fakes do anything
// real — they're empty stand-ins.
const sandbox = {
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
sandbox.window = sandbox;

// Load the real content.js into the fake sandbox so we can call its
// functions and check what they do.
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Safety check: if a future code change accidentally hides shouldProcessNode
// (for example, by wrapping it inside another function so we can't reach it),
// stop right here with a clear error instead of silently passing zero tests.
if (typeof sandbox.shouldProcessNode !== 'function') {
  console.error('FATAL: content.js did not expose shouldProcessNode() to global scope.');
  process.exit(1);
}

// Tiny tally so the test prints a clear "X passed, Y failed" summary.
let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}: expected ${expected}, got ${actual}`);
  }
}

// Helper: build a fake piece of text on a fake page. The real browser keeps
// a chain of "this is inside that" relationships — a word is inside a
// paragraph, the paragraph is inside a div, the div is inside the page body,
// and so on. We pass in that chain (innermost first) and this helper builds
// a chain of fake elements with the right pretend labels and pretend
// behaviour, just enough for shouldProcessNode to inspect.
function makeTextNode(chain) {
  const elements = chain.map((entry) => ({
    // The element's tag name (e.g., 'DIV', 'SCRIPT', 'svg').
    tagName: entry.tagName,
    // The label that says what kind of element this is (HTML or SVG).
    // Defaults to HTML because that's what most page elements are.
    namespaceURI: entry.namespaceURI ?? HTML_NS,
    // Whether the user is allowed to type into this element. Used to skip
    // text the user is editing right now.
    isContentEditable: entry.isContentEditable ?? false,
  }));

  // Wire up the parent-child links. Element 0 is the immediate parent of the
  // text; element 1 is its parent; and so on outward. The browser exposes
  // both "parentNode" and "parentElement" — for our purposes they point at
  // the same element.
  for (let i = 0; i < elements.length - 1; i++) {
    elements[i].parentNode = elements[i + 1];
    elements[i].parentElement = elements[i + 1];
  }

  // The fake text node itself. nodeType 3 is the standard browser code for
  // "this is a piece of text".
  return {
    nodeType: 3,
    parentNode: elements[0],
    parentElement: elements[0],
  };
}

console.log('shouldProcessNode():');

// ----- Happy path: ordinary text on the page should be processed. -----
check(
  'plain text in <div> is processed',
  sandbox.shouldProcessNode(makeTextNode([{ tagName: 'DIV' }])),
  true
);

// ----- Detached / odd nodes: don't touch anything weird. -----
// "Detached" means the text used to be on the page but has just been removed
// (e.g., a tweet you scrolled past on Twitter). The browser sometimes tells
// us about such text right after it disappears. We must NOT try to change
// it, because doing so would crash the extension.
check(
  'detached node (no parentNode) is skipped',
  sandbox.shouldProcessNode({ nodeType: 3, parentNode: null, parentElement: null }),
  false
);
check(
  'parent with no tagName (e.g. document node) is skipped',
  sandbox.shouldProcessNode({ nodeType: 3, parentNode: { tagName: null }, parentElement: null }),
  false
);

// ----- IGNORED_TAGS: places we always leave alone. -----
// Each of these elements holds something other than ordinary visible text.
// We never want to change words inside them, no matter what the user's
// rules say.
for (const tag of ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']) {
  check(
    `text in <${tag.toLowerCase()}> is skipped`,
    sandbox.shouldProcessNode(makeTextNode([{ tagName: tag }])),
    false
  );
}

// ----- SVG: drawings, charts, and diagrams must stay untouched. -----
// SVG is how websites show interactive charts and shaped drawings. Their
// text labels are part of the picture. Replacing those words could shift
// labels off the chart, distort logos, or otherwise wreck the drawing.
check(
  'text directly inside <svg> (SVG namespace) is skipped',
  sandbox.shouldProcessNode(makeTextNode([{ tagName: 'svg', namespaceURI: SVG_NS }])),
  false
);
check(
  'text inside <text> inside <svg> is skipped',
  sandbox.shouldProcessNode(makeTextNode([
    { tagName: 'text', namespaceURI: SVG_NS },
    { tagName: 'svg', namespaceURI: SVG_NS },
  ])),
  false
);
check(
  'text deeply nested inside SVG (<tspan>/<text>/<g>/<svg>) is skipped',
  sandbox.shouldProcessNode(makeTextNode([
    { tagName: 'tspan', namespaceURI: SVG_NS },
    { tagName: 'text', namespaceURI: SVG_NS },
    { tagName: 'g', namespaceURI: SVG_NS },
    { tagName: 'svg', namespaceURI: SVG_NS },
  ])),
  false
);
// A text that just happens to be on the same page as an SVG (but not
// inside one) is fair game.
check(
  'text in <p> next to a sibling <svg> (no SVG ancestor) is processed',
  sandbox.shouldProcessNode(makeTextNode([
    { tagName: 'P' },
    { tagName: 'DIV' },
  ])),
  true
);

// ----- contentEditable: places where the user might be typing. -----
// "contentEditable" is the browser's way of marking a region the user can
// type into directly — comment boxes, in-page document editors, and so on.
// Changing text in those would feel like the keyboard is being hijacked.
check(
  'text whose parent is contentEditable is skipped',
  sandbox.shouldProcessNode(makeTextNode([{ tagName: 'DIV', isContentEditable: true }])),
  false
);
check(
  'text whose grandparent is contentEditable is skipped',
  sandbox.shouldProcessNode(makeTextNode([
    { tagName: 'SPAN' },
    { tagName: 'DIV', isContentEditable: true },
  ])),
  false
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
