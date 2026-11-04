/**
 * Task Boundary Enforcer - Hardened Background Service Worker (Manifest V3)
 *
 * Principal Engineering Enhancements:
 * 1. DeclarativeNetRequest dynamic rule management for pre-request kernel blocking.
 * 2. Single-tab window protection to prevent killing the entire browser window on tab switch.
 * 3. Atomic state synchronization across MV3 cold-starts.
 * 4. IPC sender identity verification against spoofing.
 * 5. Created-target interception (catches target="_blank", middle clicks, and popups).
 */

import { storage } from '../core/storage';
import { PolicyEngine } from '../core/PolicyEngine';
import { SessionManager } from '../core/SessionManager';
import { DomainValidator } from '../core/DomainValidator';

/**
 * Ensures worker state and DNR rules are synchronized on install or update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[TBE Worker] Installed/updated:', details.reason);
  const session = await storage.getCurrentSession();
  if (session && session.status === 'active') {
    if (PolicyEngine.isSessionExpired(session)) {
      await SessionManager.endSession('completed');
    } else {
      SessionManager.updateBadge('ON', '#16a34a');
      await PolicyEngine.syncDeclarativeNetRequestRules(session);
    }
  } else {
    SessionManager.updateBadge('', '#000000');
    await PolicyEngine.syncDeclarativeNetRequestRules(null);
  }
});

/**
 * Browser startup restoration.
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[TBE Worker] Browser started. Synchronizing workspace boundaries...');
  const session = await storage.getCurrentSession();
  if (session && session.status === 'active') {
    if (PolicyEngine.isSessionExpired(session)) {
      await SessionManager.endSession('completed');
    } else {
      SessionManager.updateBadge('ON', '#16a34a');
      await PolicyEngine.syncDeclarativeNetRequestRules(session);
      const remainingMinutes = PolicyEngine.calculateRemainingMinutes(session);
      chrome.alarms.create('tbe_session_timer', { delayInMinutes: Math.max(1, remainingMinutes) });
    }
  }
});

// Alarm Listener for Session Expiry
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tbe_session_timer') {
    console.log('[TBE Worker] Session duration alarm triggered.');
    await SessionManager.endSession('completed');
  }
});

/**
 * 1. Primary Navigation Interception: chrome.webNavigation.onBeforeNavigate
 * Validates top-level navigation requests before scripts execute.
 */
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only evaluate top-level frame (frameId === 0)
  if (details.frameId !== 0) return;

  const session = await storage.getCurrentSession();
  if (!session || session.status !== 'active') return;

  if (PolicyEngine.isSessionExpired(session)) {
    await SessionManager.endSession('completed');
    return;
  }

  const decision = await PolicyEngine.evaluateNavigation(session, details.url, details.tabId);

  if (!decision.allowed && decision.redirectUrl) {
    console.warn(`[TBE Worker] Blocked navigation: ${details.url}. Redirecting tab ${details.tabId}`);
    try {
      await chrome.tabs.update(details.tabId, { url: decision.redirectUrl });
    } catch (err) {
      console.error('[TBE Worker] Navigation redirection error:', err);
    }
  }
});

/**
 * 2. New Tab / Target Created Navigation: chrome.webNavigation.onCreatedNavigationTarget
 * Catches middle clicks, target="_blank", window.open() before the tab loads.
 */
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const session = await storage.getCurrentSession();
  if (!session || session.status !== 'active') return;

  const decision = await PolicyEngine.evaluateNavigation(session, details.url, details.tabId);
  if (!decision.allowed && decision.redirectUrl) {
    console.warn(`[TBE Worker] New target blocked: ${details.url}. Closing or redirecting tab ${details.tabId}`);
    try {
      await chrome.tabs.update(details.tabId, { url: decision.redirectUrl });
    } catch (err) {
      console.error('[TBE Worker] Target redirection error:', err);
    }
  }
});

/**
 * 3. Secondary Safety Net: chrome.tabs.onUpdated
 * Catches pushState / Single Page App router URL changes.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const targetUrl = changeInfo.url || tab.url;
  if (!targetUrl) return;

  const session = await storage.getCurrentSession();
  if (!session || session.status !== 'active') return;

  if (DomainValidator.isExtensionPage(targetUrl)) return;

  const decision = await PolicyEngine.evaluateNavigation(session, targetUrl, tabId);
  if (!decision.allowed && decision.redirectUrl) {
    try {
      await chrome.tabs.update(tabId, { url: decision.redirectUrl });
    } catch (err) {
      console.error('[TBE Worker] onUpdated redirection error:', err);
    }
  }
});

/**
 * 4. Existing Tab Switch Enforcement: chrome.tabs.onActivated
 * Immediate termination with single-tab window safety guard.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const session = await storage.getCurrentSession();
  if (!session || session.status !== 'active') return;

  try {
    const [tab, windowTabs] = await Promise.all([
      chrome.tabs.get(activeInfo.tabId),
      chrome.tabs.query({ windowId: activeInfo.windowId }),
    ]);

    if (!tab || !tab.url) return;

    const decision = await PolicyEngine.evaluateTabActivation(
      session,
      tab.url,
      activeInfo.tabId,
      windowTabs.length
    );

    if (decision.shouldCloseTab) {
      console.warn(`[TBE Worker] Unapproved tab switch. Closing tab ${activeInfo.tabId} (${decision.domain}) immediately.`);
      await chrome.tabs.remove(activeInfo.tabId);
    } else if (decision.safeRedirectUrl) {
      // Last tab in window: redirect safely rather than closing entire window
      console.warn(`[TBE Worker] Unapproved last tab in window. Redirecting to recovery page.`);
      await chrome.tabs.update(activeInfo.tabId, { url: decision.safeRedirectUrl });
    }
  } catch (err) {
    console.debug('[TBE Worker] Tab activation check note:', err);
  }
});

/**
 * 5. Anti-Circumvention: Incognito Detection
 */
chrome.windows.onCreated.addListener(async (win) => {
  const session = await storage.getCurrentSession();
  if (!session || session.status !== 'active') return;

  const settings = await storage.getSettings();

  if (win.incognito && settings.blockIncognitoDuringSession && win.id) {
    console.warn('[TBE Worker] Terminating incognito window opened during active session.');
    try {
      await chrome.windows.remove(win.id);
      await storage.recordViolation({
        id: `viol_incog_${Date.now()}`,
        timestamp: Date.now(),
        attemptedUrl: 'chrome://incognito',
        domain: 'incognito',
        actionTaken: 'incognito_closed',
        reason: 'Attempted to open Incognito window during active focus boundary.',
      });
    } catch (err) {
      console.error('[TBE Worker] Incognito window close error:', err);
    }
  }
});

/**
 * 6. Hardened IPC Messaging with Sender Validation
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender: Reject any message not originating from our own extension
  if (sender.id && sender.id !== chrome.runtime.id) {
    console.warn('[TBE Worker] Rejected unauthorized cross-extension message from:', sender.id);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  if (!message || !message.type) return false;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_STATE': {
          const session = await storage.getCurrentSession();
          const settings = await storage.getSettings();
          const history = await storage.getSessionHistory();
          sendResponse({ success: true, session, settings, history });
          break;
        }

        case 'START_SESSION': {
          const { goal, durationMinutes, customTabs, manualDomains } = message.payload;
          const session = await SessionManager.startSession(goal, durationMinutes, customTabs, manualDomains);
          sendResponse({ success: true, session });
          break;
        }

        case 'END_SESSION': {
          const { status } = message.payload || {};
          const session = await SessionManager.endSession(status || 'ended_early');
          sendResponse({ success: true, session });
          break;
        }

        case 'ADD_DOMAIN': {
          const { domain } = message.payload;
          const session = await SessionManager.addDomainToActiveSession(domain);
          sendResponse({ success: true, session });
          break;
        }

        case 'REMOVE_DOMAIN': {
          const { domain } = message.payload;
          const session = await SessionManager.removeDomainFromActiveSession(domain);
          sendResponse({ success: true, session });
          break;
        }

        case 'RECORD_VIOLATION': {
          await storage.recordViolation(message.payload);
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err: any) {
      console.error('[TBE Worker] IPC Error:', err);
      sendResponse({ success: false, error: err?.message || 'Internal error' });
    }
  })();

  return true;
});
