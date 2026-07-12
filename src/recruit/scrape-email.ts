/**
 * Best-effort email extraction from a provider's homepage + /contact page.
 * Ported from Gold Touch List. No headless browser — fetch the HTML and regex
 * it. Trades coverage for speed and cost; sites that hide email behind a JS
 * form return [] and get skipped.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Hostnames whose emails are platform-noise, not the business's contact.
const BLOCKLIST = [
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "godaddy.com",
  "squarespace.com",
  "shopify.com",
  "googleapis.com",
  "google.com",
  "gstatic.com",
  "cloudflare.com",
  "facebook.com",
  "instagram.com",
  "example.com",
  "yourdomain.com",
  "domain.com",
  "email.com",
  "test.com",
  "sentry.wixpress.com",
];

const PATH_CANDIDATES = ["", "/contact", "/contact-us", "/about", "/book"];

const TIMEOUT_MS = 8000;
const MAX_BYTES = 250_000;

async function fetchBounded(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PeekScoutBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text") && !ct.includes("html")) return null;
    const buf = await resp.arrayBuffer();
    const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function isPlausibleBusinessEmail(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".gif")) return false;
  if (lower.includes("@2x") || lower.includes("@3x")) return false; // image asset names
  if (/^[a-f0-9]{8,}@/.test(lower)) return false; // hex blob
  const domain = lower.split("@")[1];
  if (!domain) return false;
  if (BLOCKLIST.some((b) => domain === b || domain.endsWith("." + b))) return false;
  return true;
}

export async function scrapeEmails(website: string): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const path of PATH_CANDIDATES) {
    const url = new URL(path, base.origin).toString();
    const html = await fetchBounded(url);
    if (!html) continue;
    const matches = html.match(EMAIL_RE) ?? [];
    for (const m of matches) {
      if (isPlausibleBusinessEmail(m)) found.add(m.toLowerCase());
    }
    // If we already have something usable, no need to crawl deeper.
    if (found.size > 0 && path !== "") break;
  }

  return Array.from(found);
}
