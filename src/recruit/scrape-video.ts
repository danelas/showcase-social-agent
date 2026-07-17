/**
 * Best-effort REAL-video extraction from a provider's homepage.
 *
 * The recruit engine normally renders a synthetic title-card reel for the draft
 * profile. But many local pros already post video — a hosted promo, a YouTube
 * embed, a linked Reel/TikTok. When we can find one, we'd rather pre-build their
 * profile with THEIR actual footage (branded + reformatted by the makeover
 * render) so the "claim it" pitch shows real content, not a slideshow.
 *
 * This only returns a URL; downloading (yt-dlp) + branding (renderMakeover)
 * happens in db.ts at send time. Like the scraped photos, the result is only
 * ever shown after the owner claims (draft is created isActive:false), so
 * nothing of theirs is published without consent.
 */

const TIMEOUT_MS = 8000;
const MAX_BYTES = 600_000;

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

// Background-loop / chrome videos that aren't real "content" we'd want to
// feature. Hero background loops are usually silent, cropped, and generic.
const BAD_VIDEO_HINTS = [
  "background", "bg-", "-bg", "hero-loop", "loop", "banner", "header",
  "placeholder", "spinner", "loader", "loading", "animation", "particles",
];

function plausibleFileVideo(u: string): boolean {
  const lower = u.toLowerCase();
  if (lower.startsWith("data:")) return false;
  if (BAD_VIDEO_HINTS.some((h) => lower.includes(h))) return false;
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/.test(lower);
}

// A platform URL yt-dlp can resolve (real posted content, not a file). Covers
// both watch links and the iframe-embed forms sites actually use (/embed/,
// player.vimeo.com) — most embedded video is an iframe, not a <video> file.
function platformVideo(u: string): boolean {
  return /(?:youtube(?:-nocookie)?\.com\/(?:watch\?|embed\/|shorts\/)|youtu\.be\/|(?:player\.)?vimeo\.com\/(?:video\/)?\d|tiktok\.com\/@[^/]+\/video\/|instagram\.com\/(?:reel|p|tv)\/)/i.test(
    u,
  );
}

/**
 * Return the best real-video URL found on the site, or null. Preference order:
 *   1. og:video / og:video:url / og:video:secure_url (curated share video)
 *   2. a <video><source> or <video src> hosted file
 *   3. a linked YouTube / Vimeo / TikTok / Instagram post (yt-dlp resolves it)
 * Platform links are preferred over silent hero-loop files.
 */
export async function scrapeVideoUrl(website: string): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }
  const html = await fetchHtml(base.origin);
  if (!html) return null;

  const abs = (raw: string | undefined): string | null => {
    if (!raw) return null;
    try {
      return new URL(raw, base.origin).toString();
    } catch {
      return null;
    }
  };

  // 1. og:video meta — the site's own chosen share video.
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["']og:video(?::(?:url|secure_url))?["'][^>]*>/gi,
  )) {
    const content = m[0].match(/content=["']([^"']+)["']/i);
    const u = abs(content?.[1]);
    if (u && (platformVideo(u) || plausibleFileVideo(u))) return u;
  }

  // 2. Hosted <video> files. <source src> first, then <video src>.
  const fileCandidates: string[] = [];
  for (const m of html.matchAll(/<source[^>]+src=["']([^"']+)["']/gi)) {
    const u = abs(m[1]);
    if (u && plausibleFileVideo(u)) fileCandidates.push(u);
  }
  for (const m of html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)) {
    const u = abs(m[1]);
    if (u && plausibleFileVideo(u)) fileCandidates.push(u);
  }

  // 3. Linked platform posts (embeds or anchor hrefs).
  const platformCandidates: string[] = [];
  for (const m of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
    const u = abs(m[1]);
    if (u && platformVideo(u)) platformCandidates.push(u);
  }

  // Prefer a real posted clip over a hosted (often silent) hero file.
  return platformCandidates[0] ?? fileCandidates[0] ?? null;
}
