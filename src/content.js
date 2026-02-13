'use strict';

// content.js
// -----------------------------------------------------------------------------
// TEXT REPLACEMENT CONTENT SCRIPT
// This script runs on every webpage you visit. Its ONLY purpose is to find
// text you want to replace and swap it with your chosen replacement.
//
// HOW IT WORKS:
// 1. Loads your replacement rules from browser storage.
// 2. Scans the page for matching text and replaces it.
// 3. Watches for new content (infinite scroll, AJAX, etc.) and processes
//    only the newly-added elements — not the entire page again.
//
// PRIVACY NOTICE:
// - This script does NOT send any data to external servers.
// - It does NOT track your browsing history.
// - All replacement rules are stored locally in your browser's sync storage.
// - It does NOT inject any external scripts, fonts, or resources.
// - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// SAFETY CONFIGURATION
// This timeout prevents the extension from hanging if regex operations take
// too long. If processing a single text node takes more than this limit, we
// skip it safely and move on. This protects against complex patterns being
// applied to very large text blocks (e.g., minified JavaScript that leaked
// into a visible text node).
// -----------------------------------------------------------------------------
const REGEX_TIMEOUT_MS = 100; // Maximum time (in milliseconds) to process a single text node

// Skip extremely large text nodes (e.g., minified JavaScript that leaked
// into a visible text node via a framework bug). With 255 rules, the regex
// engine must try every alternative at every character position. On a 1 MB
// node, that's ~255 million boundary checks — the per-match timeout cannot
// interrupt a single long match attempt. This limit is generous: normal
// paragraphs are well under 50,000 characters.
const MAX_TEXT_NODE_LENGTH = 50000;

// -----------------------------------------------------------------------------
// LOGGING UTILITY
// Simple logging system with levels. Set ENABLE_DEBUG_LOGGING to true to see
// detailed logs in the browser console. Useful for troubleshooting issues.
// In production, keep this false to reduce console noise.
// -----------------------------------------------------------------------------
const ENABLE_DEBUG_LOGGING = false; // Toggle this to enable/disable debug logs

// NOTE: This Logger is intentionally duplicated in background.js, content.js, and manage.js.
// In Manifest V3, content scripts, background service workers, and extension pages each run
// in isolated JavaScript contexts. There is no shared module system that works across all
// three contexts in all supported browsers (Chrome, Edge, Opera, Firefox). Attempting to
// share via ES modules would break Firefox compatibility. The duplication is small (~10 lines)
// and intentional — this is NOT a code smell, it's a cross-browser compatibility requirement.
const Logger = {
  /**
   * Logs informational messages (always shown, even when debug is off).
   * Use for important events like "Extension installed".
   */
  info: (message, ...args) => {
    console.log(`[Text Replacement] ${message}`, ...args);
  },

  /**
   * Logs debug messages (only shown when ENABLE_DEBUG_LOGGING is true).
   * Use for detailed technical information during development.
   */
  debug: (message, ...args) => {
    if (ENABLE_DEBUG_LOGGING) {
      console.log(`[Text Replacement DEBUG] ${message}`, ...args);
    }
  },

  /**
   * Logs warnings (always shown).
   * Use for recoverable problems or unexpected situations.
   */
  warn: (message, ...args) => {
    console.warn(`[Text Replacement WARNING] ${message}`, ...args);
  },

  /**
   * Logs errors (always shown).
   * Use for actual failures and exceptions.
   */
  error: (message, ...args) => {
    console.error(`[Text Replacement ERROR] ${message}`, ...args);
  }
};

/**
 * Custom error class thrown when regex processing exceeds REGEX_TIMEOUT_MS.
 * Using a dedicated class instead of checking error.message === 'Regex timeout'
 * is more robust — it survives minification, doesn't rely on string matching,
 * and clearly communicates intent.
 */
class RegexTimeoutError extends Error {
  constructor() {
    super('Regex processing exceeded time limit');
    this.name = 'RegexTimeoutError';
  }
}

// -----------------------------------------------------------------------------
// REGEX UTILITIES
// These functions safely compile user-provided text into Regular Expressions.
// -----------------------------------------------------------------------------

/**
 * Escapes special characters in a string to safe-guard against regex issues.
 * This prevents a "Regex Injection" attack and ensures that characters like
 * "." or "*" are treated as literal text, not special regex commands.
 *
 * For example, the user input "price is $5.00" becomes "price is \$5\.00"
 * so the regex engine doesn't interpret $ and . as special characters.
 *
 * @param {string} string - The raw user input to escape.
 * @returns {string} - The escaped string, safe to use in a RegExp constructor.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -----------------------------------------------------------------------------
// UNICODE BEHAVIOR NOTES
// JavaScript's \b word boundary only recognizes ASCII word characters
// [a-zA-Z0-9_]. Non-ASCII letters (accented characters like é, CJK
// characters, Cyrillic, etc.) are treated as non-word characters. This
// means:
//   - Replacing "café" works correctly (\b is not added around é).
//   - Replacing "uber" will NOT match inside "über" because \b correctly
//     sees the boundary between ü (non-word) and b (word).
//   - Case folding uses JavaScript's built-in toLowerCase(), which follows
//     Unicode Default Case Conversion (not locale-specific Turkish I, etc.).
//   - The regex does NOT use the 'u' (unicode) flag, so surrogate pairs
//     (emoji) are treated as two code units. This does not affect replacement
//     correctness since all user input is escaped to literal characters.
// -----------------------------------------------------------------------------

/**
 * Compiles a list of words into a single, optimized Regular Expression.
 * This allows the extension to search for ALL your words at once, rather than
 * looping through the entire page hundreds of times (which would be slow).
 *
 * SORTING: Words are sorted by length (longest first) so that "superman"
 * is matched before "super". This prevents partial replacements from
 * breaking longer words.
 *
 * WORD BOUNDARIES: The \b anchors ensure that replacing "cat" doesn't
 * accidentally turn "catch" into "dogch". Boundaries are only added when
 * the pattern starts/ends with a word character (letter, digit, underscore).
 *
 * @param {string[]} words - Array of words/phrases to find.
 * @param {boolean} caseSensitive - Whether to match exact casing.
 * @returns {RegExp|null} - Compiled regex, or null if no words provided.
 */
function buildRegex(words, caseSensitive) {
  if (words.length === 0) return null;

  // Filter out empty strings before building the regex. An empty string in
  // the alternation (e.g., "cat||dog") creates a zero-width match at every
  // character boundary, causing the regex to fire replaceCallback between
  // every character in the text — massive performance hit and wrong results.
  words = words.filter(w => w.length > 0);
  if (words.length === 0) return null;

  // Sort by ORIGINAL word length (longest first) BEFORE escaping.
  // This must happen before map() because escaping inflates lengths:
  // "$5" (2 chars) becomes "\$5" (3 chars), and "\b" anchors add 2 chars.
  // Sorting after escaping would use inflated lengths, potentially ordering
  // "cat" (3 chars) before "$5.00" (5 chars → "\$5\.00" = 7 chars).
  words.sort((a, b) => b.length - a.length);

  const patterns = words.map(word => {
    const escaped = escapeRegExp(word);

    // Add word boundaries (\b) only if the word starts/ends with a
    // letter, digit, or underscore. This ensures that replacing "cat"
    // doesn't modify "catch", but replacing "$5" (which starts with a
    // non-word character) can still match "$5" inside "$500".
    const prefix = /^\w/.test(word) ? '\\b' : '';
    const suffix = /\w$/.test(word) ? '\\b' : '';
    return `${prefix}${escaped}${suffix}`;
  });

  // Combine all patterns with | (OR) into one regex.
  // Flags: 'g' = global (find all matches), 'i' = case-insensitive.
  return new RegExp(patterns.join('|'), caseSensitive ? 'g' : 'gi');
}

// -----------------------------------------------------------------------------
// GLOBAL STATE
// These variables hold the current extension state. They are updated whenever
// settings change (e.g., when you add/remove rules in the management page).
// -----------------------------------------------------------------------------
let sensitiveRegex = null;   // Compiled regex for case-sensitive rules
let insensitiveRegex = null; // Compiled regex for case-insensitive rules
// Object.create(null) creates a "bare" object with NO inherited properties.
// A regular {} inherits methods like toString, valueOf, constructor from
// Object.prototype. If someone creates a rule to replace the word "toString",
// a regular {} lookup would return the inherited toString FUNCTION (truthy!),
// and .replacement would be undefined — replacing the matched text with the
// literal string "undefined". Object.create(null) prevents this by creating
// an object with zero inherited properties — only our explicitly-added rules exist.
let wordMapCache = Object.create(null);       // O(1) lookup map: exact original text → rule data
let wordMapCacheLower = Object.create(null);  // O(1) lookup map: lowercased text → rule data (for case-insensitive)
let extensionEnabled = true; // Master on/off switch state
let reprocessTimeout = null; // Debounce timer for storage-change re-scans

// Timeout tracking variables for the replaceCallback safety mechanism.
// These are module-scoped (not inside processNode) to avoid creating new
// closures for every text node, which would increase garbage collection pressure.
let nodeProcessingStartTime = 0; // Timestamp when we started processing the current node
let matchCounter = 0;            // Counts matches to throttle performance.now() calls

/**
 * Updates the internal regex patterns and lookup maps based on the current
 * replacement rules loaded from storage. Called whenever settings change.
 *
 * PERFORMANCE: Builds two hash maps (wordMapCache and wordMapCacheLower) that
 * allow O(1) constant-time lookups during replacement. Without these maps, we
 * would need to iterate through all rules for every match — O(n) complexity,
 * which gets slow with many rules.
 *
 * @param {Object} wordMap - The full rules object from storage.
 *   Each key is the original text, and each value is:
 *   { replacement: string, caseSensitive: boolean, enabled: boolean }
 */
function updateRegexes(wordMap) {
  // Guard against corrupted storage: wordMap must be a plain object.
  // This mirrors the safeWordMap() check in manage.js but is duplicated here
  // because content scripts run in an isolated context (see Logger note above).
  if (!wordMap || typeof wordMap !== 'object' || Array.isArray(wordMap)) {
    Logger.warn('Received invalid wordMap (expected object, got ' + typeof wordMap + ') — clearing all rules.');
    wordMapCache = Object.create(null);
    wordMapCacheLower = Object.create(null);
    sensitiveRegex = null;
    insensitiveRegex = null;
    return;
  }

  // Mirror the MAX_RULES limit from manage.js. If storage is manually tampered
  // with (via DevTools or corrupted sync) to contain thousands of rules, compiling
  // a regex with that many alternatives could freeze the page. We silently truncate
  // to the first 255 entries and log a warning.
  const MAX_RULES_LIMIT = 255;
  const entries = Object.entries(wordMap);
  if (entries.length > MAX_RULES_LIMIT) {
    Logger.warn('wordMap contains', entries.length, 'rules (limit is', MAX_RULES_LIMIT + ') — only the first', MAX_RULES_LIMIT, 'will be used.');
  }
  const entriesToProcess = entries.length > MAX_RULES_LIMIT ? entries.slice(0, MAX_RULES_LIMIT) : entries;

  const sensitiveWords = [];
  const insensitiveWords = [];
  // Use Object.create(null) to prevent prototype pollution — see explanation
  // at the wordMapCache/wordMapCacheLower declarations above.
  const activeMap = Object.create(null);
  const activeLowerMap = Object.create(null);

  for (const [word, data] of entriesToProcess) {
    // Skip JavaScript reserved property names that could appear in storage
    // due to manual edits or corrupted imports. The Object.create(null) caches
    // protect against prototype pollution, but these keys would still produce
    // nonsensical regex patterns.
    if (word === '__proto__' || word === 'constructor' || word === 'prototype') {
      Logger.warn('Skipping reserved key in wordMap:', word);
      continue;
    }

    // Skip malformed rules where the value is not an object (e.g., corrupted
    // storage where a key maps to a string, number, or array instead of the
    // expected {replacement, caseSensitive, enabled} structure).
    if (typeof data !== 'object' || Array.isArray(data)) {
      Logger.warn('Skipping malformed rule (expected object, got ' + typeof data + '):', word);
      continue;
    }

    // Only include rules that are explicitly enabled.
    // Rules with enabled === undefined are treated as enabled (backwards compat).
    if (data.enabled !== false) {

      activeMap[word] = data;

      // Build a lowercase lookup map for case-insensitive rules.
      // This allows O(1) lookup during replacement instead of O(n) iteration.
      if (!data.caseSensitive) {
        const lowerKey = word.toLowerCase();
        // Warn if two different rules collide on the same lowercase key.
        // This shouldn't happen (manage.js prevents it), but imported rules
        // or manually edited storage could contain duplicates.
        if (activeLowerMap[lowerKey]) {
          Logger.warn(`Case-insensitive collision: "${word}" overlaps with an existing rule for "${lowerKey}". Only one will take effect.`);
        }
        activeLowerMap[lowerKey] = data;
      }

      if (data.caseSensitive) {
        sensitiveWords.push(word);
      } else {
        insensitiveWords.push(word);
      }
    }
  }

  wordMapCache = activeMap;
  wordMapCacheLower = activeLowerMap;
  sensitiveRegex = buildRegex(sensitiveWords, true);
  insensitiveRegex = buildRegex(insensitiveWords, false);
}

// -----------------------------------------------------------------------------
// DOM SAFETY FILTERS
// These prevent the extension from modifying content it shouldn't touch.
// -----------------------------------------------------------------------------

/**
 * HTML tags we NEVER modify. Changing text inside these could:
 * - SCRIPT/STYLE/NOSCRIPT: Break website functionality or inject code
 * - TEXTAREA/INPUT: Corrupt text the user is actively typing
 */
// SVG is included because replacing text inside SVG elements could break
// rendered charts, diagrams, and other vector graphics. SVG elements use
// lowercase tagName in the DOM when inside HTML documents, so we include both
// the uppercase and lowercase forms for safety.
const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SVG', 'svg'
]);

/**
 * Checks if a DOM node is inside an editable area (like a rich text editor).
 * We skip these so we don't change text while the user is typing.
 *
 * The isContentEditable property checks the element AND all its ancestors,
 * so a single check normally suffices. The explicit parent check is a
 * defense-in-depth measure for edge cases (e.g., shadow DOM boundaries
 * or detached nodes) where inheritance might not propagate correctly.
 *
 * @param {Node} node - The DOM node to check (typically a text node's parent).
 * @returns {boolean} - True if the node is editable and should be skipped.
 */
function isEditable(node) {
  return node.isContentEditable || (node.parentNode?.isContentEditable ?? false);
}

/**
 * Determines whether a DOM node should be processed for text replacement.
 * Checks that the node is still attached to the DOM, is not inside an
 * ignored tag (SCRIPT, STYLE, etc.), and is not in an editable area.
 *
 * This is the single source of truth for "should we touch this node?" logic.
 * It is used by processNode(), processDocument(), and processElement() to
 * ensure consistent safety filtering in one place. Having this centralized
 * means a fix here automatically protects all code paths.
 *
 * @param {Node} node - The DOM node to check (typically a Text node).
 * @returns {boolean} - True if the node should be processed, false to skip it.
 */
function shouldProcessNode(node) {
  // Guard against detached nodes. MutationObserver can fire for nodes that
  // were removed from the DOM between when the mutation was recorded and
  // when this callback runs. Without this check, accessing parentNode.tagName
  // would throw a TypeError (Cannot read properties of null).
  // Some unusual DOM structures (e.g., text nodes directly under the document
  // node) have a parentNode with no tagName. Skip these safely.
  if (!node.parentNode || !node.parentNode.tagName) return false;

  // Skip nodes inside tags we should never modify (SCRIPT, STYLE, etc.)
  if (IGNORED_TAGS.has(node.parentNode.tagName)) return false;

  // Skip nodes inside editable areas (contentEditable, rich text editors)
  if (isEditable(node.parentNode)) return false;

  return true;
}

// -----------------------------------------------------------------------------
// REPLACEMENT ENGINE
// These functions perform the actual text replacement on the page.
// -----------------------------------------------------------------------------

/**
 * Callback function used by String.prototype.replace() to determine what
 * replacement text to use for each regex match.
 *
 * PERFORMANCE NOTES:
 * - Uses O(1) hash map lookups instead of O(n) iteration through all rules.
 * - Defined at module scope (not inside processNode) to avoid creating a new
 *   function closure for every text node processed. This reduces garbage
 *   collection overhead significantly on large pages.
 * - The timeout check uses a counter to avoid calling performance.now() on
 *   every single match. performance.now() has non-trivial overhead when called
 *   millions of times, so we only check every 50th match. This reduces timeout
 *   checking overhead by ~98% while still catching runaway patterns quickly.
 *
 * @param {string} match - The matched text from the regex.
 * @returns {string} - The replacement text to substitute.
 * @throws {RegexTimeoutError} - Throws if processing exceeds REGEX_TIMEOUT_MS.
 */
const replaceCallback = (match) => {
  // TIMEOUT SAFETY: Check if we've been processing too long.
  // This prevents the extension from hanging the browser on pathological
  // regex patterns or extremely large text blocks.
  // We only check every 50th match to minimize performance.now() overhead.
  matchCounter++;
  if (matchCounter % 50 === 0 && performance.now() - nodeProcessingStartTime > REGEX_TIMEOUT_MS) {
    throw new RegexTimeoutError(); // Caught by processNode's try/catch
  }

  // Step 1: Try exact match (handles case-sensitive rules).
  // This is the fastest path — direct hash map lookup, O(1).
  // The ?? (nullish coalescing) operator provides a safety net: if a rule
  // somehow has replacement === undefined or null (e.g., corrupted storage,
  // manual edits, old data format), we fall back to the original matched text
  // instead of replacing it with the literal string "undefined". We use ??
  // instead of || so that empty string "" (intentional text deletion) still works.
  if (match in wordMapCache) return wordMapCache[match].replacement ?? match;

  // Step 2: Try case-insensitive match using our pre-built lowercase map.
  // This is also O(1) — we lowercase the match and look it up directly.
  // OLD APPROACH: Looped through ALL keys comparing case-insensitively — O(n)!
  // NEW APPROACH: Direct hash lookup — O(1), instant regardless of rule count.
  const lowerMatch = match.toLowerCase();
  if (lowerMatch in wordMapCacheLower) {
    return wordMapCacheLower[lowerMatch].replacement ?? match;
  }

  // Step 3: Fallback — return the original match unchanged.
  // This should not happen if the regex was built correctly, but it's a safe
  // fallback that prevents data loss (we never delete text accidentally).
  return match;
};

/**
 * The core function that replaces text in a single DOM text node.
 * It applies both case-sensitive and case-insensitive regex patterns,
 * and only updates the DOM if the text actually changed.
 *
 * SAFETY FEATURES:
 * - Checks the master switch (extensionEnabled) before processing.
 * - Skips nodes inside ignored tags (SCRIPT, STYLE, etc.) and editable areas.
 * - Includes a timeout mechanism: if regex processing takes longer than
 *   REGEX_TIMEOUT_MS (100ms), the node is silently skipped. This prevents
 *   the browser from hanging on complex patterns applied to large text.
 * - Only updates the DOM if text actually changed, avoiding unnecessary reflows.
 *
 * @param {Text} node - A DOM Text node to process.
 */
function processNode(node) {
  // Safety guards: skip processing if the extension is off, or if this node
  // is detached, inside a tag we should never touch (scripts, textareas, etc.),
  // or inside an editable area. See shouldProcessNode() for full details.
  if (!extensionEnabled) return;
  // Note: callers (processDocument, processElement) already filter via
  // shouldProcessNode() in their TreeWalker accept functions. We re-check
  // here as defense-in-depth in case processNode is ever called from a
  // new code path that doesn't use a TreeWalker.
  if (!shouldProcessNode(node)) return;

  let text = node.nodeValue;

  if (text.length > MAX_TEXT_NODE_LENGTH) {
    Logger.debug('Skipping oversized text node:', text.length, 'chars');
    return;
  }

  let changed = false;

  // Start the timeout timer for this node. The REGEX_TIMEOUT_MS budget is
  // shared across BOTH regex passes (case-sensitive first, then case-insensitive).
  // If pass 1 is slow, pass 2 gets less time. This is intentional: the goal is
  // to protect the browser from spending too long on any single text node,
  // regardless of how many passes are needed.
  nodeProcessingStartTime = performance.now();
  matchCounter = 0;
  // Note: matchCounter is NOT reset between the case-sensitive and case-insensitive
  // passes. This is intentional — the timeout budget is shared across both passes,
  // so the counter reflects total work done on this node, not per-pass work.

  try {
    // TWO-PASS REPLACEMENT (cascade design)
    // ─────────────────────────────────────────────────────────────────────
    // JavaScript's RegExp does not support per-pattern flags — a single
    // regex is either case-sensitive or case-insensitive, not both. So we
    // must use two separate passes: one for case-sensitive rules and one
    // for case-insensitive rules.
    //
    // IMPORTANT: This is a CASCADE — the output of pass 1 feeds into
    // pass 2. This means if a case-sensitive rule produces text that
    // matches a case-insensitive rule, the second rule WILL fire. This
    // behavior is consistent and predictable, analogous to running
    // sequential find-and-replace operations in a text editor.
    //
    // If this is unwanted, the user should avoid creating rules whose
    // outputs match other rules' inputs. A true "independent merge"
    // solution (applying all rules to the original text simultaneously)
    // would be significantly more complex, with its own edge cases around
    // overlapping matches, and would provide marginal benefit for the
    // vast majority of use cases.
    // ─────────────────────────────────────────────────────────────────────

    // Pass 1: Apply case-sensitive replacements first.
    // Order matters: if a word appears in both sensitive and insensitive rules,
    // the sensitive rule takes priority.
    if (sensitiveRegex) {
      // Reset lastIndex for safety. While .replace() resets it per spec,
      // an errant .test() or .exec() call elsewhere could leave it dirty.
      sensitiveRegex.lastIndex = 0;
      const newText = text.replace(sensitiveRegex, replaceCallback);
      if (newText !== text) {
        text = newText;
        changed = true;
      }
    }

    // Pass 2: Apply case-insensitive replacements to the (possibly modified) text.
    if (insensitiveRegex) {
      // Reset lastIndex for safety. While .replace() resets it per spec,
      // an errant .test() or .exec() call elsewhere could leave it dirty.
      insensitiveRegex.lastIndex = 0;
      const newText = text.replace(insensitiveRegex, replaceCallback);
      if (newText !== text) {
        text = newText;
        changed = true;
      }
    }

    // Only touch the DOM if we actually changed something.
    // Writing to node.nodeValue triggers a browser reflow, so we avoid it
    // when unnecessary to keep the page responsive.
    if (changed) {
      // Guard against replacements that inflate the text to an extreme size.
      // For example, replacing a single character with a 255-character string
      // could multiply the node's length far beyond what's reasonable.
      if (text.length > MAX_TEXT_NODE_LENGTH * 2) {
        Logger.warn('Replacement inflated text node to', text.length, 'chars (limit:', MAX_TEXT_NODE_LENGTH * 2, ') — skipping write-back to protect performance.');
        return;
      }

      node.nodeValue = text;
    }
  } catch (error) {
    if (error instanceof RegexTimeoutError) {
      Logger.warn('Regex timeout on node (skipping)');
      Logger.debug('Timed-out node content preview:', node.nodeValue?.substring(0, 50));
      return;
    }
    // Log unexpected errors and continue processing other nodes instead of
    // crashing the entire TreeWalker/MutationObserver loop. One corrupted
    // text node should not prevent the rest of the page from being processed.
    Logger.error('Unexpected error processing node (skipping):', error);
  }
}

/**
 * Scans the ENTIRE document for text to replace.
 * Uses a TreeWalker, which is the most efficient way to traverse the DOM
 * for text nodes. The TreeWalker's filter function rejects nodes inside
 * ignored tags and editable areas, so they are never even visited.
 *
 * NOTE: This function scans the ENTIRE page, so it is used sparingly:
 *   - Once during initial page load (when rules are first loaded from storage).
 *   - When rules change (added/removed/edited) and the page needs re-scanning.
 *   - When the master switch is toggled ON (to apply previously-inactive rules).
 * For dynamic content (infinite scroll, AJAX, etc.), the MutationObserver
 * calls processElement() to only scan newly-added nodes — much faster!
 */
function processDocument() {
  if (!extensionEnabled) return;
  if (!sensitiveRegex && !insensitiveRegex) return;
  if (!document.body) return; // Safety check: page might not be fully loaded yet

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Use the shared safety filter (checks for detached nodes, ignored tags,
        // and editable areas). For text nodes (SHOW_TEXT filter), FILTER_REJECT
        // and FILTER_SKIP are equivalent because text nodes have no children
        // to skip over. We use FILTER_REJECT by convention.
        if (!shouldProcessNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker.nextNode()) {
    processNode(walker.currentNode);
  }
}

/**
 * Processes a single element and all its descendant text nodes.
 * This is MUCH faster than re-scanning the entire document!
 *
 * Used by the MutationObserver to process only newly-added content.
 * For example, when Twitter loads 10 new tweets, we scan only those 10 tweets,
 * not the entire page with thousands of existing tweets.
 *
 * @param {Node} element - The DOM node to process (Element or Text node).
 */
function processElement(element) {
  if (!extensionEnabled) return;
  if (!sensitiveRegex && !insensitiveRegex) return;

  // Skip entire element subtrees for tags we never modify (SCRIPT, STYLE, etc.).
  // This avoids creating a TreeWalker and iterating all children only to reject
  // every text node inside — a common scenario when SPAs inject code blocks.
  if (element.nodeType === Node.ELEMENT_NODE && IGNORED_TAGS.has(element.tagName)) {
    return;
  }

  // If it's a bare text node (not wrapped in an element), process it directly.
  if (element.nodeType === Node.TEXT_NODE) {
    // Use the shared safety filter (checks for detached nodes, ignored tags,
    // and editable areas) since we're bypassing the TreeWalker filter.
    if (!shouldProcessNode(element)) {
      return;
    }
    processNode(element);
    return;
  }

  // If it's an element node, use a TreeWalker to efficiently find all
  // descendant text nodes while respecting our safety filters.
  if (element.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Use the shared safety filter (see shouldProcessNode for details).
          // FILTER_REJECT and FILTER_SKIP are equivalent for text nodes
          // (no children to skip). See processDocument() for full explanation.
          if (!shouldProcessNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      processNode(walker.currentNode);
    }
  }
}

// -----------------------------------------------------------------------------
// DYNAMIC CONTENT OBSERVER (MutationObserver)
//
// Modern websites constantly add new content: infinite scroll, live feeds,
// "Load More" buttons, AJAX updates, etc. This observer watches for those
// changes and processes ONLY the newly-added nodes.
//
// PERFORMANCE: This is 10-100x faster than re-scanning the entire page!
// When Twitter adds 10 new tweets, we process only those 10 elements,
// not the entire page with thousands of existing tweets.
//
// RACE CONDITION FIX:
// We start the observer IMMEDIATELY (before loading rules from storage).
// This ensures we don't miss any dynamic content that loads while we're
// fetching settings from the browser's storage API (which is asynchronous).
//
// The observer is safe to run early because processElement() has built-in
// guards that skip processing when regexes aren't ready yet (they're null).
// -----------------------------------------------------------------------------

const observer = new MutationObserver((mutations) => {
  if (!extensionEnabled) return;

  for (const mutation of mutations) {
    // Only care about added nodes (ignore attribute or text changes to
    // existing nodes — those are typically caused by other scripts or
    // by our own replacements, and re-processing them would be wasteful).
    if (mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        processElement(node);
      }
    }
  }
});

// Start watching immediately — even before rules load from storage.
// childList: watch for nodes being added/removed
// subtree: watch the entire DOM tree, not just direct children of <body>
// NOTE: characterData is intentionally NOT observed. If we watched text
// content changes, our own replacement (writing to node.nodeValue) would
// trigger another mutation, creating an infinite loop. Frameworks that
// update text bindings (React, Vue, etc.) typically replace the entire
// text node (a childList change), not just its content, so this is not
// a significant limitation in practice.
if (document.body) {
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    Logger.error('Failed to start MutationObserver:', e);
  }
} else {
  // document.body is not yet available. This can happen on about:blank frames
  // or if the content script loads before the parser creates <body>.
  const startObserver = () => {
    if (document.body) {
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        Logger.error('Failed to start MutationObserver:', e);
      }
    } else {
      Logger.warn('document.body still not available — observer not started.');
    }
  };
  // If the document is still loading, wait for DOMContentLoaded.
  // If it has already finished loading (e.g., bfcache restoration),
  // start the observer immediately since DOMContentLoaded won't fire again.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
}

// KNOWN LIMITATIONS:
// - Shadow DOM: Text inside web components using Shadow DOM (open or closed)
//   is not processed. The TreeWalker and MutationObserver cannot reach into
//   shadow roots. Closed shadow roots are inaccessible by design; observing
//   open shadow roots would require recursive observer setup on every shadow
//   host, which is complex and has its own edge cases.
// - Iframes: The content script runs in the top-level frame only (the manifest
//   does not set "all_frames": true). Same-origin iframes get their own
//   content script injection by the browser, but cross-origin iframes are
//   isolated. This is intentional — modifying cross-origin iframe content
//   would require additional permissions and raises security concerns.

// -----------------------------------------------------------------------------
// INITIALIZATION
// Load replacement rules and process the initial page content.
// This runs asynchronously, but the MutationObserver above is already watching
// for dynamic content, so nothing is missed during the loading delay.
// -----------------------------------------------------------------------------
chrome.storage.sync.get(['wordMap', 'extensionEnabled'], (data) => {
  // Handle storage API errors gracefully (e.g., storage corruption, quota issues).
  if (chrome.runtime.lastError) {
    Logger.error('Failed to load settings:', chrome.runtime.lastError);
    return;
  }

  // Default to enabled if the setting hasn't been set yet (first install).
  extensionEnabled = data.extensionEnabled !== false;
  Logger.debug('Settings loaded. Extension enabled:', extensionEnabled);
  Logger.debug('Number of rules loaded:', data.wordMap ? Object.keys(data.wordMap).length : 0);

  // Build the regex patterns and process the initial page content.
  if (data.wordMap && extensionEnabled) {
    updateRegexes(data.wordMap);
    processDocument();
    Logger.debug('Initial document processing complete');
  }
});

// -----------------------------------------------------------------------------
// LIVE SETTINGS LISTENER
// Updates replacement behavior in real-time when you change settings in the
// management page. No need to reload the webpage — changes take effect
// immediately on all open tabs.
// -----------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  // Guard against the extension context being invalidated (e.g., after an
  // extension update or uninstall while the page is still open). Accessing
  // chrome APIs in this state throws "Extension context invalidated."
  if (chrome.runtime.id === undefined) return;

  if (area === 'sync') {
    // Track what actually changed so we only do the minimum work needed.
    let needsReprocess = false;

    // Check if the master switch was toggled.
    if (changes.extensionEnabled) {
      const wasEnabled = extensionEnabled;
      // Use !== false (not direct assignment) to match the initial load behavior
      // in the chrome.storage.sync.get callback above. This ensures that if the
      // key is deleted from storage (newValue would be undefined), we default to
      // enabled — consistent with how a fresh install behaves.
      extensionEnabled = changes.extensionEnabled.newValue !== false;

      // If we just turned ON (was off, now on), we need to process the page
      // to apply rules that were previously inactive.
      if (!wasEnabled && extensionEnabled) {
        // If regexes were never built (e.g., extension was toggled off before
        // the initial storage load completed), reload the wordMap from storage
        // before attempting to reprocess the page.
        if (!sensitiveRegex && !insensitiveRegex) {
          chrome.storage.sync.get('wordMap', (reloadData) => {
            if (chrome.runtime.lastError) {
              Logger.error('Failed to reload wordMap on enable:', chrome.runtime.lastError);
              return;
            }
            if (reloadData.wordMap) {
              updateRegexes(reloadData.wordMap);
            }
            processDocument();
          });
        } else {
          needsReprocess = true;
        }
      }

      // If turning OFF, cancel any pending debounced reprocess so it
      // doesn't fire after disable.
      if (wasEnabled && !extensionEnabled) {
        clearTimeout(reprocessTimeout);
        reprocessTimeout = null;
      }
    }

    // Check if the replacement rules themselves changed.
    if (changes.wordMap) {
      // Rebuild regex patterns from the new rules.
      updateRegexes(changes.wordMap.newValue || {});

      // Only re-scan the page if the extension is currently enabled.
      // Re-scanning when disabled would be wasted work.
      if (extensionEnabled) {
        needsReprocess = true;
      }
    }

    // Re-scan the document only if something meaningful changed.
    // This prevents unnecessary work (e.g., toggling a single rule off
    // doesn't require a full page re-scan).
    if (needsReprocess && extensionEnabled) {
      // Debounce re-scans to avoid jank on large pages when the user is
      // rapidly editing rules in the management page. Each keystroke that
      // triggers a storage change would otherwise cause a full DOM re-scan
      // on every open tab. The 200ms delay batches rapid changes together.
      clearTimeout(reprocessTimeout);
      reprocessTimeout = setTimeout(processDocument, 200);
    }
  }
});
