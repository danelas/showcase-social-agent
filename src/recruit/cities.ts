// City rotation for provider recruitment. Med-spa / aesthetics ad culture is
// densest in FL, TX, CA, AZ, NY — front-loaded here. One city per daily cron
// run; the full list cycles roughly once a month.
export type City = { slug: string; name: string; stateCode: string };

export const CITIES: City[] = [
  { slug: "miami", name: "Miami", stateCode: "FL" },
  { slug: "fort-lauderdale", name: "Fort Lauderdale", stateCode: "FL" },
  { slug: "boca-raton", name: "Boca Raton", stateCode: "FL" },
  { slug: "west-palm-beach", name: "West Palm Beach", stateCode: "FL" },
  { slug: "tampa", name: "Tampa", stateCode: "FL" },
  { slug: "orlando", name: "Orlando", stateCode: "FL" },
  { slug: "scottsdale", name: "Scottsdale", stateCode: "AZ" },
  { slug: "phoenix", name: "Phoenix", stateCode: "AZ" },
  { slug: "dallas", name: "Dallas", stateCode: "TX" },
  { slug: "houston", name: "Houston", stateCode: "TX" },
  { slug: "austin", name: "Austin", stateCode: "TX" },
  { slug: "los-angeles", name: "Los Angeles", stateCode: "CA" },
  { slug: "san-diego", name: "San Diego", stateCode: "CA" },
  { slug: "beverly-hills", name: "Beverly Hills", stateCode: "CA" },
  { slug: "las-vegas", name: "Las Vegas", stateCode: "NV" },
  { slug: "new-york", name: "New York", stateCode: "NY" },
  { slug: "atlanta", name: "Atlanta", stateCode: "GA" },
  { slug: "nashville", name: "Nashville", stateCode: "TN" },
  { slug: "denver", name: "Denver", stateCode: "CO" },
  { slug: "chicago", name: "Chicago", stateCode: "IL" },
  { slug: "charlotte", name: "Charlotte", stateCode: "NC" },
  { slug: "seattle", name: "Seattle", stateCode: "WA" },
];

/** Day-of-year rotation — same city all day, cycles through the list monthly. */
export function todaysCity(): City {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86_400_000);
  return CITIES[dayOfYear % CITIES.length];
}
