/**
 * Google Places API (New) — Text Search. Ported from Gold Touch List's recruit
 * engine. Auth reuses GOOGLE_MAPS_API_KEY (the app already uses it for geocode);
 * the key needs the Places API (New) enabled in the same Google Cloud project.
 *
 * Field-masked to keep the response — and the bill — small. Each call returns up
 * to 20 places, paginated via nextPageToken (Google caps a query at 60 total).
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export type PlaceLead = {
  id: string; // place_id, stable across queries → dedupe key
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

type SearchResponse = {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
  }>;
  nextPageToken?: string;
};

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("Set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) in env");
  }
  return key;
}

export async function searchPlaces(opts: {
  query: string;
  maxPages?: number; // each page = up to 20 results, max 3 pages = 60
}): Promise<PlaceLead[]> {
  const apiKey = getApiKey();
  const maxPages = Math.min(opts.maxPages ?? 3, 3);
  const out: PlaceLead[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = { textQuery: opts.query };
    if (pageToken) body.pageToken = pageToken;

    const resp = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Places API ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = (await resp.json()) as SearchResponse;

    for (const p of data.places ?? []) {
      if (!p.id) continue;
      out.push({
        id: p.id,
        name: p.displayName?.text ?? "(unnamed)",
        address: p.formattedAddress ?? "",
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? null,
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    // Google requires a brief wait before nextPageToken becomes valid.
    await new Promise((r) => setTimeout(r, 2000));
  }

  return out;
}
