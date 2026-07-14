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

/** Day-of-year rotation — same city all day, cycles through the list monthly. */
export function todaysCity(): City {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86_400_000);
  return CITIES[dayOfYear % CITIES.length];
}
