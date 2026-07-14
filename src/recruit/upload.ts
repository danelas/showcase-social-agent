/**
 * Upload a rendered file to Supabase Storage via the app's public sign
 * endpoint (POST /api/upload/sign → { uploadUrl, publicUrl }, then PUT the
 * bytes to uploadUrl). No storage keys needed in the recruiter.
 */
import { readFile } from "fs/promises";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function uploadMedia(
  localPath: string,
  kind: "video" | "image",
  ext: string,
  mime: string,
): Promise<string | null> {
  try {
    const signRes = await fetch(`${APP_URL}/api/upload/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ext }),
    });
    if (!signRes.ok) return null;
    const { uploadUrl, publicUrl } = (await signRes.json()) as {
      uploadUrl?: string;
      publicUrl?: string;
    };
    if (!uploadUrl || !publicUrl) return null;

    const body = await readFile(localPath);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime, "x-upsert": "true" },
      body,
    });
    if (!put.ok) return null;
    return publicUrl;
  } catch {
    return null;
  }
}
