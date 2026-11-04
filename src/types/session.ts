export interface Violation {
  id: string;
  timestamp: number;
  attemptedUrl: string;
  domain: string;
  tabId?: number;
  actionTaken: 'blocked_navigation' | 'tab_removed' | 'incognito_closed';
  reason?: string;
}

export interface FocusSession {
  id: string;
  createdAt: number;
  goal: string;
  allowedDomains: string[];
  allowedTabIds: number[];
  durationMinutes: number;
  violations: Violation[];
  status: 'active' | 'completed' | 'ended_early';
  endedAt?: number;
  notes?: string;
}

export interface CapturedTab {
  tabId: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl?: string;
  active?: boolean;
  pinned?: boolean;
}

export interface ExtensionSettings {
  closeUnapprovedTabsImmediately: boolean;
  blockIncognitoDuringSession: boolean;
  playWarningSoundOnViolation: boolean;
  allowLocalhost: boolean;
  defaultDurationMinutes: number;
  enforceAllOpenWindows: boolean;
}

export interface AnalyticsSummary {
  totalSessions: number;
  completedSessions: number;
  focusCompletionRate: number; // 0.0 to 1.0 (completed / total)
  averageFocusTimeMinutes: number;
  totalViolations: number;
  violationsPerSession: number;
  topEscapedDomains: Array<{ domain: string; count: number }>;
}
