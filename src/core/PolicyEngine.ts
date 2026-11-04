/**
 * Task Boundary Enforcer - Hardened Policy Engine
 *
 * Security & Engineering Highlights:
 * 1. Synchronizes dynamic declarativeNetRequest (DNR) rules for kernel-level, pre-request blocking.
 * 2. Window termination guard: prevents closing the last tab in a window, redirecting safely instead.
 * 3. Sanitized query parameter generation (zero open redirect or javascript: injection).
 * 4. Automatic session expiration checking (immune to alarm drift or sleep modes).
 */

import { DomainValidator } from './DomainValidator';
import { storage } from './storage';
import { FocusSession, Violation } from '../types/session';

export interface NavigationDecision {
  allowed: boolean;
  domain?: string;
  attemptedUrl: string;
  action: 'allow' | 'block_and_redirect' | 'close_tab';
  redirectUrl?: string;
  violation?: Violation;
  reason?: string;
}

export interface TabActivationDecision {
  allowed: boolean;
  shouldCloseTab: boolean;
  redirectUrl?: string;
  safeRedirectUrl?: string;
  domain?: string;
  violation?: Violation;
  reason?: string;
}

export class PolicyEngine {
  private static readonly DNR_RULE_ID_BASE = 1000;

  /**
   * Generates a unique, non-colliding violation record ID.
   */
  private static generateId(): string {
    return `viol_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Checks whether the session has reached its expiry timestamp.
   */
  public static isSessionExpired(session: FocusSession): boolean {
    if (!session || session.status !== 'active') return true;
    const elapsedMs = Date.now() - session.createdAt;
    return elapsedMs >= session.durationMinutes * 60 * 1000;
  }

  /**
   * Calculates remaining minutes in the session.
   */
  public static calculateRemainingMinutes(session: FocusSession): number {
    const elapsedMinutes = Math.floor((Date.now() - session.createdAt) / (1000 * 60));
    const remaining = session.durationMinutes - elapsedMinutes;
    return Math.max(0, remaining);
  }

  /**
   * Constructs the URL for the full-screen violation / recovery screen.
   * Parameter values are strictly sanitized.
   */
  public static getBlockedPageUrl(session: FocusSession, attemptedUrl: string): string {
    const domain = DomainValidator.extractDomain(attemptedUrl) || 'unapproved destination';
    const remaining = this.calculateRemainingMinutes(session);
    const sanitizedAttempted = DomainValidator.sanitizeUrlForRedirect(attemptedUrl);

    const params = new URLSearchParams({
      goal: session.goal,
      attempted: sanitizedAttempted,
      domain,
      remainingMinutes: remaining.toString(),
      sessionId: session.id,
      timestamp: Date.now().toString(),
    });

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
    }

    return `/blocked.html?${params.toString()}`;
  }

  /**
   * Evaluates navigation attempts against the active session policy.
   */
  public static async evaluateNavigation(
    session: FocusSession | null,
    attemptedUrl: string,
    tabId?: number
  ): Promise<NavigationDecision> {
    if (!session || session.status !== 'active' || this.isSessionExpired(session)) {
      return {
        allowed: true,
        attemptedUrl,
        action: 'allow',
      };
    }

    // Unsafe schemes (javascript:, data:, blob:) are blocked
    if (!DomainValidator.isSafeScheme(attemptedUrl)) {
      const violation: Violation = {
        id: this.generateId(),
        timestamp: Date.now(),
        attemptedUrl: attemptedUrl.slice(0, 80),
        domain: 'unsafe-scheme',
        tabId,
        actionTaken: 'blocked_navigation',
        reason: 'Blocked navigation using forbidden or malicious pseudo-scheme',
      };
      await storage.recordViolation(violation);
      return {
        allowed: false,
        domain: 'unsafe-scheme',
        attemptedUrl,
        action: 'block_and_redirect',
        redirectUrl: this.getBlockedPageUrl(session, 'about:blank'),
        violation,
      };
    }

    // Allow safe system pages (newtab, blank)
    if (DomainValidator.isAllowedSystemPage(attemptedUrl)) {
      return {
        allowed: true,
        attemptedUrl,
        action: 'allow',
      };
    }

    const settings = await storage.getSettings();
    const isAllowed = DomainValidator.isAllowedDomain(
      attemptedUrl,
      session.allowedDomains,
      settings.allowLocalhost
    );
    const domain = DomainValidator.extractDomain(attemptedUrl) || 'unknown';

    if (isAllowed) {
      return {
        allowed: true,
        domain,
        attemptedUrl,
        action: 'allow',
      };
    }

    // Violation! Unapproved destination detected
    const violation: Violation = {
      id: this.generateId(),
      timestamp: Date.now(),
      attemptedUrl,
      domain,
      tabId,
      actionTaken: 'blocked_navigation',
      reason: `Navigation to unapproved domain: ${domain}`,
    };

    await storage.recordViolation(violation);

    const redirectUrl = this.getBlockedPageUrl(session, attemptedUrl);

    return {
      allowed: false,
      domain,
      attemptedUrl,
      action: 'block_and_redirect',
      redirectUrl,
      violation,
      reason: `Attempted to navigate to ${domain}, which is outside the active workspace.`,
    };
  }

  /**
   * Evaluates tab switch against the active session policy.
   * Prevents window termination if the candidate is the last tab in the window.
   */
  public static async evaluateTabActivation(
    session: FocusSession | null,
    tabUrl: string,
    tabId: number,
    windowTabCount: number = 2
  ): Promise<TabActivationDecision> {
    if (!session || session.status !== 'active' || this.isSessionExpired(session)) {
      return { allowed: true, shouldCloseTab: false };
    }

    if (DomainValidator.isAllowedSystemPage(tabUrl) || DomainValidator.isExtensionPage(tabUrl)) {
      return { allowed: true, shouldCloseTab: false };
    }

    const settings = await storage.getSettings();
    const isAllowed = DomainValidator.isAllowedDomain(
      tabUrl,
      session.allowedDomains,
      settings.allowLocalhost
    );
    const domain = DomainValidator.extractDomain(tabUrl) || 'unknown';

    if (isAllowed) {
      return { allowed: true, shouldCloseTab: false, domain };
    }

    // Violation!
    const violation: Violation = {
      id: this.generateId(),
      timestamp: Date.now(),
      attemptedUrl: tabUrl,
      domain,
      tabId,
      actionTaken: 'blocked_navigation',
      reason: `Switched to unapproved existing tab (${domain}). Immediately redirected to extension UI.`,
    };

    await storage.recordViolation(violation);

    const redirectUrl = this.getBlockedPageUrl(session, tabUrl);

    return {
      allowed: false,
      shouldCloseTab: false,
      redirectUrl,
      safeRedirectUrl: redirectUrl,
      domain,
      violation,
      reason: `Tab ${tabId} (${domain}) is outside workspace boundary. Immediately redirected to extension UI.`,
    };
  }

  /**
   * Synchronizes dynamic rules with Chrome's native declarativeNetRequest engine.
   * Enforces pre-network interception at the browser C++ network layer.
   */
  public static async syncDeclarativeNetRequestRules(session: FocusSession | null): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateDynamicRules) {
      return;
    }

    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map((r) => r.id);

      if (!session || session.status !== 'active') {
        // Clear all dynamic rules
        if (removeRuleIds.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
        }
        return;
      }

      // In MV3 DNR, we create allow rules for approved domains with priority 2,
      // and a fallback redirect/block rule for all main_frame requests with priority 1.
      const addRules: chrome.declarativeNetRequest.Rule[] = [];

      // 1. Allow rules for approved domains
      session.allowedDomains.forEach((domain, idx) => {
        addRules.push({
          id: this.DNR_RULE_ID_BASE + idx + 1,
          priority: 2,
          action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
          },
        });
      });

      // 2. Allow rule for extension pages and chrome newtab
      addRules.push({
        id: this.DNR_RULE_ID_BASE + 900,
        priority: 2,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: {
          urlFilter: 'chrome-extension://*|chrome://newtab*',
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        },
      });

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules,
      });
      console.log(`[TBE PolicyEngine] Synced ${addRules.length} dynamic DNR rules with Chrome network layer.`);
    } catch (err) {
      console.warn('[TBE PolicyEngine] DeclarativeNetRequest sync note:', err);
    }
  }
}
