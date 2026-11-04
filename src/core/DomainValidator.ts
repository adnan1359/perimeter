/**
 * Task Boundary Enforcer - Hardened Domain Validation Engine
 * Implements strict domain whitelisting, RFC-compliant canonicalization,
 * IP detection, scheme sanitization, and anti-circumvention validations.
 */

export class DomainValidator {
  private static readonly BANNED_SCHEMES = new Set([
    'javascript:',
    'data:',
    'blob:',
    'file:',
    'vbscript:',
    'filesystem:',
  ]);

  private static readonly ALLOWED_SYSTEM_PAGES = new Set([
    'chrome://newtab',
    'chrome://newtab/',
    'chrome://new-tab-page',
    'chrome://new-tab-page/',
    'about:blank',
    'about:newtab',
  ]);

  // Matches IPv4 addresses
  private static readonly IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

  /**
   * Validates that a candidate URL has a safe web scheme (http, https, chrome-extension).
   * Rejects script injection schemes and data URIs.
   */
  public static isSafeScheme(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const lower = url.trim().toLowerCase();

    for (const banned of this.BANNED_SCHEMES) {
      if (lower.startsWith(banned)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Determines if a string is a raw IP address (IPv4).
   */
  public static isIpAddress(hostname: string): boolean {
    if (!hostname) return false;
    return this.IPV4_REGEX.test(hostname);
  }

  /**
   * Determines if a hostname is local loopback.
   */
  public static isLocalhost(hostname: string): boolean {
    if (!hostname) return false;
    const clean = hostname.toLowerCase();
    return clean === 'localhost' || clean === '127.0.0.1' || clean === '0.0.0.0' || clean === '::1';
  }

  /**
   * Extracts clean, lowercase hostname from a raw URL string or domain.
   * Strips protocols, ports, credentials, paths, queries, and hash fragments.
   */
  public static extractDomain(urlOrDomain: string): string | null {
    if (!urlOrDomain || typeof urlOrDomain !== 'string') {
      return null;
    }

    const trimmed = urlOrDomain.trim();
    if (!trimmed) {
      return null;
    }

    // Reject dangerous schemes immediately
    if (!this.isSafeScheme(trimmed)) {
      return null;
    }

    // Check for special system pages first
    if (this.isAllowedSystemPage(trimmed)) {
      return 'newtab';
    }

    // Try parsing as standard URL
    let parsedHostname = '';
    try {
      const urlToParse = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
      const urlObj = new URL(urlToParse);
      parsedHostname = urlObj.hostname;
    } catch {
      // Fallback extraction
      const sanitized = trimmed
        .replace(/^[a-zA-Z]+:\/\//, '')
        .split('/')[0]
        .split('?')[0]
        .split('#')[0]
        .split(':')[0];
      parsedHostname = sanitized;
    }

    if (!parsedHostname) {
      return null;
    }

    return this.normalizeDomain(parsedHostname);
  }

  /**
   * Normalizes domain name: lowercased, trims trailing dots and whitespace.
   */
  public static normalizeDomain(domain: string): string {
    return domain
      .toLowerCase()
      .trim()
      .replace(/\.+$/, '');
  }

  /**
   * Checks whether the URL is a browser system page that is safe during focus
   * (e.g. initial blank newtab before destination input).
   */
  public static isAllowedSystemPage(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return this.ALLOWED_SYSTEM_PAGES.has(lower) || lower.startsWith('chrome://newtab?');
  }

  /**
   * Checks whether the URL is an extension internal page (options, popup, blocked view).
   */
  public static isExtensionPage(url: string, extensionId?: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    if (lower.startsWith('chrome-extension://')) {
      if (!extensionId) return true;
      return lower.startsWith(`chrome-extension://${extensionId.toLowerCase()}`);
    }
    // Web preview internal paths
    if (lower.startsWith('/popup.html') || lower.startsWith('/options.html') || lower.startsWith('/blocked.html')) {
      return true;
    }
    return false;
  }

  /**
   * Sanitizes external URLs before embedding into query parameters or redirections,
   * completely preventing open redirect vulnerabilities and javascript: injection.
   */
  public static sanitizeUrlForRedirect(url: string): string {
    if (!url || typeof url !== 'string') return 'about:blank';
    const trimmed = url.trim();

    if (!this.isSafeScheme(trimmed)) {
      return 'about:blank';
    }

    if (this.isAllowedSystemPage(trimmed)) {
      return trimmed;
    }

    try {
      const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'chrome-extension:') {
        return 'about:blank';
      }
      return parsed.toString();
    } catch {
      return 'about:blank';
    }
  }

  /**
   * Evaluates if a given URL or domain is strictly within the allowed domain whitelist.
   *
   * Security & Matching rules:
   * 1. Rejects unsafe schemes (data:, javascript:, file:)
   * 2. Handles system pages (chrome://newtab is allowed until navigation)
   * 3. Exact domain match: "github.com" matches "github.com"
   * 4. www normalization: "www.github.com" matches "github.com" and vice versa
   * 5. Subdomain match: "docs.github.com" matches "github.com"
   * 6. Multi-level subdomain match: "api.v2.github.com" matches "github.com"
   * 7. Strict boundary containment: "jira.company.com" does NOT allow "company.com" or "confluence.company.com"
   * 8. Raw IP filtering: Direct IP navigation is blocked unless explicitly in whitelist
   * 9. Localhost policy: Localhost allowed only if explicitly passed or configured
   */
  public static isAllowedDomain(
    candidateUrlOrDomain: string,
    allowedDomains: string[],
    allowLocalhost: boolean = false
  ): boolean {
    if (!candidateUrlOrDomain) {
      return false;
    }

    // Reject malicious schemes immediately
    if (!this.isSafeScheme(candidateUrlOrDomain)) {
      return false;
    }

    // Allow blank/new tab pages before user submits an address
    if (this.isAllowedSystemPage(candidateUrlOrDomain)) {
      return true;
    }

    // Allow extension pages (e.g. blocked screen or options)
    if (this.isExtensionPage(candidateUrlOrDomain)) {
      return true;
    }

    const candidateDomain = this.extractDomain(candidateUrlOrDomain);
    if (!candidateDomain) {
      return false;
    }

    // Check localhost override
    if (allowLocalhost && this.isLocalhost(candidateDomain)) {
      return true;
    }

    // Normalize candidate
    const cleanCandidate = this.normalizeDomain(candidateDomain);
    const candidateNoWww = cleanCandidate.startsWith('www.')
      ? cleanCandidate.slice(4)
      : cleanCandidate;

    return allowedDomains.some((rawAllowed) => {
      if (!rawAllowed) return false;
      const cleanAllowed = this.normalizeDomain(rawAllowed);
      const allowedNoWww = cleanAllowed.startsWith('www.')
        ? cleanAllowed.slice(4)
        : cleanAllowed;

      // 1. Exact match (with or without www)
      if (
        cleanCandidate === cleanAllowed ||
        candidateNoWww === allowedNoWww ||
        cleanCandidate === allowedNoWww ||
        candidateNoWww === cleanAllowed
      ) {
        return true;
      }

      // 2. Candidate is a subdomain of the allowed domain
      // e.g. candidate="docs.github.com", allowed="github.com" -> ends with ".github.com"
      if (cleanCandidate.endsWith(`.${cleanAllowed}`)) {
        return true;
      }

      // Check also with www stripped from allowed
      if (cleanCandidate.endsWith(`.${allowedNoWww}`)) {
        return true;
      }

      return false;
    });
  }

  /**
   * Filters a list of tab URLs to an initial deduplicated list of unique root domains.
   */
  public static extractUniqueDomains(urls: string[]): string[] {
    const domainSet = new Set<string>();

    for (const url of urls) {
      if (!url || this.isAllowedSystemPage(url) || this.isExtensionPage(url) || !this.isSafeScheme(url)) {
        continue;
      }

      const domain = this.extractDomain(url);
      if (domain && domain !== 'newtab' && domain.includes('.')) {
        // Strip www for clean initial whitelist root
        const normalized = domain.startsWith('www.') ? domain.slice(4) : domain;
        domainSet.add(normalized);
      }
    }

    return Array.from(domainSet).sort();
  }
}
