// Upload-Post VIDEO client. Posts a finished .mp4 to social platforms via
// https://api.upload-post.com/api/upload. Ported from the garage-door agent's
// photo client, adapted to the video endpoint + Reels/Shorts specifics.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const API_BASE = "https://api.upload-post.com/api";

export type PostInput = {
  mediaPath: string;
  title: string;
  caption: string;
  platforms: string[];
};

function authHeader(): Record<string, string> {
  const key = (process.env.UPLOAD_POST_API_KEY ?? "").trim();
  if (!key) throw new Error("UPLOAD_POST_API_KEY not set");
  return { Authorization: `Apikey ${key}` };
}

function userProfile(): string {
  const user = (process.env.UPLOAD_POST_USER ?? "").trim();
  if (!user) throw new Error("UPLOAD_POST_USER not set (profile name in your Upload-Post dashboard)");
  return user;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const POLL_MAX_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 6 * 1000;
const TERMINAL = new Set(["completed", "complete", "success", "succeeded", "failed", "error", "rejected", "posted", "published"]);

async function pollStatus(requestId: string): Promise<unknown> {
  const url = `${API_BASE}/uploadposts/status?request_id=${encodeURIComponent(requestId)}`;
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < POLL_MAX_MS) {
    await sleep(POLL_INTERVAL_MS);
    const resp = await fetch(url, { headers: authHeader() });
    if (!resp.ok) {
      console.warn(`[upload-post] status poll HTTP ${resp.status}`);
      continue;
    }
    const text = await resp.text();
    try { last = JSON.parse(text); } catch { last = text; }
    console.log(`[upload-post] status:`, JSON.stringify(last));
    if (last && typeof last === "object") {
      const o = last as Record<string, unknown>;
      const top = String(o.status ?? o.state ?? "").toLowerCase();
      if (TERMINAL.has(top)) return last;
    }
  }
  throw new Error(`Upload-Post status poll timed out (request_id ${requestId}).`);
}

export async function postVideo(input: PostInput): Promise<unknown> {
  if (input.platforms.length === 0) throw new Error("No platforms to post to.");

  const fileBuf = await readFile(input.mediaPath);
  const form = new FormData();
  form.append("user", userProfile());
  for (const p of input.platforms) form.append("platform[]", p);
  form.append("video", new Blob([fileBuf]), basename(input.mediaPath));
  form.append("title", input.title.slice(0, 90));
  form.append("description", input.caption);
  form.append("caption", input.caption);

  // Vertical short-form defaults.
  if (input.platforms.includes("instagram")) form.append("media_type", "REELS");
  if (input.platforms.includes("tiktok")) {
    form.append("privacy_level", process.env.TIKTOK_PRIVACY_LEVEL || "PUBLIC_TO_EVERYONE");
  }
  if (input.platforms.includes("facebook")) {
    const pageId = (process.env.FACEBOOK_PAGE_ID ?? "").trim();
    if (!pageId) throw new Error("FACEBOOK_PAGE_ID required to post to Facebook.");
    form.append("facebook_page_id", pageId);
    form.append("facebook_media_type", process.env.FACEBOOK_MEDIA_TYPE || "REELS");
  }

  console.log(`[upload-post] posting video to: ${input.platforms.join(", ")} (profile "${userProfile()}")`);
  const resp = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: authHeader(),
    body: form,
  });

  const bodyText = await resp.text();
  if (!resp.ok) throw new Error(`upload-post HTTP ${resp.status}: ${bodyText}`);

  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  console.log(`[upload-post] response:`, JSON.stringify(body, null, 2));

  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const requestId = obj.request_id;
    if (typeof requestId === "string" && requestId.length > 0) {
      console.log(`[upload-post] async handoff (request_id=${requestId}); polling…`);
      body = await pollStatus(requestId);
    }
  }

  // Surface per-platform failures even on HTTP 200.
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const failed: string[] = [];
    for (const platform of input.platforms) {
      const r = obj[platform];
      if (r && typeof r === "object") {
        const pr = r as Record<string, unknown>;
        const status = String(pr.status ?? pr.state ?? "").toLowerCase();
        const error = pr.error ?? pr.message;
        if (error || status === "failed" || status === "error" || status === "rejected") {
          failed.push(`${platform}: ${typeof error === "string" ? error : status || "unknown"}`);
        }
      }
    }
    const topStatus = String(obj.status ?? "").toLowerCase();
    if (topStatus === "failed" || topStatus === "error") failed.push(`overall: ${topStatus}`);
    if (failed.length > 0) {
      throw new Error(`Upload-Post reported failures:\n  ${failed.join("\n  ")}`);
    }
  }

  return body;
}
