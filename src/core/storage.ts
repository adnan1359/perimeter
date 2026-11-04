/**
 * Chrome Storage & Persistence Layer (High-Performance Dual-Tier)
 *
 * Performance & Concurrency Features:
 * 1. Hot in-memory cache for zero-latency lookups on service worker events.
 * 2. chrome.storage.session synchronization across ephemeral worker lifecycles.
 * 3. chrome.storage.local for cold durability across browser restarts.
 * 4. Atomic mutation queues to eliminate concurrent write races on violation logging.
 */

import { FocusSession, Violation, ExtensionSettings, AnalyticsSummary } from '../types/session';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  closeUnapprovedTabsImmediately: true,
  blockIncognitoDuringSession: true,
  playWarningSoundOnViolation: true,
  allowLocalhost: false,
  defaultDurationMinutes: 45,
  enforceAllOpenWindows: true,
};

const STORAGE_KEYS = {
  CURRENT_SESSION: 'tbe_current_session',
  SESSION_HISTORY: 'tbe_session_history',
  SETTINGS: 'tbe_settings',
  ALL_VIOLATIONS: 'tbe_violations',
} as const;

type StorageChangeCallback = (changes: { [key: string]: { oldValue?: any; newValue?: any } }) => void;

class StorageService {
  private listeners: Set<StorageChangeCallback> = new Set();
  // Hot in-memory cache for active session & settings
  private sessionCache: FocusSession | null = null;
  private settingsCache: ExtensionSettings | null = null;
  private isCacheInitialized = false;

  // Mutex lock queue for serializing concurrent violation writes
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.initCache();

    // Listen to chrome.storage.onChanged
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' || areaName === 'session') {
          if (changes[STORAGE_KEYS.CURRENT_SESSION]) {
            this.sessionCache = (changes[STORAGE_KEYS.CURRENT_SESSION].newValue as FocusSession) || null;
          }
          if (changes[STORAGE_KEYS.SETTINGS]) {
            this.settingsCache = (changes[STORAGE_KEYS.SETTINGS].newValue as ExtensionSettings) || null;
          }
          this.notifyListeners(changes as Record<string, { oldValue?: any; newValue?: any }>);
        }
      });
    } else if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key) {
          const change = {
            [e.key]: {
              oldValue: e.oldValue ? JSON.parse(e.oldValue) : undefined,
              newValue: e.newValue ? JSON.parse(e.newValue) : undefined,
            },
          };
          if (e.key === STORAGE_KEYS.CURRENT_SESSION) {
            this.sessionCache = change[e.key].newValue;
          }
          this.notifyListeners(change);
        }
      });
    }
  }

  private async initCache(): Promise<void> {
    if (this.isCacheInitialized) return;
    this.sessionCache = await this.get<FocusSession | null>(STORAGE_KEYS.CURRENT_SESSION, null);
    this.settingsCache = await this.get<ExtensionSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    this.isCacheInitialized = true;
  }

  public addListener(cb: StorageChangeCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(changes: { [key: string]: { oldValue?: any; newValue?: any } }) {
    for (const listener of this.listeners) {
      try {
        listener(changes);
      } catch (err) {
        console.error('Storage listener error:', err);
      }
    }
  }

  /**
   * Low-level getter supporting chrome.storage.session, chrome.storage.local, and localStorage
   */
  public async get<T>(key: string, defaultValue: T): Promise<T> {
    // 1. Try chrome.storage.session or local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise<T>((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime?.lastError) {
            resolve(this.getLocalStorage(key, defaultValue));
          } else {
            resolve((result[key] !== undefined ? result[key] : defaultValue) as T);
          }
        });
      });
    }

    return this.getLocalStorage(key, defaultValue);
  }

  /**
   * Low-level setter supporting both chrome.storage and localStorage
   */
  public async set<T>(key: string, value: T): Promise<void> {
    const oldValue = await this.get<T>(key, undefined as unknown as T);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
      // Also write to session storage if supported in MV3
      if (chrome.storage.session) {
        try {
          chrome.storage.session.set({ [key]: value });
        } catch {
          // ignore
        }
      }
    }

    this.setLocalStorage(key, value);

    this.notifyListeners({
      [key]: { oldValue, newValue: value },
    });
  }

  public async remove(key: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], () => resolve());
      });
      if (chrome.storage.session) {
        try {
          chrome.storage.session.remove([key]);
        } catch {
          // ignore
        }
      }
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  }

  private getLocalStorage<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaultValue;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  private setLocalStorage<T>(key: string, value: T): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.warn('Failed to write to localStorage:', err);
      }
    }
  }

  // --- High-Performance Cached Typed Accessors ---

  /**
   * Zero-latency synchronous read from hot memory cache.
   * If cache is warming up, falls back to async storage.
   */
  public async getCurrentSession(): Promise<FocusSession | null> {
    if (this.sessionCache !== null) {
      return this.sessionCache;
    }
    const session = await this.get<FocusSession | null>(STORAGE_KEYS.CURRENT_SESSION, null);
    this.sessionCache = session;
    return session;
  }

  public getCachedSessionSync(): FocusSession | null {
    return this.sessionCache;
  }

  public async setCurrentSession(session: FocusSession | null): Promise<void> {
    this.sessionCache = session;
    await this.set<FocusSession | null>(STORAGE_KEYS.CURRENT_SESSION, session);
  }

  public async getSessionHistory(): Promise<FocusSession[]> {
    return this.get<FocusSession[]>(STORAGE_KEYS.SESSION_HISTORY, []);
  }

  public async saveSessionToHistory(session: FocusSession): Promise<void> {
    const history = await this.getSessionHistory();
    const updated = [session, ...history.filter((s) => s.id !== session.id)];
    await this.set<FocusSession[]>(STORAGE_KEYS.SESSION_HISTORY, updated);
  }

  public async getSettings(): Promise<ExtensionSettings> {
    if (this.settingsCache !== null) {
      return this.settingsCache;
    }
    const settings = await this.get<ExtensionSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    this.settingsCache = settings;
    return settings;
  }

  public async setSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings();
    const merged: ExtensionSettings = { ...current, ...settings };
    this.settingsCache = merged;
    await this.set<ExtensionSettings>(STORAGE_KEYS.SETTINGS, merged);
    return merged;
  }

  public async getAllViolations(): Promise<Violation[]> {
    return this.get<Violation[]>(STORAGE_KEYS.ALL_VIOLATIONS, []);
  }

  /**
   * Thread-safe violation logging via serialized atomic promise queue.
   * Prevents race conditions when multiple tabs trigger violations concurrently.
   */
  public async recordViolation(violation: Violation): Promise<void> {
    // Chain onto the write queue to ensure atomic read-modify-write
    this.writeQueue = this.writeQueue
      .then(async () => {
        const violations = await this.getAllViolations();
        const updated = [violation, ...violations];
        await this.set<Violation[]>(STORAGE_KEYS.ALL_VIOLATIONS, updated);

        const currentSession = await this.getCurrentSession();
        if (currentSession && currentSession.status === 'active') {
          currentSession.violations = [violation, ...currentSession.violations];
          this.sessionCache = currentSession;
          await this.setCurrentSession(currentSession);
        }
      })
      .catch((err) => {
        console.error('Failed to atomically record violation:', err);
      });

    return this.writeQueue;
  }

  public async getAnalytics(): Promise<AnalyticsSummary> {
    const history = await this.getSessionHistory();
    const current = await this.getCurrentSession();
    const allSessions = current ? [current, ...history.filter((s) => s.id !== current.id)] : history;

    const totalSessions = allSessions.length;
    const completedSessions = allSessions.filter((s) => s.status === 'completed').length;
    const focusCompletionRate = totalSessions > 0 ? completedSessions / totalSessions : 0;

    let totalDurationMinutes = 0;
    let totalViolations = 0;
    const domainCounts: Record<string, number> = {};

    for (const session of allSessions) {
      totalDurationMinutes += session.durationMinutes || 0;
      for (const v of session.violations) {
        totalViolations++;
        if (v.domain) {
          domainCounts[v.domain] = (domainCounts[v.domain] || 0) + 1;
        }
      }
    }

    const averageFocusTimeMinutes = totalSessions > 0
      ? Math.round(totalDurationMinutes / totalSessions)
      : 0;

    const violationsPerSession = totalSessions > 0
      ? Number((totalViolations / totalSessions).toFixed(1))
      : 0;

    const topEscapedDomains = Object.entries(domainCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalSessions,
      completedSessions,
      focusCompletionRate,
      averageFocusTimeMinutes,
      totalViolations,
      violationsPerSession,
      topEscapedDomains,
    };
  }

  public async clearAllData(): Promise<void> {
    this.sessionCache = null;
    this.settingsCache = null;
    await this.setCurrentSession(null);
    await this.set<FocusSession[]>(STORAGE_KEYS.SESSION_HISTORY, []);
    await this.set<Violation[]>(STORAGE_KEYS.ALL_VIOLATIONS, []);
    await this.set<ExtensionSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }
}

export const storage = new StorageService();
