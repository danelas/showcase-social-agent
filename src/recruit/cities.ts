// City rotation for provider recruitment — the metros with the deepest local
// beauty / wellness / home-services markets, which is where a video-first
// directory recruits best.
//
// ORDER MATTERS: each run takes a window of DAILY_CITIES consecutive entries,
// so the list is deliberately interleaved by region. Three neighbouring
// entries are always in different states, which means every day's sweep is
// geographically mixed instead of, say, three Florida suburbs in a row.
export type City = { slug: string; name: string; stateCode: string };

export const CITIES: City[] = [
  { slug: "miami", name: "Miami", stateCode: "FL" },
  { slug: "los-angeles", name: "Los Angeles", stateCode: "CA" },
  { slug: "dallas", name: "Dallas", stateCode: "TX" },

  { slug: "fort-lauderdale", name: "Fort Lauderdale", stateCode: "FL" },
  { slug: "san-diego", name: "San Diego", stateCode: "CA" },
  { slug: "atlanta", name: "Atlanta", stateCode: "GA" },

  { slug: "orlando", name: "Orlando", stateCode: "FL" },
  { slug: "beverly-hills", name: "Beverly Hills", stateCode: "CA" },
  { slug: "chicago", name: "Chicago", stateCode: "IL" },

  { slug: "tampa", name: "Tampa", stateCode: "FL" },
  { slug: "orange-county", name: "Newport Beach", stateCode: "CA" },
  { slug: "houston", name: "Houston", stateCode: "TX" },

  { slug: "west-palm-beach", name: "West Palm Beach", stateCode: "FL" },
  { slug: "san-francisco", name: "San Francisco", stateCode: "CA" },
  { slug: "phoenix", name: "Phoenix", stateCode: "AZ" },

  { slug: "boca-raton", name: "Boca Raton", stateCode: "FL" },
  { slug: "san-jose", name: "San Jose", stateCode: "CA" },
  { slug: "las-vegas", name: "Las Vegas", stateCode: "NV" },

  { slug: "naples", name: "Naples", stateCode: "FL" },
  { slug: "santa-monica", name: "Santa Monica", stateCode: "CA" },
  { slug: "scottsdale", name: "Scottsdale", stateCode: "AZ" },

  { slug: "new-york", name: "New York", stateCode: "NY" },
  { slug: "irvine", name: "Irvine", stateCode: "CA" },
  { slug: "austin", name: "Austin", stateCode: "TX" },

  { slug: "brooklyn", name: "Brooklyn", stateCode: "NY" },
  { slug: "sacramento", name: "Sacramento", stateCode: "CA" },
  { slug: "denver", name: "Denver", stateCode: "CO" },

  { slug: "boston", name: "Boston", stateCode: "MA" },
  { slug: "seattle", name: "Seattle", stateCode: "WA" },
  { slug: "nashville", name: "Nashville", stateCode: "TN" },

  { slug: "philadelphia", name: "Philadelphia", stateCode: "PA" },
  { slug: "charlotte", name: "Charlotte", stateCode: "NC" },
  { slug: "san-antonio", name: "San Antonio", stateCode: "TX" },
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
