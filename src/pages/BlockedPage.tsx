import React, { useState, useEffect } from 'react';
import { storage } from '../core/storage';
import { SessionManager } from '../core/SessionManager';
import { DomainValidator } from '../core/DomainValidator';
import { FocusSession } from '../types/session';
import { ShieldAlert, ArrowLeft, StopCircle, Plus, CheckCircle2 } from 'lucide-react';

interface BlockedPageProps {
  initialGoal?: string;
  initialAttemptedUrl?: string;
  initialDomain?: string;
  initialRemainingMinutes?: number;
  onReturnToSession?: () => void;
  onEndSession?: () => void;
}

export const BlockedPage: React.FC<BlockedPageProps> = ({
  initialGoal,
  initialAttemptedUrl,
  initialDomain,
  initialRemainingMinutes,
  onReturnToSession,
  onEndSession,
}) => {
  const [goal, setGoal] = useState(initialGoal || 'Active Work Goal');
  const [attemptedUrl, setAttemptedUrl] = useState(initialAttemptedUrl || 'youtube.com');
  const [domain, setDomain] = useState(initialDomain || 'youtube.com');
  const [remainingMinutes, setRemainingMinutes] = useState(initialRemainingMinutes ?? 37);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [addedSuccessfully, setAddedSuccessfully] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    // Read and sanitize from window URL query parameters
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlGoal = params.get('goal');
      const urlAttempted = params.get('attempted');
      const urlDomain = params.get('domain');
      const urlRemaining = params.get('remainingMinutes');

      if (urlGoal) setGoal(urlGoal.slice(0, 160));
      if (urlAttempted) {
        const sanitized = DomainValidator.sanitizeUrlForRedirect(urlAttempted);
        setAttemptedUrl(sanitized);
        const extracted = DomainValidator.extractDomain(sanitized);
        if (extracted) setDomain(extracted);
      }
      if (urlDomain) setDomain(DomainValidator.normalizeDomain(urlDomain));
      if (urlRemaining) setRemainingMinutes(Math.max(0, parseInt(urlRemaining, 10) || 0));
    }

    const loadSession = async () => {
      const current = await storage.getCurrentSession();
      if (current) {
        setSession(current);
        if (!initialGoal && current.goal) setGoal(current.goal);
        const elapsed = Math.floor((Date.now() - current.createdAt) / (1000 * 60));
        const rem = Math.max(0, current.durationMinutes - elapsed);
        setRemainingMinutes(rem);
      }
    };

    loadSession();
  }, [initialGoal]);

  const handleReturn = () => {
    if (onReturnToSession) {
      onReturnToSession();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id) {
          // Check if there are other tabs in window before closing
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            if (tabs.length > 1) {
              chrome.tabs.remove(tab.id!);
            } else {
              chrome.tabs.update(tab.id!, { url: 'chrome://newtab' });
            }
          });
        } else if (window.history.length > 1) {
          window.history.back();
        }
      });
    } else if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    }
  };

  const handleEnd = async () => {
    await SessionManager.endSession('ended_early');
    if (onEndSession) {
      onEndSession();
      return;
    }

    const safeTarget = DomainValidator.sanitizeUrlForRedirect(attemptedUrl);
    if (safeTarget && safeTarget !== 'about:blank') {
      window.location.href = safeTarget;
    } else if (typeof window !== 'undefined') {
      window.location.href = 'about:blank';
    }
  };

  const handleWhitelistCurrent = async () => {
    if (!domain || domain === 'newtab' || domain === 'unsafe-scheme') return;
    await SessionManager.addDomainToActiveSession(domain);
    setAddedSuccessfully(true);

    setTimeout(() => {
      const safeTarget = DomainValidator.sanitizeUrlForRedirect(attemptedUrl);
      if (safeTarget.startsWith('http')) {
        window.location.href = safeTarget;
      } else {
        handleReturn();
      }
    }, 1200);
  };

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex flex-col justify-center items-center px-4 py-12 selection:bg-neutral-800 font-sans">
      <div className="w-full max-w-lg border border-neutral-800 bg-neutral-900/70 rounded-xl p-8 backdrop-blur shadow-2xl relative overflow-hidden">
        {/* Top Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500/80" />

        {/* Header Badge */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-red-950/60 border border-red-900/50 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-red-400 font-mono">
              Task Boundary Reached
            </div>
            <div className="text-[11px] text-neutral-400">
              Navigation intercepted by active focus workspace
            </div>
          </div>
        </div>

        {/* Structured Context Fields */}
        <div className="space-y-4 mb-8">
          {/* Current Goal */}
          <div className="p-3.5 bg-neutral-950/70 border border-neutral-800 rounded-lg">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
              Active Goal
            </div>
            <div className="text-sm font-semibold text-white leading-snug">
              {goal}
            </div>
          </div>

          {/* Details Split */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-lg">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
                Remaining Focus
              </div>
              <div className="text-sm font-mono font-medium text-neutral-200 tabular-nums">
                {remainingMinutes} minutes
              </div>
            </div>

            <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-lg">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
                Attempted Destination
              </div>
              <div className="text-sm font-mono text-red-300 truncate" title={attemptedUrl}>
                {domain}
              </div>
            </div>
          </div>

          {/* Statement */}
          <p className="text-xs text-neutral-400 leading-relaxed pt-1">
            This destination is outside your current workspace. The Task Boundary Enforcer
            prevents accidental context departure to preserve deep work momentum.
          </p>
        </div>

        {/* Primary Action Buttons */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleReturn}
            className="w-full py-2.5 px-4 bg-white text-neutral-950 hover:bg-neutral-200 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-2 shadow"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Session</span>
          </button>

          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="w-full py-2 px-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <StopCircle className="w-3.5 h-3.5 text-neutral-500" />
              <span>End Focus Session</span>
            </button>
          ) : (
            <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg flex items-center justify-between text-xs">
              <span className="text-red-300">Exit active task boundary?</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEnd}
                  className="px-2.5 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-medium"
                >
                  Yes, End
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="px-2 py-1 text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Whitelist Emergency Override */}
        <div className="mt-6 pt-4 border-t border-neutral-800/80 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            Legitimately need this domain for your task?
          </span>
          <button
            type="button"
            disabled={addedSuccessfully}
            onClick={handleWhitelistCurrent}
            className="text-[11px] text-neutral-300 hover:text-white flex items-center gap-1 transition-colors disabled:text-emerald-400 font-mono"
          >
            {addedSuccessfully ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Approved. Redirecting...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Approve {domain}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
