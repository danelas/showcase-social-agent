/**
 * Provider discovery — walks (city × category) on Google Places, scrapes an
 * email from each business website, and records NEW prospects in Postgres.
 * No profile is created here; that happens at send time (outreach.ts), so the
 * "we created you a profile" pitch is truthful and we don't seed junk rows for
 * businesses we never contact.
 *
 * Daily cron (default): today's rotating city, all categories, both query sets.
 *
 *   npx tsx scripts/recruit/discover.ts
 *   npx tsx scripts/recruit/discover.ts --city Miami --category "Med Spa & Aesthetics"
 *   npx tsx scripts/recruit/discover.ts --cities 5          # first N cities
 *   npx tsx scripts/recruit/discover.ts --business          # business queries only
 *   npx tsx scripts/recruit/discover.ts --solo              # solo queries only
 *   npx tsx scripts/recruit/discover.ts --no-emails         # skip email scrape
 */
// Prisma auto-loads .env at import time (see db.ts → PrismaClient), so env vars
// are available without a separate dotenv import.
import { searchPlaces, type PlaceLead } from "./places";
import { scrapeEmails } from "./scrape-email";
import { CITIES, todaysCities, type City } from "./cities";
import { TARGETS, type Target } from "./targets";
import { getKnownPlaceKeys, insertProspect, prisma, type Prospect } from "./db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isRoleAddr(addr: string): boolean {
  const local = addr.split("@")[0]?.toLowerCase() ?? "";
  return /^(info|contact|hello|hi|admin|support|booking|appointments|team|office|owner|sales|reception)$/.test(local);
}
function pickFirstEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;
  return [...emails].sort((a, b) => (isRoleAddr(a) ? 1 : 0) - (isRoleAddr(b) ? 1 : 0))[0];
}

function queriesFor(t: Target, mode: "business" | "solo" | "all"): string[] {
  if (mode === "business") return t.business;
  if (mode === "solo") return t.solo;
  return [...t.business, ...t.solo];
}

async function main() {
  const onlyCity = arg("city");
  const onlyCategory = arg("category");
  const cityCount = arg("cities") ? Number(arg("cities")) : null;
  const maxPages = Number(arg("max-pages") ?? "2");
  const skipEmails = flag("no-emails");
  const mode: "business" | "solo" | "all" = flag("business")
    ? "business"
    : flag("solo")
      ? "solo"
      : "all";

  let cities: City[];
  if (onlyCity) {
    const match = CITIES.find(
      (c) => c.name.toLowerCase() === onlyCity.toLowerCase() || c.slug === onlyCity.toLowerCase(),
    );
    if (!match) {
      console.error(`Unknown city "${onlyCity}". Examples: ${CITIES.slice(0, 5).map((c) => c.name).join(", ")}`);
      process.exit(1);
    }
    cities = [match];
  } else if (cityCount) {
    cities = todaysCities(cityCount);
  } else {
    cities = todaysCities();
  }

  let targets = TARGETS;
  if (onlyCategory) {
    targets = TARGETS.filter((t) => t.categoryName.toLowerCase() === onlyCategory.toLowerCase());
    if (targets.length === 0) {
      console.error(`Unknown category "${onlyCategory}". Valid: ${TARGETS.map((t) => t.categoryName).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(
    `[recruit] discover · ${cities.map((c) => c.name).join(", ")} · ${targets.length} categories · queries: ${mode}`,
  );
  if (skipEmails) console.log(`[recruit] --no-emails: skipping email scrape`);

  const known = await getKnownPlaceKeys();
  console.log(`[recruit] ${known.size} prospects in db; deduping by place_id\n`);

  let totalSeen = 0;
  let totalNew = 0;
  let totalWithEmail = 0;

  for (const city of cities) {
    for (const t of targets) {
      for (const tmpl of queriesFor(t, mode)) {
        const query = `${tmpl} in ${city.name}, ${city.stateCode}`;
        process.stdout.write(`  • ${query} … `);
        let places: PlaceLead[];
        try {
          places = await searchPlaces({ query, maxPages });
        } catch (e) {
          console.log(`error: ${(e as Error).message}`);
          continue;
        }

        let added = 0;
        for (const p of places) {
          totalSeen++;
          if (known.has(p.id)) continue;
          known.add(p.id);

          let emails: string[] = [];
          if (!skipEmails && p.website) {
            try {
              emails = await scrapeEmails(p.website);
            } catch {
              emails = [];
            }
          }
          const primaryEmail = pickFirstEmail(emails);
          if (primaryEmail) totalWithEmail++;

          const prospect: Prospect = {
            placeKey: p.id,
            name: p.name,
            categoryName: t.categoryName,
            city: city.name,
            state: city.stateCode,
            address: p.address,
            phone: p.phone,
            website: p.website,
            emails,
            primaryEmail,
            query,
          };
          try {
            await insertProspect(prospect);
            added++;
            totalNew++;
          } catch (e) {
            console.log(`\n    insert failed for ${p.name}: ${(e as Error).message}`);
          }
        }
        console.log(`${places.length} found, ${added} new`);
      }
    }
  }

  console.log(`\n[recruit] discover done`);
  console.log(`         seen:          ${totalSeen}`);
  console.log(`         new prospects: ${totalNew}`);
  console.log(`         with email:    ${totalWithEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
