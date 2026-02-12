// manage.js
// -----------------------------------------------------------------------------
// MANAGEMENT PAGE UI SCRIPT
// This script handles the "Manage Replacements" page. It allows users to:
//   - Add, edit, and remove replacement rules
//   - Toggle rules on/off individually or globally
//   - Export rules to a JSON backup file
//   - Import rules from a JSON backup file
//   - Search/filter rules in real-time
//
// All data is saved to chrome.storage.sync, which syncs across your
// signed-in browser devices.
//
// PRIVACY NOTICE:
// - This script does NOT send any data to external servers.
// - All data stays 100% local (or synced via your browser account).
// - There is no analytics, telemetry, or tracking of any kind.
// - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// BROWSER STORAGE LIMITS
// These limits are enforced by the browser itself, not by this extension.
// - SYNC_QUOTA_BYTES: Maximum total storage (100 KB for all rules combined)
// - QUOTA_BYTES_PER_ITEM: Maximum size for a single storage item (8 KB)
// We proactively check these limits before every save operation to give you
// helpful error messages instead of cryptic browser errors.
// -----------------------------------------------------------------------------
const SYNC_QUOTA_BYTES = chrome.storage.sync.QUOTA_BYTES || 102400; // 100 KB
const QUOTA_BYTES_PER_ITEM = chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192; // 8 KB

// -----------------------------------------------------------------------------
// SAFETY LIMITS
// These limits protect against performance issues and potential ReDoS
// (Regular Expression Denial of Service) attacks.
// - MAX_RULES: Prevents creating so many rules that the browser hangs during
//   regex compilation or page processing.
// - MAX_PATTERN_LENGTH: Prevents extremely long patterns that could cause
//   the regex engine to backtrack excessively.
// These are generous limits that 99% of users will never hit.
// -----------------------------------------------------------------------------
// Hard ceiling on rule count. In practice, the browser's 8 KB per-item
// sync storage limit (~130 rules at typical lengths) is hit well before this.
// This constant exists as a secondary safety net for regex performance.
const MAX_RULES = 255;
const MAX_PATTERN_LENGTH = 255; // Maximum characters per original or replacement text

// Maximum import file size (in bytes). This prevents the browser from freezing
// if a user accidentally selects a very large file. The FileReader API will
// attempt to read the entire file into memory at once, so we check the size
// upfront. 1 MB is far more than enough — even at maximum capacity the rules
// JSON would be well under 100 KB. This is a client-side safety measure.
const MAX_IMPORT_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

// -----------------------------------------------------------------------------
// UI CONSTANTS
// These control the behavior of user interface elements.
// -----------------------------------------------------------------------------
const STATUS_DISPLAY_DURATION_MS = 3000; // How long status messages stay visible (3 seconds)

// -----------------------------------------------------------------------------
// LOGGING UTILITY
// Simple logging system for consistent error reporting and debugging.
// Set ENABLE_DEBUG_LOGGING to true for detailed console output.
// -----------------------------------------------------------------------------
const ENABLE_DEBUG_LOGGING = false; // Toggle for debug logs

// NOTE: This Logger is intentionally duplicated in background.js, content.js, and manage.js.
// See the comment in content.js for the full explanation. In short: MV3 content scripts,
// service workers, and extension pages run in isolated contexts with no shared module system
// that works across all supported browsers. This is NOT a code smell — it's a requirement.
const Logger = {
    info: (message, ...args) => console.log(`[Text Replacement] ${message}`, ...args),
    debug: (message, ...args) => ENABLE_DEBUG_LOGGING && console.log(`[Text Replacement DEBUG] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[Text Replacement WARNING] ${message}`, ...args),
    error: (message, ...args) => console.error(`[Text Replacement ERROR] ${message}`, ...args)
};

// -----------------------------------------------------------------------------
// STATUS MESSAGE TIMER
// Tracks the active setTimeout for status messages so that rapid successive
// calls to showStatus() don't cause a stale timer to clear a newer message.
// -----------------------------------------------------------------------------
let statusTimeout = null;

// -----------------------------------------------------------------------------
// STORAGE QUOTA UTILITIES
// These functions estimate storage usage and validate against browser limits
// before attempting to save. This prevents cryptic "QUOTA_EXCEEDED" errors.
// -----------------------------------------------------------------------------

/**
 * Estimates the storage size (in bytes) of the wordMap object.
 * The browser stores data as JSON internally, so we measure the JSON
 * representation. We use Blob for an accurate byte count that handles
 * multi-byte Unicode characters correctly.
 *
 * @param {Object} wordMap - The replacement rules object.
 * @returns {number} - Estimated size in bytes.
 */
function estimateStorageSize(wordMap) {
    const jsonString = JSON.stringify({ wordMap });
    return new Blob([jsonString]).size;
}

/**
 * Checks if saving the given wordMap would exceed the browser's storage limits.
 * Returns a user-friendly error message if limits would be exceeded, or null if OK.
 *
 * @param {Object} wordMap - The proposed wordMap to validate.
 * @returns {string|null} - Error message or null if within limits.
 */
function validateStorageQuota(wordMap) {
    const estimatedSize = estimateStorageSize(wordMap);

    // Check per-item limit FIRST — this is the binding constraint.
    // All rules are stored under a single "wordMap" key, and the browser
    // limits each storage key to QUOTA_BYTES_PER_ITEM (8 KB for sync storage).
    // This means the combined size of ALL rules must fit within 8 KB, which
    // is hit much sooner than the 100 KB total quota. A typical rule uses
    // ~60 bytes, so the practical limit is roughly 100-130 rules depending
    // on how long your original text and replacement text are.
    if (estimatedSize > QUOTA_BYTES_PER_ITEM) {
        const usedKB = (estimatedSize / 1024).toFixed(1);
        const maxKB = (QUOTA_BYTES_PER_ITEM / 1024).toFixed(0);
        return `Storage full! Your rules total ${usedKB} KB, exceeding the browser's ${maxKB} KB per-item sync limit. Please remove some rules or shorten existing ones.`;
    }

    // Check total storage limit (less likely to hit before per-item, but
    // included as a safety net in case the extension stores additional keys
    // in the future).
    if (estimatedSize > SYNC_QUOTA_BYTES) {
        const usedKB = (estimatedSize / 1024).toFixed(1);
        const maxKB = (SYNC_QUOTA_BYTES / 1024).toFixed(0);
        return `Storage full! You're using ${usedKB} KB of the browser's ${maxKB} KB total limit. Please remove some rules to free up space.`;
    }

    return null; // Within limits
}

// -----------------------------------------------------------------------------
// IMPORT VALIDATION
// Validates that imported rules have the correct structure and safe values.
// This prevents malformed or malicious import files from corrupting data.
// -----------------------------------------------------------------------------

/**
 * Validates the structure and values of imported rules, and strips unknown fields.
 * Checks that each rule has the expected fields with correct types,
 * and that patterns don't exceed safety limits.
 *
 * SANITIZATION: After validation, each rule is reduced to only the known
 * fields (replacement, caseSensitive, enabled). Any extra properties from
 * the import file (e.g., "notes", "author", "timestamp") are stripped.
 * This prevents storage bloat — unknown fields would accumulate across
 * import/export cycles, eating into the 8 KB per-item quota.
 *
 * @param {Object} rules - The rules object from an import file. MUTATED in place.
 * @returns {string|null} - Error message if invalid, null if all rules are valid.
 */
function validateImportedRules(rules) {
    for (const [key, value] of Object.entries(rules)) {
        // Validate original text (key) length
        if (key.length > MAX_PATTERN_LENGTH) {
            return `Rule "${key.substring(0, 30)}..." exceeds the maximum pattern length of ${MAX_PATTERN_LENGTH} characters.`;
        }

        // Validate that the rule value is an object (not a string, number, etc.)
        if (!value || typeof value !== 'object') {
            return `Invalid rule format for "${key}". Expected an object with a "replacement" property.`;
        }

        // Validate that replacement is a string
        if (typeof value.replacement !== 'string') {
            return `Invalid replacement value for "${key}". Expected a text string, got ${typeof value.replacement}.`;
        }

        // Validate replacement length
        if (value.replacement.length > MAX_PATTERN_LENGTH) {
            return `Replacement for "${key.substring(0, 30)}..." exceeds the maximum length of ${MAX_PATTERN_LENGTH} characters.`;
        }

        // Sanitize boolean fields — coerce non-boolean values to proper booleans.
        // This prevents unexpected behavior from malformed import files.
        if (value.caseSensitive !== undefined && typeof value.caseSensitive !== 'boolean') {
            value.caseSensitive = Boolean(value.caseSensitive);
        }
        if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
            value.enabled = Boolean(value.enabled);
        }

        // Strip unknown fields — only keep the three known properties.
        // This prevents storage bloat from extra fields in import files
        // (e.g., editor metadata, user notes, timestamps from other tools).
        rules[key] = {
            replacement: value.replacement,
            caseSensitive: value.caseSensitive ?? false,
            enabled: value.enabled ?? true
        };
    }

    return null; // All rules are valid
}

// -----------------------------------------------------------------------------
// PAGE INITIALIZATION
// Sets up event listeners and loads data when the management page opens.
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings and rules when the page starts
    loadSettings();
    loadWordMap();

    // Listen for storage changes from other tabs or windows.
    // If the user has two management tabs open, changes in one tab
    // will automatically refresh the other tab's UI.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;

        if (changes.wordMap) {
            Logger.debug('Rules changed externally — refreshing UI');
            loadWordMap();
        }

        // Keep the master switch checkbox in sync when toggled from another
        // tab or by the content script. Without this, the manage page could
        // show "Enabled" when the extension is actually disabled (or vice versa).
        if (changes.extensionEnabled) {
            const isEnabled = changes.extensionEnabled.newValue !== false;
            document.getElementById('masterSwitch').checked = isEnabled;
            Logger.debug('Master switch updated externally:', isEnabled);
        }
    });

    // Listen for the "Add Rule" form submission
    document.getElementById('addReplacementForm').addEventListener('submit', (event) => {
        event.preventDefault(); // Stop the page from reloading
        addReplacement();
    });

    // Listen for the Master Switch toggle
    document.getElementById('masterSwitch').addEventListener('change', (e) => {
        updateMasterSwitch(e.target.checked);
    });

    // Listen for Export button click
    document.getElementById('exportBtn').addEventListener('click', () => {
        exportRules();
    });

    // Listen for Import button click (triggers the hidden file input)
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    // Listen for file selection (after user picks a file in the dialog)
    document.getElementById('importFile').addEventListener('change', (e) => {
        importRules(e.target.files[0]);
    });

    // Listen for search box input with debounced filtering.
    // "Debouncing" means we wait until the user stops typing for 150ms
    // before actually filtering the list. Without this, the extension would
    // re-filter the entire table on every single keystroke, which could make
    // the interface feel sluggish when there are many rules.
    let searchTimeout;
    document.getElementById('searchBox').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filterRules(e.target.value);
        }, 150);
    });
});

// -----------------------------------------------------------------------------
// SETTINGS MANAGEMENT
// Loads and saves the global on/off state of the extension.
// -----------------------------------------------------------------------------

/**
 * Loads the global on/off state from storage and updates the UI toggle.
 */
function loadSettings() {
    chrome.storage.sync.get('extensionEnabled', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to load settings:', chrome.runtime.lastError);
            showStatus('Failed to load settings. Please refresh the page.', true);
            return;
        }

        // Default to TRUE if the setting doesn't exist yet (first install)
        const isEnabled = data.extensionEnabled !== false;
        document.getElementById('masterSwitch').checked = isEnabled;
    });
}

/**
 * Saves the global on/off state to storage.
 *
 * @param {boolean} isEnabled - Whether the extension should be active.
 */
function updateMasterSwitch(isEnabled) {
    chrome.storage.sync.set({ extensionEnabled: isEnabled }, () => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to save master switch setting:', chrome.runtime.lastError);
            showStatus('Failed to save setting.', true);
        } else {
            showStatus(isEnabled ? 'Extension Enabled' : 'Extension Disabled');
            Logger.debug('Master switch updated:', isEnabled);
        }
    });
}

// -----------------------------------------------------------------------------
// RULES TABLE (UI)
// Functions that build and manage the rules table in the UI.
// -----------------------------------------------------------------------------

/**
 * Loads all replacement rules from storage and rebuilds the UI table.
 *
 * PERFORMANCE: Instead of adding each table row to the page one by one
 * (which would cause the browser to re-draw the screen N times), we build
 * all rows in an invisible "staging area" called a DocumentFragment, then
 * add them all at once. This means the browser only re-draws once — much
 * faster and smoother, especially with many rules.
 */
function loadWordMap() {
    chrome.storage.sync.get('wordMap', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to load word map:', chrome.runtime.lastError);
            showStatus('Failed to load rules. Please refresh the page.', true);
            return;
        }

        const wordMap = data.wordMap || {};
        const replacementList = document.getElementById('replacementList');

        // Clear existing table rows safely.
        // We remove children one by one instead of using innerHTML = '' because
        // innerHTML can execute embedded scripts if data were ever compromised.
        // This is a defense-in-depth measure consistent with our CSP policy.
        while (replacementList.firstChild) {
            replacementList.removeChild(replacementList.firstChild);
        }

        // Build all rows in a DocumentFragment (off-screen), then append once.
        // This is faster than appending each row individually because the browser
        // only needs to recalculate layout once instead of N times.
        const fragment = document.createDocumentFragment();

        Object.keys(wordMap).forEach(originalText => {
            const ruleData = wordMap[originalText];
            // Handle older data formats that may not have the 'enabled' property
            const enabled = ruleData.enabled !== false;
            addRowToTable(originalText, ruleData.replacement, ruleData.caseSensitive, enabled, fragment);
        });

        replacementList.appendChild(fragment);

        // Preserve the active search filter after rebuilding the table.
        // Without this, removing or renaming a rule (which triggers a rebuild)
        // would clear the user's search results, forcing them to re-type their
        // search query. We re-apply the filter so the UI feels seamless.
        const searchBox = document.getElementById('searchBox');
        if (searchBox && searchBox.value.trim()) {
            filterRules(searchBox.value);
        }
    });
}

/**
 * Creates a toggle switch UI element (custom checkbox).
 *
 * @param {boolean} checked - Initial checked state.
 * @param {Function} changeCallback - Called with (boolean) when toggled.
 * @param {string} ariaLabel - Accessibility label for screen readers.
 * @returns {HTMLLabelElement} - The toggle switch element.
 */
function createToggle(checked, changeCallback, ariaLabel = '') {
    const label = document.createElement('label');
    label.className = 'toggle-switch';
    if (ariaLabel) {
        label.setAttribute('aria-label', ariaLabel);
    }

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    if (ariaLabel) {
        input.setAttribute('aria-label', ariaLabel);
    }
    input.addEventListener('change', (e) => changeCallback(e.target.checked));

    const slider = document.createElement('span');
    slider.className = 'slider';
    slider.setAttribute('aria-hidden', 'true'); // Decorative — hide from screen readers

    label.appendChild(input);
    label.appendChild(slider);
    return label;
}

/**
 * Creates a single table row for a replacement rule and appends it to the
 * specified container (usually a DocumentFragment or the table body).
 *
 * Each row contains:
 * - Editable original text input
 * - Editable replacement text input
 * - Case-sensitive toggle
 * - Enabled/disabled toggle
 * - Remove button
 *
 * All elements are created programmatically using document.createElement
 * (never innerHTML) to prevent XSS and maintain CSP compliance.
 *
 * @param {string} originalText - The text to find.
 * @param {string} replacement - The text to replace it with.
 * @param {boolean} caseSensitive - Whether matching is case-sensitive.
 * @param {boolean} enabled - Whether this rule is active.
 * @param {DocumentFragment|HTMLElement} [container] - Where to append the row.
 */
function addRowToTable(originalText, replacement, caseSensitive, enabled, container) {
    const target = container || document.getElementById('replacementList');
    const row = document.createElement('tr');

    // Create table cells
    const originalTextCell = document.createElement('td');
    const replacementTextCell = document.createElement('td');
    const caseSensitiveCell = document.createElement('td');
    const enabledCell = document.createElement('td');
    const removeCell = document.createElement('td');

    // 1. Original Text Input (editable)
    const originalTextInput = document.createElement('input');
    originalTextInput.type = 'text';
    originalTextInput.value = originalText;
    originalTextInput.setAttribute('aria-label', `Original text: ${originalText}`);
    originalTextInput.addEventListener('change', () =>
        updateReplacement(originalText, 'originalText', originalTextInput.value)
    );

    // 2. Replacement Text Input (editable)
    const replacementTextInput = document.createElement('input');
    replacementTextInput.type = 'text';
    replacementTextInput.value = replacement;
    replacementTextInput.setAttribute('aria-label', `Replacement text for "${originalText}": ${replacement}`);
    replacementTextInput.addEventListener('change', () =>
        updateReplacement(originalText, 'replacement', replacementTextInput.value)
    );

    // 3. Match Case Toggle
    const caseToggle = createToggle(
        caseSensitive,
        (checked) => updateReplacement(originalText, 'caseSensitive', checked),
        `Case-sensitive matching for "${originalText}"`
    );

    // 4. Enabled/Disabled Toggle
    const enabledToggle = createToggle(
        enabled,
        (checked) => {
            updateReplacement(originalText, 'enabled', checked);
            // Visual feedback: fade out disabled rows so users can see at a glance
            row.style.opacity = checked ? '1' : '0.5';
        },
        `Enable or disable rule for "${originalText}"`
    );

    // Set initial visual state for disabled rules
    row.style.opacity = enabled ? '1' : '0.5';

    // 5. Remove Button
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.className = 'btn-remove';
    removeButton.setAttribute('aria-label', `Remove replacement rule for "${originalText}"`);
    removeButton.addEventListener('click', () => removeReplacement(originalText));

    // Assemble the row using appendChild (safe DOM manipulation, CSP-compliant)
    originalTextCell.appendChild(originalTextInput);
    replacementTextCell.appendChild(replacementTextInput);

    caseSensitiveCell.className = 'text-center';
    caseSensitiveCell.appendChild(caseToggle);

    enabledCell.className = 'text-center';
    enabledCell.appendChild(enabledToggle);

    removeCell.className = 'text-right';
    removeCell.appendChild(removeButton);

    row.appendChild(originalTextCell);
    row.appendChild(replacementTextCell);
    row.appendChild(caseSensitiveCell);
    row.appendChild(enabledCell);
    row.appendChild(removeCell);

    target.appendChild(row);
}

// -----------------------------------------------------------------------------
// RULE CRUD OPERATIONS
// Create, Read, Update, Delete operations for replacement rules.
// All operations read fresh data from storage before writing to prevent
// race conditions between multiple tabs or rapid successive edits.
// -----------------------------------------------------------------------------

/**
 * Updates a specific field of an existing rule in storage.
 * Handles renaming (changing the original text key), toggling settings,
 * and editing replacement text.
 *
 * SAFETY FEATURES:
 * - Validates empty text, pattern length, and duplicate keys.
 * - Prevents case-only renames (e.g., "cat" → "Cat") which would be
 *   confusing with case-insensitive matching rules.
 * - Validates storage quota before saving.
 * - Reverts the UI to the previous valid state on any error.
 * - Reads fresh data from storage before writing to prevent race conditions.
 *
 * @param {string} originalText - The current key of the rule being edited.
 * @param {string} field - Which field to update: 'originalText', 'replacement',
 *                         'caseSensitive', or 'enabled'.
 * @param {*} newValue - The new value for the field.
 */
function updateReplacement(originalText, field, newValue) {
    // VALIDATION: Prevent empty original text (would match nothing — user error)
    // Note: We intentionally allow empty replacement text — that's a valid use
    // case for deleting/removing the original text entirely from pages.
    // We also trim whitespace from original text to prevent invisible-difference
    // rules like " cat " vs "cat". We do NOT trim replacement text.
    if (field === 'originalText' && typeof newValue === 'string') {
        newValue = newValue.trim();
        if (!newValue) {
            showStatus('Original text cannot be empty!', true);
            loadWordMap(); // Reset UI to previous valid state
            return;
        }
    }

    // SAFETY: Validate pattern length when editing text fields.
    // Extremely long patterns can cause the regex engine to hang.
    if ((field === 'originalText' || field === 'replacement') && typeof newValue === 'string') {
        if (newValue.length > MAX_PATTERN_LENGTH) {
            showStatus(`Text too long! Maximum ${MAX_PATTERN_LENGTH} characters allowed.`, true);
            loadWordMap(); // Reset UI to previous valid state
            return;
        }
    }

    // Read fresh data from storage to prevent race conditions.
    // If two tabs edit simultaneously, we always work with the latest data.
    chrome.storage.sync.get('wordMap', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to get word map for update:', chrome.runtime.lastError);
            showStatus('Failed to load data. Changes not saved.', true);
            loadWordMap();
            return;
        }

        const wordMap = data.wordMap || {};
        if (!wordMap[originalText]) return; // Rule was deleted in another tab

        const originalData = wordMap[originalText];

        // Special handling for renaming the original text (changing the key)
        if (field === 'originalText') {
            if (!newValue) {
                loadWordMap();
                showStatus('Original text cannot be empty.', true);
                return;
            }

            // Prevent overwriting a different existing rule
            if (wordMap[newValue] && newValue !== originalText) {
                loadWordMap();
                showStatus('A rule with this original text already exists.', true);
                return;
            }

            // EDGE CASE: Prevent renames that only differ in case (e.g., "cat" → "Cat").
            // With case-insensitive matching, "cat" and "Cat" are functionally identical,
            // so a case-only rename would be confusing and appear to do nothing.
            if (newValue.toLowerCase() !== originalText.toLowerCase()) {
                // Real rename (different word entirely) — proceed normally
                delete wordMap[originalText];
                wordMap[newValue] = originalData;
            } else if (newValue === originalText) {
                // Exact same value — user likely just unfocused the field, no change needed
                return;
            } else {
                // Case-only change detected (e.g., "cat" → "Cat" or "cat" → "CAT")
                loadWordMap();
                showStatus('Cannot rename to only differ in case (e.g., "cat" to "Cat"). Create a new rule instead.', true);
                return;
            }
        } else {
            // Normal field update (replacement text, caseSensitive, enabled)
            wordMap[originalText][field] = newValue;
        }

        // Validate storage quota BEFORE attempting to save.
        // This prevents exceeding browser limits and gives clear feedback.
        const quotaError = validateStorageQuota(wordMap);
        if (quotaError) {
            showStatus(quotaError, true);
            loadWordMap(); // Revert UI to previous valid state
            return;
        }

        // Save to storage
        chrome.storage.sync.set({ wordMap }, () => {
            if (chrome.runtime.lastError) {
                Logger.error('Failed to save replacement update:', chrome.runtime.lastError);
                showStatus('Failed to save changes.', true);
                loadWordMap(); // Revert on failure
            } else {
                Logger.debug('Word map updated successfully');

                // After renaming, we MUST rebuild the entire table. Every event
                // listener on this row (replacement input, case toggle, enabled
                // toggle, remove button) has a closure over the OLD originalText
                // key. Without a rebuild, those controls would silently fail
                // because they'd try to update a key that no longer exists in
                // storage. This is the only safe way to refresh all closures.
                if (field === 'originalText') {
                    loadWordMap();
                    showStatus('Saved.');
                    return;
                }

                // Show "Saved" toast only for text edits, not for toggle changes
                // (toggles give instant visual feedback via the switch itself)
                if (field === 'replacement') {
                    showStatus('Saved.');
                }
            }
        });
    });
}

/**
 * Adds a brand new replacement rule.
 *
 * VALIDATION:
 * - Original text must not be empty (would match nothing).
 * - Both fields must be within MAX_PATTERN_LENGTH.
 * - Total rules must not exceed MAX_RULES.
 * - Must not duplicate an existing rule.
 * - Must not exceed storage quota.
 *
 * NOTE: Empty replacement text IS allowed — it's a valid use case for
 * deleting/removing the original text from pages entirely.
 */
function addReplacement() {
    // Trim whitespace from original text to prevent invisible-difference
    // rules like " cat " vs "cat" that would confuse users. We intentionally
    // do NOT trim replacement text — the user may want leading/trailing spaces.
    const newOriginal = document.getElementById('newOriginal').value.trim();
    const newReplacement = document.getElementById('newReplacement').value;
    const newCaseSensitive = document.getElementById('newCaseSensitive').checked;

    // Validate that original text is not empty or whitespace-only
    if (!newOriginal) {
        showStatus('Original text cannot be empty!', true);
        return;
    }

    // Validate pattern lengths to prevent performance issues
    if (newOriginal.length > MAX_PATTERN_LENGTH) {
        showStatus(`Original text too long! Maximum ${MAX_PATTERN_LENGTH} characters allowed.`, true);
        return;
    }

    if (newReplacement.length > MAX_PATTERN_LENGTH) {
        showStatus(`Replacement text too long! Maximum ${MAX_PATTERN_LENGTH} characters allowed.`, true);
        return;
    }

    // Read fresh data from storage to prevent race conditions
    chrome.storage.sync.get('wordMap', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to get word map for adding rule:', chrome.runtime.lastError);
            showStatus('Failed to load data. Rule not added.', true);
            return;
        }

        const wordMap = data.wordMap || {};

        // Check rule count limit
        if (Object.keys(wordMap).length >= MAX_RULES) {
            showStatus(`Maximum ${MAX_RULES} rules allowed. Please remove some rules before adding more.`, true);
            return;
        }

        // Prevent duplicate rules (exact match)
        if (wordMap[newOriginal]) {
            showStatus('Rule already exists for this word.', true);
            return;
        }

        // Prevent case-insensitive collisions.
        // If the new rule is case-insensitive, check whether an existing
        // case-insensitive rule matches the same text (ignoring case).
        // For example, adding "cat" (case-insensitive) when "Cat" (case-insensitive)
        // already exists would create two rules that silently collide in the
        // replacement engine — only one would actually work, and the other
        // would be ignored with no warning. This check prevents that confusion.
        if (!newCaseSensitive) {
            const newLower = newOriginal.toLowerCase();
            for (const [key, data] of Object.entries(wordMap)) {
                if (!data.caseSensitive && key.toLowerCase() === newLower) {
                    showStatus(`A case-insensitive rule for "${key}" already exists. Change it to case-sensitive or use the existing rule.`, true);
                    return;
                }
            }
        }

        // Add the new rule
        wordMap[newOriginal] = {
            replacement: newReplacement,
            caseSensitive: newCaseSensitive,
            enabled: true
        };

        // Validate storage quota before saving
        const quotaError = validateStorageQuota(wordMap);
        if (quotaError) {
            showStatus(quotaError, true);
            return;
        }

        // Save to storage
        chrome.storage.sync.set({ wordMap }, () => {
            if (chrome.runtime.lastError) {
                Logger.error('Failed to add new replacement:', chrome.runtime.lastError);
                showStatus('Failed to add replacement. Storage full?', true);
            } else {
                Logger.debug('New replacement added:', newOriginal, '\u2192', newReplacement);

                // Update UI instantly without a full table reload
                addRowToTable(newOriginal, newReplacement, newCaseSensitive, true);

                // If a search filter is active, re-apply it so the new row
                // is hidden if it doesn't match the current search query.
                const searchBox = document.getElementById('searchBox');
                if (searchBox && searchBox.value.trim()) {
                    filterRules(searchBox.value);
                }

                // Clear input fields so the user can add the next rule immediately
                document.getElementById('newOriginal').value = '';
                document.getElementById('newReplacement').value = '';
                document.getElementById('newCaseSensitive').checked = false;

                showStatus('Replacement added.');
            }
        });
    });
}

/**
 * Removes a replacement rule permanently.
 *
 * @param {string} originalText - The key of the rule to remove.
 */
function removeReplacement(originalText) {
    // Read fresh data from storage to prevent race conditions
    chrome.storage.sync.get('wordMap', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to get word map for removal:', chrome.runtime.lastError);
            showStatus('Failed to load data. Rule not removed.', true);
            return;
        }

        const wordMap = data.wordMap || {};
        delete wordMap[originalText];

        chrome.storage.sync.set({ wordMap }, () => {
            if (chrome.runtime.lastError) {
                Logger.error('Failed to save after removal:', chrome.runtime.lastError);
                showStatus('Failed to remove replacement.', true);
                loadWordMap(); // Revert to previous state
            } else {
                Logger.debug('Replacement removed:', originalText);
                loadWordMap(); // Reload table to reflect removal
                showStatus('Replacement removed.');
            }
        });
    });
}

// -----------------------------------------------------------------------------
// STATUS MESSAGES
// Provides temporary visual feedback after user actions.
// -----------------------------------------------------------------------------

/**
 * Displays a temporary status message to the user.
 * The message automatically disappears after STATUS_DISPLAY_DURATION_MS.
 *
 * Includes a stacking fix: if a new message arrives before the previous one
 * has faded, the old timer is cancelled so it doesn't prematurely clear
 * the new message.
 *
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - True for error (red), false for success (green).
 */
function showStatus(message, isError = false) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        // Cancel any pending clear timer from a previous message
        if (statusTimeout) {
            clearTimeout(statusTimeout);
        }

        // Prefix error messages with "Error: " so screen readers and users with
        // color vision deficiency can distinguish errors from success messages
        // without relying on color alone (WCAG 1.4.1 — Use of Color).
        statusEl.textContent = isError ? `Error: ${message}` : message;
        statusEl.style.color = isError ? '#ff1744' : '#00e676';
        // Match the text-shadow glow to the message type. The CSS default is
        // green, which looks wrong when the text is red. This keeps the glow
        // consistent with the text color for visual coherence.
        statusEl.style.textShadow = isError
            ? '0 0 10px rgba(255, 23, 68, 0.3)'
            : '0 0 10px rgba(0, 230, 118, 0.3)';

        // Auto-clear after the configured duration
        statusTimeout = setTimeout(() => {
            statusEl.textContent = '';
            statusTimeout = null;
        }, STATUS_DISPLAY_DURATION_MS);
    }
}

// -----------------------------------------------------------------------------
// EXPORT / IMPORT FUNCTIONALITY
// Allows users to backup their rules to a JSON file and restore them later.
// Useful for transferring rules between browsers or creating backups.
// -----------------------------------------------------------------------------

/**
 * Exports all replacement rules to a downloadable JSON file.
 * The file includes metadata (version, timestamp, rule count) for future
 * compatibility and user reference.
 */
function exportRules() {
    chrome.storage.sync.get('wordMap', (data) => {
        if (chrome.runtime.lastError) {
            Logger.error('Failed to get word map for export:', chrome.runtime.lastError);
            showStatus('Failed to load rules for export.', true);
            return;
        }

        const wordMap = data.wordMap || {};

        // Check if there are any rules to export
        if (Object.keys(wordMap).length === 0) {
            showStatus('No rules to export!', true);
            return;
        }

        // Create export object with metadata for version compatibility
        const exportData = {
            version: '2.1',
            exportedAt: new Date().toISOString(),
            rulesCount: Object.keys(wordMap).length,
            rules: wordMap
        };

        // Pretty-print JSON so users can read the file if they open it
        const jsonString = JSON.stringify(exportData, null, 2);

        // Create a Blob (in-memory file) and trigger a download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Generate a descriptive filename with the current date
        const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        a.download = `text-replacement-rules-${dateStr}.json`;

        // Trigger the download programmatically
        document.body.appendChild(a);
        a.click();

        // Clean up the temporary link and revoke the blob URL to free memory
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Logger.debug('Rules exported successfully:', Object.keys(wordMap).length, 'rules');
        showStatus(`Exported ${Object.keys(wordMap).length} rules successfully!`);
    });
}

/**
 * Imports replacement rules from a JSON file.
 * Users can choose to REPLACE all existing rules or MERGE with them.
 *
 * VALIDATION:
 * - File must be a .json file.
 * - JSON must contain a valid "rules" object.
 * - Each rule is validated for correct types and safe lengths.
 * - Total rule count must not exceed MAX_RULES.
 * - Total storage must not exceed browser quota.
 *
 * @param {File} file - The JSON file selected by the user.
 */
function importRules(file) {
    if (!file) {
        Logger.warn('Import attempted with no file selected');
        return;
    }

    // Basic file type check (defense-in-depth; the file input also has accept=".json")
    if (!file.name.endsWith('.json')) {
        showStatus('Please select a valid JSON file!', true);
        return;
    }

    // Guard against extremely large files that could freeze the browser.
    // The FileReader API will attempt to read the entire file into memory,
    // so we check the size upfront. See MAX_IMPORT_FILE_SIZE for the limit.
    if (file.size > MAX_IMPORT_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showStatus(`File too large (${sizeMB} MB)! Maximum import file size is 1 MB.`, true);
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const importData = JSON.parse(e.target.result);

            // Validate top-level structure.
            // Note: We check Array.isArray separately because typeof [] === 'object'
            // in JavaScript. An array would pass the typeof check but produce
            // nonsensical rules when iterated with Object.entries (keys would be
            // "0", "1", "2", etc. instead of the actual text to replace).
            if (!importData.rules || typeof importData.rules !== 'object' || Array.isArray(importData.rules)) {
                showStatus('Invalid file format! Please select a valid export file.', true);
                Logger.error('Invalid import file structure:', importData);
                return;
            }

            const importedRules = importData.rules;
            const importCount = Object.keys(importedRules).length;

            if (importCount === 0) {
                showStatus('The import file contains no rules!', true);
                return;
            }

            // Validate each imported rule for correct types and safe lengths
            const validationError = validateImportedRules(importedRules);
            if (validationError) {
                showStatus(validationError, true);
                return;
            }

            // Ask user how they want to handle the import:
            // - REPLACE: Discard all current rules and use only the imported ones.
            // - MERGE: Keep existing rules and add the imported ones on top.
            //   If an imported rule has the same original text as an existing rule,
            //   the imported version wins (overwrites the existing one).
            const shouldReplace = confirm(
                `Found ${importCount} rules in the file.\n\n` +
                `Click OK to REPLACE all existing rules.\n` +
                `Click Cancel to MERGE with existing rules.`
            );

            // Read current rules from storage for merge mode
            chrome.storage.sync.get('wordMap', (data) => {
                if (chrome.runtime.lastError) {
                    Logger.error('Failed to get word map for import:', chrome.runtime.lastError);
                    showStatus('Failed to load current rules.', true);
                    return;
                }

                let finalRules;

                if (shouldReplace) {
                    finalRules = importedRules;
                    Logger.debug('Import mode: REPLACE');
                } else {
                    // Merge: imported rules overwrite existing ones on conflict
                    finalRules = { ...data.wordMap, ...importedRules };
                    Logger.debug('Import mode: MERGE');
                }

                // Check if result exceeds rule limit
                const finalCount = Object.keys(finalRules).length;
                if (finalCount > MAX_RULES) {
                    showStatus(`Import would exceed maximum of ${MAX_RULES} rules! (Would have ${finalCount})`, true);
                    return;
                }

                // Check storage quota
                const quotaError = validateStorageQuota(finalRules);
                if (quotaError) {
                    showStatus(quotaError, true);
                    return;
                }

                // Save the imported rules
                chrome.storage.sync.set({ wordMap: finalRules }, () => {
                    if (chrome.runtime.lastError) {
                        Logger.error('Failed to save imported rules:', chrome.runtime.lastError);
                        showStatus('Failed to save imported rules.', true);
                    } else {
                        Logger.debug('Import successful:', finalCount, 'total rules');
                        loadWordMap(); // Refresh the UI
                        showStatus(`Successfully imported ${importCount} rules! Total: ${finalCount}`);
                    }
                });
            });

        } catch (error) {
            Logger.error('Failed to parse import file:', error);
            showStatus('Invalid JSON file! Please check the file format.', true);
        }
    };

    reader.onerror = () => {
        Logger.error('Failed to read import file:', reader.error);
        showStatus('Failed to read file. Please try again.', true);
    };

    reader.readAsText(file);

    // Reset the file input so the same file can be selected again if needed
    document.getElementById('importFile').value = '';
}

// -----------------------------------------------------------------------------
// SEARCH / FILTER
// Real-time search that filters the rules table as the user types.
// Searches in both the original text and replacement text columns.
// -----------------------------------------------------------------------------

/**
 * Filters the rules table based on the search query.
 * Case-insensitive search for better user experience.
 *
 * @param {string} query - The search term entered by the user.
 */
function filterRules(query) {
    const searchQuery = query.toLowerCase().trim();
    const rows = document.querySelectorAll('#replacementList tr');
    let visibleCount = 0;
    const totalCount = rows.length;

    // If search is empty, show all rows and clear the results counter
    if (!searchQuery) {
        rows.forEach(row => {
            row.style.display = '';
        });
        document.getElementById('searchResults').textContent = '';
        return;
    }

    // Filter rows: show only those where original or replacement text matches
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input[type="text"]');
        if (inputs.length < 2) return; // Safety check

        const originalText = inputs[0].value.toLowerCase();
        const replacementText = inputs[1].value.toLowerCase();

        const matches = originalText.includes(searchQuery) || replacementText.includes(searchQuery);

        if (matches) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    // Update the search results counter
    const resultsEl = document.getElementById('searchResults');
    if (visibleCount === 0) {
        resultsEl.textContent = 'No matches found';
        resultsEl.style.color = '#ff1744';
    } else if (visibleCount === totalCount) {
        resultsEl.textContent = `Showing all ${totalCount} rules`;
        resultsEl.style.color = 'var(--text-muted)';
    } else {
        resultsEl.textContent = `Showing ${visibleCount} of ${totalCount} rules`;
        resultsEl.style.color = 'var(--primary)';
    }

    Logger.debug('Search query:', searchQuery, '| Visible:', visibleCount, '/', totalCount);
}
