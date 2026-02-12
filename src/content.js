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

  // Sort by pattern length (longest first) to prevent partial matches.
  // For example, with rules for both "super" and "superman":
  //   - Without sorting: "superman" might match "super" first → "Xman"
  //   - With sorting: "superman" is checked first → correct replacement
  patterns.sort((a, b) => b.length - a.length);

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
  const sensitiveWords = [];
  const insensitiveWords = [];
  // Use Object.create(null) to prevent prototype pollution — see explanation
  // at the wordMapCache/wordMapCacheLower declarations above.
  const activeMap = Object.create(null);
  const activeLowerMap = Object.create(null);

  for (const [word, data] of Object.entries(wordMap)) {
    // Only include rules that are explicitly enabled.
    // Rules with enabled === undefined are treated as enabled (backwards compat).
    if (data.enabled !== false) {
      activeMap[word] = data;

      // Build a lowercase lookup map for case-insensitive rules.
      // This allows O(1) lookup during replacement instead of O(n) iteration.
      if (!data.caseSensitive) {
        activeLowerMap[word.toLowerCase()] = data;
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
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

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
  if (node.isContentEditable) return true;
  if (node.parentNode && node.parentNode.isContentEditable) return true;
  return false;
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
  if (!node.parentNode) return false;

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
 * @throws {Error} - Throws 'Regex timeout' if processing exceeds REGEX_TIMEOUT_MS.
 */
const replaceCallback = (match) => {
  // TIMEOUT SAFETY: Check if we've been processing too long.
  // This prevents the extension from hanging the browser on pathological
  // regex patterns or extremely large text blocks.
  // We only check every 50th match to minimize performance.now() overhead.
  matchCounter++;
  if (matchCounter % 50 === 0 && performance.now() - nodeProcessingStartTime > REGEX_TIMEOUT_MS) {
    throw new Error('Regex timeout'); // Caught by processNode's try/catch
  }

  // Step 1: Try exact match (handles case-sensitive rules).
  // This is the fastest path — direct hash map lookup, O(1).
  if (wordMapCache[match]) return wordMapCache[match].replacement;

  // Step 2: Try case-insensitive match using our pre-built lowercase map.
  // This is also O(1) — we lowercase the match and look it up directly.
  // OLD APPROACH: Looped through ALL keys comparing case-insensitively — O(n)!
  // NEW APPROACH: Direct hash lookup — O(1), instant regardless of rule count.
  const lowerMatch = match.toLowerCase();
  if (wordMapCacheLower[lowerMatch]) {
    return wordMapCacheLower[lowerMatch].replacement;
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
  if (!shouldProcessNode(node)) return;

  let text = node.nodeValue;
  let changed = false;

  // Start the timeout timer for this node.
  // If regex processing takes longer than REGEX_TIMEOUT_MS, replaceCallback
  // will throw an error that we catch below.
  nodeProcessingStartTime = performance.now();
  matchCounter = 0;

  try {
    // Apply case-sensitive replacements first.
    // Order matters: if a word appears in both sensitive and insensitive rules,
    // the sensitive rule takes priority.
    if (sensitiveRegex) {
      const newText = text.replace(sensitiveRegex, replaceCallback);
      if (newText !== text) {
        text = newText;
        changed = true;
      }
    }

    // Apply case-insensitive replacements second.
    if (insensitiveRegex) {
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
      node.nodeValue = text;
    }
  } catch (error) {
    if (error.message === 'Regex timeout') {
      // Timeout occurred — silently skip this node and continue processing.
      // This is better than hanging the entire browser! The user won't notice
      // because only this one text block is skipped.
      Logger.warn('Regex timeout on node (skipping):', node.nodeValue?.substring(0, 50));
      return;
    }
    // Re-throw unexpected errors so they appear in the console for debugging.
    throw error;
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
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}

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
  if (area === 'sync') {
    // Track what actually changed so we only do the minimum work needed.
    let needsReprocess = false;

    // Check if the master switch was toggled.
    if (changes.extensionEnabled) {
      const wasEnabled = extensionEnabled;
      // Use !== false (not direct assignment) to match the initial load behavior
      // at line 538. This ensures that if the key is deleted from storage
      // (newValue would be undefined), we default to enabled — consistent with
      // how a fresh install behaves (no key = enabled by default).
      extensionEnabled = changes.extensionEnabled.newValue !== false;

      // If we just turned ON (was off, now on), we need to process the page
      // to apply rules that were previously inactive.
      if (!wasEnabled && extensionEnabled) {
        needsReprocess = true;
      }
      // If turning OFF, no action needed — processNode checks the flag.
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
      processDocument();
    }
  }
});
