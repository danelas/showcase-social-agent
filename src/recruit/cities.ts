// City rotation for provider recruitment. Focused on the operator's target
// markets: South Florida (Miami / Fort Lauderdale), New York, and California
// (spread across its main metros). One city per daily cron run; the list
// cycles every ~10 days so each market gets hit a few times a month.
export type City = { slug: string; name: string; stateCode: string };

export const CITIES: City[] = [
  { slug: "miami", name: "Miami", stateCode: "FL" },
  { slug: "fort-lauderdale", name: "Fort Lauderdale", stateCode: "FL" },
  { slug: "new-york", name: "New York", stateCode: "NY" },
  { slug: "los-angeles", name: "Los Angeles", stateCode: "CA" },
  { slug: "san-diego", name: "San Diego", stateCode: "CA" },
  { slug: "beverly-hills", name: "Beverly Hills", stateCode: "CA" },
  { slug: "orange-county", name: "Newport Beach", stateCode: "CA" },
  { slug: "san-francisco", name: "San Francisco", stateCode: "CA" },
  { slug: "san-jose", name: "San Jose", stateCode: "CA" },
];

/** How many cities each daily run sweeps. */
export const DAILY_CITIES = 3;

function dayOfYear(): number {
  const start = new Date(new Date().getFullYear(), 0, 0);
  return Math.floor((Date.now() - start.getTime()) / 86_400_000);
}

/** Day-of-year rotation — same city all day, cycles through the list monthly. */
export function todaysCity(): City {
  return CITIES[dayOfYear() % CITIES.length];
}

/**
 * A MIX of cities for today's run. One city per day meant whichever market got
 * discovered first kept supplying the oldest (and therefore first-sent)
 * prospects, so signups clustered in a single metro. Sweeping several markets a
 * day — and walking the window forward by `count` — keeps every market fed and
 * still cycles the whole list every few days.
 */
export function todaysCities(count = DAILY_CITIES): City[] {
  const n = Math.max(1, Math.min(count, CITIES.length));
  const start = (dayOfYear() * n) % CITIES.length;
  return Array.from({ length: n }, (_, i) => CITIES[(start + i) % CITIES.length]);
}
