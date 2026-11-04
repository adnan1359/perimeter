/**
 * Task Boundary Enforcer - Hardened Session Manager
 * Coordinates session lifecycle, tab harvesting, DNR rule synchronization,
 * alarms, and badge updates.
 */

import { DomainValidator } from './DomainValidator';
import { PolicyEngine } from './PolicyEngine';
import { storage } from './storage';
import { FocusSession, CapturedTab } from '../types/session';

export class SessionManager {
  /**
   * Queries open tabs from the current browser window and normalizes their metadata.
   */
  public static async harvestCurrentWindowTabs(): Promise<CapturedTab[]> {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      return new Promise<CapturedTab[]>((resolve) => {
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
          if (chrome.runtime?.lastError || !tabs) {
            resolve([]);
            return;
          }

          const captured: CapturedTab[] = tabs.map((tab) => {
            const url = tab.url || tab.pendingUrl || '';
            const domain = DomainValidator.extractDomain(url) || '';
            return {
              tabId: tab.id || 0,
              title: tab.title || 'Untitled Tab',
              url,
              domain,
              favIconUrl: tab.favIconUrl,
              active: tab.active,
              pinned: tab.pinned,
            };
          });

          resolve(captured);
        });
      });
    }

    // Default mock tabs for preview / simulated environment
    return [
      {
        tabId: 101,
        title: 'kubernetes/kubernetes: Production-Grade Container Scheduling',
        url: 'https://github.com/kubernetes/kubernetes',
        domain: 'github.com',
        active: true,
      },
      {
        tabId: 102,
        title: 'PAY-4092: Fix payment service webhook timeout on retries - Jira',
        url: 'https://jira.company.com/browse/PAY-4092',
        domain: 'jira.company.com',
      },
      {
        tabId: 103,
        title: 'Payment Gateway Architecture v2 - Confluence',
        url: 'https://confluence.company.com/wiki/spaces/PAY/pages/4921',
        domain: 'confluence.company.com',
      },
      {
        tabId: 104,
        title: 'Incident #882 Response Room - Teams',
        url: 'https://teams.microsoft.com/l/channel/19%3Aincident882',
        domain: 'teams.microsoft.com',
      },
      {
        tabId: 105,
        title: 'Stripe API Reference - PaymentIntents',
        url: 'https://stripe.com/docs/api/payment_intents',
        domain: 'stripe.com',
      },
    ];
  }

  /**
   * Checks whether the user has granted incognito access in chrome://extensions.
   */
  public static async isIncognitoAccessGranted(): Promise<boolean> {
    if (typeof chrome !== 'undefined' && chrome.extension?.isAllowedIncognitoAccess) {
      return new Promise<boolean>((resolve) => {
        chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
          resolve(!!isAllowed);
        });
      });
    }
    return true; // Default in simulator
  }

  /**
   * Starts a new Focus Session with user goal and captured or configured tabs.
   */
  public static async startSession(
    goal: string,
    durationMinutes: number = 45,
    customTabs?: CapturedTab[],
    manualDomains?: string[]
  ): Promise<FocusSession> {
    const cleanGoal = goal.trim() || 'Deep Work Session';
    const tabs = customTabs || (await this.harvestCurrentWindowTabs());

    // Extract domains from harvested tabs
    const harvestedUrls = tabs.map((t) => t.url);
    const extractedDomains = DomainValidator.extractUniqueDomains(harvestedUrls);

    // Merge with any manually specified domains
    const combinedSet = new Set<string>([...extractedDomains]);
    if (manualDomains) {
      for (const d of manualDomains) {
        const cleaned = DomainValidator.extractDomain(d);
        if (cleaned && cleaned !== 'newtab') {
          combinedSet.add(cleaned.startsWith('www.') ? cleaned.slice(4) : cleaned);
        }
      }
    }

    const allowedDomains = Array.from(combinedSet).sort();
    const allowedTabIds = tabs.map((t) => t.tabId).filter(Boolean);

    const session: FocusSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now(),
      goal: cleanGoal,
      allowedDomains,
      allowedTabIds,
      durationMinutes: Math.max(5, durationMinutes),
      violations: [],
      status: 'active',
    };

    await storage.setCurrentSession(session);

    // Synchronize declarativeNetRequest dynamic rules
    await PolicyEngine.syncDeclarativeNetRequestRules(session);

    // Schedule background Chrome Alarm for session expiration
    if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
      chrome.alarms.create('tbe_session_timer', {
        delayInMinutes: session.durationMinutes,
      });
    }

    // Set extension action badge
    this.updateBadge('ON', '#16a34a');

    // Proactive Tab Sweep: If the current active tab is unapproved, immediately
    // redirect it to the extension UI so the user does not need to refresh.
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ currentWindow: true, active: true }, async (activeTabs) => {
        if (activeTabs && activeTabs[0] && activeTabs[0].id) {
          const activeTab = activeTabs[0];
          const activeUrl = activeTab.url || activeTab.pendingUrl || '';
          if (
            activeUrl &&
            !DomainValidator.isExtensionPage(activeUrl) &&
            !DomainValidator.isAllowedSystemPage(activeUrl) &&
            !DomainValidator.isAllowedDomain(activeUrl, allowedDomains)
          ) {
            const redirectUrl = PolicyEngine.getBlockedPageUrl(session, activeUrl);
            await chrome.tabs.update(activeTab.id, { url: redirectUrl });
          }
        }
      });
    }

    return session;
  }

  /**
   * Ends the current focus session, recording completion or early stop in history.
   */
  public static async endSession(status: 'completed' | 'ended_early' = 'ended_early'): Promise<FocusSession | null> {
    const session = await storage.getCurrentSession();
    if (!session) {
      this.updateBadge('', '#000000');
      await PolicyEngine.syncDeclarativeNetRequestRules(null);
      return null;
    }

    session.status = status;
    session.endedAt = Date.now();

    await storage.saveSessionToHistory(session);
    await storage.setCurrentSession(null);

    // Clear DNR rules
    await PolicyEngine.syncDeclarativeNetRequestRules(null);

    // Clear alarm
    if (typeof chrome !== 'undefined' && chrome.alarms?.clear) {
      chrome.alarms.clear('tbe_session_timer');
    }

    // Clear badge
    this.updateBadge('', '#000000');

    return session;
  }

  /**
   * Adds an approved domain dynamically during an active session.
   */
  public static async addDomainToActiveSession(domainToAdd: string): Promise<FocusSession | null> {
    const session = await storage.getCurrentSession();
    if (!session || session.status !== 'active') return null;

    const clean = DomainValidator.extractDomain(domainToAdd);
    if (!clean || clean === 'newtab') return session;

    const normalized = clean.startsWith('www.') ? clean.slice(4) : clean;
    if (!session.allowedDomains.includes(normalized)) {
      session.allowedDomains = [...session.allowedDomains, normalized].sort();
      await storage.setCurrentSession(session);
      await PolicyEngine.syncDeclarativeNetRequestRules(session);
    }

    return session;
  }

  /**
   * Removes an approved domain from an active session.
   */
  public static async removeDomainFromActiveSession(domainToRemove: string): Promise<FocusSession | null> {
    const session = await storage.getCurrentSession();
    if (!session || session.status !== 'active') return null;

    session.allowedDomains = session.allowedDomains.filter(
      (d) => d !== domainToRemove && d !== `www.${domainToRemove}`
    );
    await storage.setCurrentSession(session);
    await PolicyEngine.syncDeclarativeNetRequestRules(session);

    return session;
  }

  /**
   * Helper to update Chrome extension icon badge.
   */
  public static updateBadge(text: string, color: string = '#16a34a'): void {
    if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
      try {
        chrome.action.setBadgeText({ text });
        if (chrome.action.setBadgeBackgroundColor) {
          chrome.action.setBadgeBackgroundColor({ color });
        }
      } catch (err) {
        console.warn('Unable to set extension badge:', err);
      }
    }
  }
}
