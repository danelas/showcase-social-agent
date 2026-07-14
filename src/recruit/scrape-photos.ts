/**
 * Best-effort photo extraction from a provider's homepage — og:image /
 * twitter:image first (usually the hero shot), then content <img> tags.
 * Used to pre-fill a recruited profile's gallery so it can go live as a
 * slideshow reel the instant the owner claims it — no video required.
 *
 * These photos are only ever DISPLAYED after the owner claims (the draft is
 * created isActive:false), so nothing of theirs is published without consent.
 */

const TIMEOUT_MS = 8000;
const MAX_BYTES = 400_000;

async function fetchHtml(url: string): Promise<string | null> {
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

// Substrings that mark an image as chrome/branding/third-party, not content.
const BAD_HINTS = [
  "logo", "icon", "favicon", "sprite", "pixel", "spinner", "loader",
  "placeholder", "avatar", "badge", "1x1", "transparent", "loading",
  "arrow", "chevron", "close", "menu", "hamburger", "cart", "search",
  "nav", "user", "header", "footer", "flag", "star", "rating", "review",
  // third-party badges/logos that pollute galleries
  "yelp", "google", "facebook", "instagram", "twitter", "tiktok", "youtube",
  "allergan", "brand", "partner", "sponsor", "seal", "trust", "award",
  "payment", "visa", "mastercard", "amex", "paypal", "stripe",
  // social-share cards (text overlays, not real photos)
  "share", "sharing", "seo", "og-", "og_", "opengraph",
];

// URL path segments / hosts that are theme assets, icons, or parked-domain
// placeholders — never real business photos.
const BAD_PATHS = [
  "/theme/", "/themes/", "/plugins/", "/wp-includes/", "/assets/icons",
  "ico.", "-ico", "ico-", "_ico",
  // parked / for-sale domain placeholder hosts
  "hugedomains", "sedoparking", "parkingcrew", "afternic", "bodis",
  "dan.com", "/parking",
];

function plausiblePhoto(u: string): boolean {
  const lower = u.toLowerCase();
  if (lower.startsWith("data:")) return false;
  if (lower.endsWith(".svg") || lower.endsWith(".gif")) return false;
  if (BAD_PATHS.some((p) => lower.includes(p))) return false;
  if (BAD_HINTS.some((h) => lower.includes(h))) return false;
  // Must look like a real raster image URL.
  return /\.(jpe?g|png|webp)(\?|#|$)/.test(lower);
}

export async function scrapePhotos(website: string, max = 5): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return [];
  }
  const html = await fetchHtml(base.origin);
  if (!html) return [];

  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    if (!raw || found.length >= max) return;
    let abs: string;
    try {
      abs = new URL(raw, base.origin).toString();
    } catch {
      return;
    }
    if (seen.has(abs) || !plausiblePhoto(abs)) return;
    seen.add(abs);
    found.push(abs);
  };

  // 1. og:image / twitter:image — the curated hero image(s).
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)[^>]*>/gi,
  )) {
    const content = m[0].match(/content=["']([^"']+)["']/i);
    if (content) push(content[1]);
  }
  // 2. Content <img> tags, in document order.
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    push(m[1]);
    if (found.length >= max) break;
  }

  return found;
}
