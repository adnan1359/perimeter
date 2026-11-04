import React, { useState, useEffect } from 'react';
import { FocusSession, CapturedTab } from '../types/session';
import { storage } from '../core/storage';
import { SessionManager } from '../core/SessionManager';
import { DomainValidator } from '../core/DomainValidator';
import { Shield, Clock, AlertTriangle, Globe, Plus, X, ExternalLink, Check, StopCircle } from 'lucide-react';

interface PopupProps {
  onOpenOptions?: () => void;
  onOpenBlockedDemo?: () => void;
  customSession?: FocusSession | null;
  onSessionChange?: (session: FocusSession | null) => void;
}

export const Popup: React.FC<PopupProps> = ({
  onOpenOptions,
  onOpenBlockedDemo,
  customSession,
  onSessionChange,
}) => {
  const [session, setSession] = useState<FocusSession | null>(customSession || null);
  const [goal, setGoal] = useState('');
  const [duration, setDuration] = useState<number>(45);
  const [availableTabs, setAvailableTabs] = useState<CapturedTab[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [newDomainInput, setNewDomainInput] = useState('');
  const [manualDomains, setManualDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Sync session state
  useEffect(() => {
    if (customSession !== undefined) {
      setSession(customSession);
      setLoading(false);
      return;
    }

    const loadState = async () => {
      setLoading(true);
      const current = await storage.getCurrentSession();
      setSession(current);

      if (!current) {
        const tabs = await SessionManager.harvestCurrentWindowTabs();
        setAvailableTabs(tabs);
        setSelectedTabIds(new Set(tabs.map((t) => t.tabId)));
      }
      setLoading(false);
    };

    loadState();

    const unsubscribe = storage.addListener((changes) => {
      if (changes['tbe_current_session']) {
        setSession(changes['tbe_current_session'].newValue);
      }
    });

    return unsubscribe;
  }, [customSession]);

  // Timer loop for active session
  useEffect(() => {
    if (!session || session.status !== 'active') return;

    const updateTimes = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - session.createdAt) / 1000);
      const totalSec = session.durationMinutes * 60;
      const remaining = Math.max(0, totalSec - elapsed);

      setElapsedSeconds(elapsed);
      setTimeRemainingSeconds(remaining);

      if (remaining <= 0) {
        handleEndSession('completed');
      }
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const handleTabToggle = (tabId: number) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  };

  const handleAddManualDomain = () => {
    if (!newDomainInput.trim()) return;
    const clean = DomainValidator.extractDomain(newDomainInput);
    if (clean && clean !== 'newtab' && !manualDomains.includes(clean)) {
      setManualDomains([...manualDomains, clean]);
      setNewDomainInput('');
    }
  };

  const handleRemoveManualDomain = (domain: string) => {
    setManualDomains(manualDomains.filter((d) => d !== domain));
  };

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;

    const filteredTabs = availableTabs.filter((t) => selectedTabIds.has(t.tabId));
    const newSession = await SessionManager.startSession(
      goal.trim(),
      duration,
      filteredTabs,
      manualDomains
    );

    setSession(newSession);
    if (onSessionChange) onSessionChange(newSession);
  };

  const handleEndSession = async (status: 'completed' | 'ended_early' = 'ended_early') => {
    const ended = await SessionManager.endSession(status);
    setSession(null);
    setConfirmEnd(false);
    if (onSessionChange) onSessionChange(null);

    // Refresh open tabs for next session
    const tabs = await SessionManager.harvestCurrentWindowTabs();
    setAvailableTabs(tabs);
    setSelectedTabIds(new Set(tabs.map((t) => t.tabId)));
  };

  const handleAddDomainToActive = async () => {
    if (!newDomainInput.trim()) return;
    const updated = await SessionManager.addDomainToActiveSession(newDomainInput);
    if (updated) {
      setSession({ ...updated });
      setNewDomainInput('');
      if (onSessionChange) onSessionChange(updated);
    }
  };

  const handleRemoveDomainFromActive = async (domain: string) => {
    const updated = await SessionManager.removeDomainFromActiveSession(domain);
    if (updated) {
      setSession({ ...updated });
      if (onSessionChange) onSessionChange(updated);
    }
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Preview extracted domains before starting
  const previewDomains = React.useMemo(() => {
    const urls = availableTabs
      .filter((t) => selectedTabIds.has(t.tabId))
      .map((t) => t.url);
    const extracted = DomainValidator.extractUniqueDomains(urls);
    const merged = new Set([...extracted, ...manualDomains]);
    return Array.from(merged).sort();
  }, [availableTabs, selectedTabIds, manualDomains]);

  if (loading) {
    return (
      <div className="w-[360px] p-6 bg-neutral-900 text-neutral-300 font-sans text-xs">
        Loading focus environment...
      </div>
    );
  }

  // --- ACTIVE SESSION VIEW ---
  if (session && session.status === 'active') {
    const progressPercent = Math.min(
      100,
      (elapsedSeconds / (session.durationMinutes * 60)) * 100
    );

    return (
      <div className="w-[380px] bg-neutral-950 text-neutral-100 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl font-sans">
        {/* Top Header */}
        <div className="px-4 py-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold tracking-tight text-white uppercase">
              Task Boundary Active
            </span>
          </div>
          <div className="text-[11px] font-mono text-neutral-400 tabular-nums">
            {formatTime(timeRemainingSeconds)} left
          </div>
        </div>

        {/* Goal Section */}
        <div className="p-4 border-b border-neutral-800/80 bg-neutral-900/40">
          <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-1 font-medium">
            Current Task Goal
          </div>
          <div className="text-sm font-medium text-white leading-snug">
            {session.goal}
          </div>

          {/* Progress Bar */}
          <div className="mt-3">
            <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-1000 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] text-neutral-400 mt-1 font-mono tabular-nums">
              <span>{Math.floor(elapsedSeconds / 60)}m elapsed</span>
              <span>{session.durationMinutes}m total</span>
            </div>
          </div>
        </div>

        {/* Telemetry / Metrics Row */}
        <div className="grid grid-cols-2 divide-x divide-neutral-800 border-b border-neutral-800 text-center py-2.5 bg-neutral-950">
          <div>
            <div className="text-[10px] text-neutral-400">Allowed Domains</div>
            <div className="text-sm font-semibold font-mono text-white tabular-nums">
              {session.allowedDomains.length}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-400">Blocked Attempts</div>
            <div className="text-sm font-semibold font-mono tabular-nums flex items-center justify-center gap-1">
              <span className={session.violations.length > 0 ? 'text-amber-400' : 'text-neutral-400'}>
                {session.violations.length}
              </span>
              {session.violations.length > 0 && (
                <AlertTriangle className="w-3 h-3 text-amber-400 inline" />
              )}
            </div>
          </div>
        </div>

        {/* Whitelist Panel */}
        <div className="p-4 max-h-[160px] overflow-y-auto space-y-1.5 border-b border-neutral-800">
          <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
            <span>Approved Workspace Domains</span>
            <span className="text-[10px] font-mono">Strict Boundary</span>
          </div>

          {session.allowedDomains.map((domain) => (
            <div
              key={domain}
              className="flex items-center justify-between px-2.5 py-1.5 bg-neutral-900 border border-neutral-800/80 rounded-md text-xs"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Globe className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span className="font-mono text-neutral-200 truncate">{domain}</span>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveDomainFromActive(domain)}
                title="Remove domain"
                className="text-neutral-500 hover:text-red-400 p-0.5 rounded transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Quick Add Domain Field */}
          <div className="pt-2 flex gap-1.5">
            <input
              type="text"
              value={newDomainInput}
              onChange={(e) => setNewDomainInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDomainToActive();
                }
              }}
              placeholder="Add domain (e.g. stackoverflow.com)"
              className="flex-1 px-2.5 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 font-mono"
            />
            <button
              type="button"
              onClick={handleAddDomainToActive}
              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-medium flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-3 bg-neutral-950 flex items-center justify-between gap-2">
          {onOpenOptions && (
            <button
              type="button"
              onClick={onOpenOptions}
              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>Options & Analytics</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}

          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 rounded-md text-xs font-medium transition-colors ml-auto flex items-center gap-1.5"
            >
              <StopCircle className="w-3.5 h-3.5 text-neutral-400" />
              <span>End Session</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] text-neutral-400">Exit boundary?</span>
              <button
                type="button"
                onClick={() => handleEndSession('ended_early')}
                className="px-2.5 py-1 bg-red-950 hover:bg-red-900 text-red-200 border border-red-800 rounded text-xs font-medium transition-colors"
              >
                Confirm End
              </button>
              <button
                type="button"
                onClick={() => setConfirmEnd(false)}
                className="px-2 py-1 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- NEW SESSION CONFIGURATION VIEW ---
  return (
    <div className="w-[380px] bg-neutral-950 text-neutral-100 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl font-sans">
      {/* Header */}
      <div className="px-4 py-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-neutral-200 shrink-0" />
          <span className="text-xs font-semibold tracking-tight text-white uppercase">
            Task Boundary Enforcer
          </span>
        </div>
        {onOpenOptions && (
          <button
            type="button"
            onClick={onOpenOptions}
            className="text-[11px] text-neutral-400 hover:text-white transition-colors"
          >
            Settings
          </button>
        )}
      </div>

      <form onSubmit={handleStartSession} className="p-4 space-y-4">
        {/* Goal Input */}
        <div>
          <label className="block text-[11px] font-medium text-neutral-300 mb-1">
            What are you working on?
          </label>
          <input
            type="text"
            required
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Fix payment service webhook timeout"
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition-colors"
            autoFocus
          />
        </div>

        {/* Duration Select */}
        <div>
          <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 flex items-center justify-between">
            <span>Focus Duration</span>
            <span className="font-mono text-neutral-400 text-[10px]">{duration} minutes</span>
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {[25, 45, 60, 90].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setDuration(mins)}
                className={`py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  duration === mins
                    ? 'bg-neutral-800 border-neutral-600 text-white shadow-sm'
                    : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>

        {/* Harvested Tabs Scope */}
        <div>
          <div className="flex items-center justify-between text-[11px] font-medium text-neutral-300 mb-1.5">
            <span>Current Window Tabs ({availableTabs.length})</span>
            <span className="text-[10px] text-neutral-400">
              {selectedTabIds.size} selected
            </span>
          </div>

          <div className="max-h-[140px] overflow-y-auto space-y-1 pr-1 border border-neutral-800/80 rounded-md p-1.5 bg-neutral-900/50">
            {availableTabs.length === 0 ? (
              <div className="text-[11px] text-neutral-500 py-2 text-center">
                No active tabs captured.
              </div>
            ) : (
              availableTabs.map((tab) => {
                const isSelected = selectedTabIds.has(tab.tabId);
                return (
                  <button
                    key={tab.tabId}
                    type="button"
                    onClick={() => handleTabToggle(tab.tabId)}
                    className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-xs transition-colors ${
                      isSelected
                        ? 'bg-neutral-800 text-white'
                        : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-300'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-neutral-100 border-neutral-100 text-neutral-900'
                          : 'border-neutral-700 bg-neutral-900'
                      }`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                    <div className="truncate flex-1">
                      <div className="truncate text-[11px] font-medium">{tab.title}</div>
                      <div className="text-[10px] font-mono text-neutral-400 truncate">
                        {tab.domain || 'blank'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Extracted Whitelist Preview */}
        <div>
          <div className="text-[11px] font-medium text-neutral-400 mb-1">
            Allowed Whitelist ({previewDomains.length} domains)
          </div>
          <div className="flex flex-wrap gap-1 max-h-[70px] overflow-y-auto">
            {previewDomains.map((dom) => (
              <span
                key={dom}
                className="font-mono text-[11px] text-neutral-300 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded"
              >
                {dom}
              </span>
            ))}
          </div>
        </div>

        {/* Manual Domain Addition */}
        <div className="flex gap-1.5 pt-1">
          <input
            type="text"
            value={newDomainInput}
            onChange={(e) => setNewDomainInput(e.target.value)}
            placeholder="Add custom domain (e.g. stackoverflow.com)"
            className="flex-1 px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddManualDomain();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddManualDomain}
            className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-medium transition-colors"
          >
            Add
          </button>
        </div>

        {/* Primary CTA */}
        <button
          type="submit"
          disabled={!goal.trim()}
          className="w-full py-2.5 bg-neutral-100 hover:bg-white text-neutral-950 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs rounded-md shadow transition-colors flex items-center justify-center gap-1.5"
        >
          <Shield className="w-3.5 h-3.5 text-neutral-950" />
          <span>Start Focus Session</span>
        </button>
      </form>
    </div>
  );
};
