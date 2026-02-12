// background.js
// -----------------------------------------------------------------------------
// BACKGROUND SERVICE WORKER
// This is the background script for the extension. It handles two things:
//   1. Logging when the extension is first installed.
//   2. Opening the management page when you click the toolbar icon.
//
// It is event-driven and runs ONLY when one of these events fires.
// It does NOT run continuously, does NOT collect any data, and does NOT
// communicate with any external servers.
//
// PRIVACY NOTICE:
// - This script does NOT collect or transmit any data.
// - It does NOT track your browsing activity.
// - Its only purpose is to open the management page when you click the icon.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// LOGGING UTILITY
// Simple logging system to provide consistent, prefixed log messages.
// Set ENABLE_DEBUG_LOGGING to true to see detailed logs in the console.
// In production, keep this false to reduce console noise.
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
// INSTALLATION HANDLER
// Runs once when the extension is first installed or updated.
// This is purely informational — it just logs a confirmation message.
// -----------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  Logger.info('Extension installed successfully!');
  Logger.debug('Installation details:', chrome.runtime.getManifest());
});

// -----------------------------------------------------------------------------
// TOOLBAR ICON CLICK HANDLER
// Opens the full 'manage.html' page instead of a small popup,
// giving the user a better interface to manage their replacement rules.
//
// CROSS-BROWSER COMPATIBILITY:
// Manifest V3 uses 'chrome.action', while older Manifest V2 used
// 'chrome.browserAction'. We detect which API is available at runtime
// so this single script works across Chrome, Edge, Opera, and Firefox.
// If both browsers use MV3 (which they do in this extension), only
// chrome.action will be defined — the fallback exists as a safety net.
// -----------------------------------------------------------------------------
const actionAPI = chrome.action || chrome.browserAction;
actionAPI.onClicked.addListener(() => {
  Logger.debug('Extension icon clicked, opening management page');
  chrome.tabs.create({ url: 'manage.html' });
});
