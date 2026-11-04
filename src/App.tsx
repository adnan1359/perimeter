import React, { useState, useEffect } from 'react';
import { storage } from './core/storage';
import { SessionManager } from './core/SessionManager';
import { PolicyEngine } from './core/PolicyEngine';
import { DomainValidator } from './core/DomainValidator';
import { FocusSession, CapturedTab, Violation } from './types/session';
import { Popup } from './popup/Popup';
import { Options } from './options/Options';
import { BlockedPage } from './pages/BlockedPage';
import {
  Shield,
  Layers,
  BarChart2,
  AlertOctagon,
  Globe,
  Plus,
  X,
  RotateCw,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Laptop,
  CheckCircle2,
  FileCode2,
} from 'lucide-react';

// Pre-seeded realistic browser tabs for initial testing
const INITIAL_SIMULATED_TABS: CapturedTab[] = [
  {
    tabId: 101,
    title: 'kubernetes/kubernetes: Production-Grade Container Scheduling',
    url: 'https://github.com/kubernetes/kubernetes',
    domain: 'github.com',
    active: true,
  },
  {
    tabId: 102,
    title: 'PAY-4092: Fix payment service webhook timeout - Jira',
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
    title: 'YouTube: Recommended Lo-Fi Coding Beats & Podcasts',
    url: 'https://youtube.com',
    domain: 'youtube.com',
  },
  {
    tabId: 106,
    title: 'Reddit: r/programming top discussions today',
    url: 'https://reddit.com/r/programming',
    domain: 'reddit.com',
  },
];

type AppMode = 'simulator' | 'popup_only' | 'options_only' | 'blocked_only' | 'code_inspect';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('simulator');
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [simulatedTabs, setSimulatedTabs] = useState<CapturedTab[]>(INITIAL_SIMULATED_TABS);
  const [activeTabId, setActiveTabId] = useState<number>(101);
  const [addressBarInput, setAddressBarInput] = useState<string>('https://github.com/kubernetes/kubernetes');
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Blocked page preview state for simulator iframe/view
  const [currentTabIsBlocked, setCurrentTabIsBlocked] = useState(false);
  const [blockedDetails, setBlockedDetails] = useState<{
    goal: string;
    attempted: string;
    domain: string;
    remaining: number;
  } | null>(null);

  // Sync session on mount & subscribe to storage updates
  useEffect(() => {
    const checkState = async () => {
      const current = await storage.getCurrentSession();
      setActiveSession(current);
    };
    checkState();

    const unsubscribe = storage.addListener((changes) => {
      if (changes['tbe_current_session']) {
        setActiveSession(changes['tbe_current_session'].newValue);
      }
    });

    return unsubscribe;
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const currentTab = simulatedTabs.find((t) => t.tabId === activeTabId) || simulatedTabs[0];

  // Keep address bar in sync with active tab URL
  useEffect(() => {
    if (currentTab) {
      setAddressBarInput(currentTab.url);
      setCurrentTabIsBlocked(false);
    }
  }, [activeTabId]);

  // Proactively check current tab when session starts or tab changes
  useEffect(() => {
    if (activeSession && activeSession.status === 'active' && currentTab) {
      if (
        !DomainValidator.isExtensionPage(currentTab.url) &&
        !DomainValidator.isAllowedSystemPage(currentTab.url) &&
        !DomainValidator.isAllowedDomain(currentTab.url, activeSession.allowedDomains)
      ) {
        const remaining = PolicyEngine.calculateRemainingMinutes(activeSession);
        setBlockedDetails({
          goal: activeSession.goal,
          attempted: currentTab.url,
          domain: currentTab.domain || 'unapproved',
          remaining,
        });
        setCurrentTabIsBlocked(true);
      }
    }
  }, [activeSession, activeTabId]);

  /**
   * Tab Activation:
   * When user switches to an already-present tab where the opened website is not
   * in the allowed list, immediately redirect it to the extension UI without requiring a refresh.
   */
  const handleSelectTab = async (tabId: number) => {
    const target = simulatedTabs.find((t) => t.tabId === tabId);
    if (!target) return;

    setActiveTabId(tabId);

    if (activeSession && activeSession.status === 'active') {
      const decision = await PolicyEngine.evaluateTabActivation(
        activeSession,
        target.url,
        tabId,
        simulatedTabs.length
      );

      if (!decision.allowed) {
        // Immediately redirect to extension UI without requiring page refresh!
        const remaining = PolicyEngine.calculateRemainingMinutes(activeSession);
        setBlockedDetails({
          goal: activeSession.goal,
          attempted: target.url,
          domain: decision.domain || target.domain || 'unapproved',
          remaining,
        });
        setCurrentTabIsBlocked(true);
        showToast(`Instant Redirection: Switched to unapproved tab "${target.domain}". Redirected to extension UI.`);
        return;
      }
    }

    setCurrentTabIsBlocked(false);
  };

  /**
   * Navigation Simulation:
   * When user enters a URL in address bar or clicks a link:
   * Checks PolicyEngine.evaluateNavigation()
   */
  const handleNavigate = async (urlToNavigate: string) => {
    if (!urlToNavigate) return;
    let target = urlToNavigate.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://') && !target.startsWith('chrome://')) {
      target = `https://${target}`;
    }

    setAddressBarInput(target);

    if (activeSession && activeSession.status === 'active') {
      const decision = await PolicyEngine.evaluateNavigation(
        activeSession,
        target,
        activeTabId
      );

      if (!decision.allowed) {
        // Intercepted! Show violation screen
        const remaining = PolicyEngine.calculateRemainingMinutes(activeSession);
        setBlockedDetails({
          goal: activeSession.goal,
          attempted: target,
          domain: decision.domain || 'unapproved',
          remaining,
        });
        setCurrentTabIsBlocked(true);
        showToast(`Navigation Intercepted: ${decision.domain} is outside workspace boundary`);
        return;
      }
    }

    // Navigation permitted
    setCurrentTabIsBlocked(false);
    const domain = DomainValidator.extractDomain(target) || 'newtab';
    setSimulatedTabs((prev) =>
      prev.map((tab) =>
        tab.tabId === activeTabId
          ? { ...tab, url: target, domain, title: `${domain} - Working Document` }
          : tab
      )
    );
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    const remaining = simulatedTabs.filter((t) => t.tabId !== tabId);
    setSimulatedTabs(remaining);
    if (activeTabId === tabId && remaining.length > 0) {
      setActiveTabId(remaining[0].tabId);
    }
  };

  const handleCreateNewTab = () => {
    const newId = Date.now();
    const newTab: CapturedTab = {
      tabId: newId,
      title: 'New Tab',
      url: 'chrome://newtab',
      domain: 'newtab',
    };
    setSimulatedTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-neutral-800">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 bg-neutral-900 border border-neutral-700 text-xs font-mono text-white shadow-xl rounded-md flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Primary Top Bar Contract */}
      <header className="h-14 border-b border-neutral-800 bg-neutral-900 px-6 flex items-center justify-between shrink-0">
        {/* Zone 1: Wordmark */}
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-bold tracking-tight text-white uppercase font-mono">
            Task Boundary Enforcer
          </span>
          <span className="text-xs text-neutral-400 font-mono hidden sm:inline">
            Production Chrome Extension
          </span>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
          <button
            type="button"
            onClick={() => setAppMode('simulator')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              appMode === 'simulator'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Browser Simulator
          </button>
          <button
            type="button"
            onClick={() => setAppMode('popup_only')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              appMode === 'popup_only'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Extension Popup
          </button>
          <button
            type="button"
            onClick={() => setAppMode('options_only')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              appMode === 'options_only'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Options & Analytics
          </button>
          <button
            type="button"
            onClick={() => setAppMode('blocked_only')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              appMode === 'blocked_only'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Violation Screen
          </button>
          <button
            type="button"
            onClick={() => setAppMode('code_inspect')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              appMode === 'code_inspect'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Extension Files
          </button>
        </nav>

        {/* Zone 3: Primary Action / Status Indicator */}
        <div className="flex items-center gap-2">
          {activeSession && activeSession.status === 'active' ? (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-950/60 border border-emerald-800/80 rounded-md text-xs font-mono text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Boundary Active: {activeSession.allowedDomains.length} domains</span>
            </div>
          ) : (
            <div className="text-xs text-neutral-400 font-mono">
              Ready · No Active Session
            </div>
          )}
        </div>
      </header>

      {/* Main Viewport Content */}
      <div className="flex-1 overflow-auto">
        {/* 1. EXTENSION SIMULATOR & BROWSER LAB */}
        {appMode === 'simulator' && (
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            {/* Context & Testing Instructions Bar */}
            <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-white flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-neutral-300" />
                  <span>Chrome Extension Live Environment Harness</span>
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed max-w-2xl">
                  Simulates Google Chrome's tab management, background service worker, and webNavigation interception.
                  Click the extension icon on the top-right to start a session. Try switching to YouTube or Reddit tabs,
                  or navigating to unapproved domains in the address bar.
                </p>
              </div>

              {/* Quick Navigation Benchmarks */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-neutral-400 uppercase font-mono mr-1">
                  Test Nav:
                </span>
                <button
                  type="button"
                  onClick={() => handleNavigate('https://docs.github.com/en/rest')}
                  className="px-2 py-1 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded text-[11px] font-mono text-neutral-300 transition-colors"
                >
                  docs.github.com (Subdomain)
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('https://youtube.com')}
                  className="px-2 py-1 bg-red-950/40 hover:bg-red-900/40 border border-red-900/60 rounded text-[11px] font-mono text-red-300 transition-colors"
                >
                  youtube.com (Escape)
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('https://reddit.com')}
                  className="px-2 py-1 bg-red-950/40 hover:bg-red-900/40 border border-red-900/60 rounded text-[11px] font-mono text-red-300 transition-colors"
                >
                  reddit.com (Escape)
                </button>
              </div>
            </div>

            {/* Simulated Chrome Browser Window Frame */}
            <div className="border border-neutral-800 bg-neutral-900 rounded-xl shadow-2xl overflow-hidden relative">
              {/* Chrome Top Tab Strip */}
              <div className="bg-neutral-950 pt-2 px-2 flex items-center gap-1 border-b border-neutral-800/80 overflow-x-auto">
                {simulatedTabs.map((tab) => {
                  const isActive = tab.tabId === activeTabId;
                  return (
                    <div
                      key={tab.tabId}
                      onClick={() => handleSelectTab(tab.tabId)}
                      className={`group max-w-[210px] min-w-[140px] px-3 py-2 rounded-t-lg text-xs cursor-pointer select-none flex items-center justify-between gap-2 border-t border-x transition-colors ${
                        isActive
                          ? 'bg-neutral-900 border-neutral-700 text-white font-medium'
                          : 'bg-neutral-950/80 border-transparent text-neutral-400 hover:bg-neutral-900/50 hover:text-neutral-200'
                      }`}
                      title={`${tab.title} (${tab.url})`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Globe className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        <span className="truncate text-[11px]">{tab.title}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleCloseTab(e, tab.tabId)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded text-neutral-500 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {/* Add Tab Button */}
                <button
                  type="button"
                  onClick={handleCreateNewTab}
                  className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-900 rounded-md ml-1 transition-colors"
                  title="New Tab"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Chrome Address Bar & Extension Action Strip */}
              <div className="px-3 py-2 bg-neutral-900 flex items-center gap-2 border-b border-neutral-800 relative">
                {/* Back / Forward / Refresh */}
                <div className="flex items-center gap-1 text-neutral-400">
                  <button type="button" className="p-1 hover:text-white rounded">
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="p-1 hover:text-white rounded">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate(addressBarInput)}
                    className="p-1 hover:text-white rounded"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Omnibox / Address Bar Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleNavigate(addressBarInput);
                  }}
                  className="flex-1 relative"
                >
                  <input
                    type="text"
                    value={addressBarInput}
                    onChange={(e) => setAddressBarInput(e.target.value)}
                    placeholder="Enter URL or search destination..."
                    className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-full text-xs font-mono text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-600 pl-8 transition-colors"
                  />
                  <Globe className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
                </form>

                {/* Chrome Extension Toolbar Icon (The Task Boundary Enforcer Action) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsPopupOpen(!isPopupOpen)}
                    className={`relative p-1.5 rounded-md border transition-colors flex items-center justify-center ${
                      isPopupOpen || (activeSession && activeSession.status === 'active')
                        ? 'bg-neutral-800 border-neutral-600 text-white shadow'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                    title="Task Boundary Enforcer Extension"
                  >
                    <Shield className="w-4 h-4 text-emerald-400" />
                    {activeSession && activeSession.status === 'active' && (
                      <span className="absolute -top-1 -right-1 px-1 bg-emerald-500 text-neutral-950 text-[9px] font-bold font-mono rounded">
                        ON
                      </span>
                    )}
                  </button>

                  {/* Dropdown Real Extension Popup Container */}
                  {isPopupOpen && (
                    <div className="absolute top-10 right-0 z-40 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150">
                      <Popup
                        onOpenOptions={() => {
                          setAppMode('options_only');
                          setIsPopupOpen(false);
                        }}
                        onSessionChange={(s) => setActiveSession(s)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Simulated Browser Webpage Viewport */}
              <div className="min-h-[500px] bg-neutral-950 relative flex flex-col justify-center items-center">
                {currentTabIsBlocked && blockedDetails ? (
                  /* VIOLATION PAGE EMBED */
                  <div className="w-full h-full flex-1">
                    <BlockedPage
                      initialGoal={blockedDetails.goal}
                      initialAttemptedUrl={blockedDetails.attempted}
                      initialDomain={blockedDetails.domain}
                      initialRemainingMinutes={blockedDetails.remaining}
                      onReturnToSession={() => {
                        setCurrentTabIsBlocked(false);
                        const safeTab = simulatedTabs.find(
                          (t) =>
                            activeSession &&
                            DomainValidator.isAllowedDomain(t.url, activeSession.allowedDomains)
                        ) || simulatedTabs[0];
                        if (safeTab) {
                          setActiveTabId(safeTab.tabId);
                        }
                      }}
                      onEndSession={async () => {
                        await SessionManager.endSession('ended_early');
                        setActiveSession(null);
                        setCurrentTabIsBlocked(false);
                      }}
                    />
                  </div>
                ) : (
                  /* STANDARD APPROVED WEBPAGE VIEW */
                  <div className="max-w-xl text-center p-8 space-y-4">
                    <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-neutral-800 mx-auto flex items-center justify-center">
                      <Globe className="w-6 h-6 text-neutral-400" />
                    </div>
                    <div>
                      <div className="text-xs uppercase font-mono tracking-wider text-emerald-400 mb-1">
                        Active Workspace Context
                      </div>
                      <h2 className="text-lg font-bold text-white">
                        {currentTab?.title || 'Blank Workspace'}
                      </h2>
                      <p className="text-xs font-mono text-neutral-400 mt-1">
                        {currentTab?.url}
                      </p>
                    </div>

                    <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-lg text-xs text-neutral-400 leading-relaxed text-left space-y-2">
                      <div className="flex items-center gap-2 text-white font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Domain verified: {currentTab?.domain}</span>
                      </div>
                      <p className="text-[11px]">
                        This tab is within the active workspace whitelist. You can navigate between subdomains,
                        open new tabs within approved domains, or inspect documentation.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. ISOLATED POPUP VIEW */}
        {appMode === 'popup_only' && (
          <div className="min-h-[600px] flex flex-col justify-center items-center p-8">
            <div className="mb-4 text-center">
              <span className="text-xs font-mono text-neutral-400">
                Extension Action Popup (380px Viewport)
              </span>
            </div>
            <Popup
              onOpenOptions={() => setAppMode('options_only')}
              onSessionChange={(s) => setActiveSession(s)}
            />
          </div>
        )}

        {/* 3. ISOLATED OPTIONS & ANALYTICS VIEW */}
        {appMode === 'options_only' && <Options />}

        {/* 4. ISOLATED BLOCKED PAGE VIOLATION VIEW */}
        {appMode === 'blocked_only' && (
          <BlockedPage
            initialGoal="Fix payment service incident and trace retry storm"
            initialAttemptedUrl="https://youtube.com/watch?v=dQw4w9WgXcQ"
            initialDomain="youtube.com"
            initialRemainingMinutes={37}
            onReturnToSession={() => setAppMode('simulator')}
            onEndSession={() => setAppMode('simulator')}
          />
        )}

        {/* 5. EXTENSION ARCHITECTURE & FILES */}
        {appMode === 'code_inspect' && (
          <div className="max-w-5xl mx-auto p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white mb-1">
                Extension Architecture & Production File Tree
              </h2>
              <p className="text-xs text-neutral-400">
                Complete Manifest V3 implementation structured for enterprise packaging and Chrome Web Store submission.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* File Tree */}
              <div className="p-5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <FileCode2 className="w-4 h-4 text-neutral-300" />
                  <span>Module Structure</span>
                </div>
                <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg text-xs font-mono text-neutral-300 overflow-x-auto leading-relaxed">
{`task-boundary-enforcer/
├── manifest.json                  # Manifest V3 configuration
├── package.json                   # Dependencies & build scripts
├── vite.config.ts                 # Multi-entry build pipeline
├── src/
│   ├── background/
│   │   └── service-worker.ts      # Navigation interception & alarm worker
│   ├── core/
│   │   ├── DomainValidator.ts     # Domain normalization & matching
│   │   ├── PolicyEngine.ts        # Instant tab kill & violation logic
│   │   ├── SessionManager.ts      # Tab harvesting & badge management
│   │   └── storage.ts             # Typed storage & persistence layer
│   ├── popup/
│   │   └── Popup.tsx              # Extension Action UI (Linear design)
│   ├── options/
│   │   └── Options.tsx            # Analytics dashboard & policies
│   ├── pages/
│   │   └── BlockedPage.tsx        # Recovery violation screen
│   └── types/
│       └── session.ts             # Session, Violation & Settings types
├── popup.html                     # Popup entrypoint
├── options.html                   # Options & analytics entrypoint
└── blocked.html                   # Intercepted violation entrypoint`}
                </pre>
              </div>

              {/* Edge Case Handling Matrix */}
              <div className="p-5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Edge Cases & Anti-Circumvention Policy</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 rounded-md">
                    <span className="font-mono font-medium text-white block">Subdomain Matching</span>
                    <span className="text-[11px] text-neutral-400">
                      Approving <code className="text-neutral-200">github.com</code> automatically allows{' '}
                      <code className="text-neutral-200">docs.github.com</code> and{' '}
                      <code className="text-neutral-200">api.github.com</code>. But approving a specific subdomain like{' '}
                      <code className="text-neutral-200">jira.company.com</code> does NOT allow other subdomains or root.
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 rounded-md">
                    <span className="font-mono font-medium text-white block">Zero-Delay Tab Termination</span>
                    <span className="text-[11px] text-neutral-400">
                      When switching to an unapproved tab via <code className="text-neutral-200">chrome.tabs.onActivated</code>,
                      it is removed immediately via <code className="text-neutral-200">chrome.tabs.remove</code> with zero delay and no confirm box.
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 rounded-md">
                    <span className="font-mono font-medium text-white block">Browser Restart Restoration</span>
                    <span className="text-[11px] text-neutral-400">
                      Session states and remaining duration survive browser crashes and restarts via persistent storage and <code className="text-neutral-200">chrome.runtime.onStartup</code>.
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 rounded-md">
                    <span className="font-mono font-medium text-white block">Incognito Shield</span>
                    <span className="text-[11px] text-neutral-400">
                      Detects new incognito windows via <code className="text-neutral-200">chrome.windows.onCreated</code>,
                      closes them instantly, and logs a violation attempt.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
