# PeekScout Social Agent — provider recruitment

Standalone cold-outreach agent for [PeekScout](https://github.com/danelas/Showcase).
It finds real local providers on Google Places, **creates an unclaimed draft
profile for each in the shared PeekScout database**, and emails the owner a claim
link — so the pitch ("I already set up a profile for you") is literally true.

```
discover.ts  →  outreach_prospects (Postgres)  →  outreach.ts
  (Places + scrape email,      (NEW rows)          (create draft Provider +
   inserts NEW rows)                                claimToken, email claim link,
                                                    mark SENT)
```

The draft Provider is created with **no media**, so it stays invisible in the
PeekScout feed (which requires a video or gallery) until the provider claims it at
`/claim/<token>` and adds their reel. No junk ever shows publicly. In dry-run
**no** profile is created.

## How it relates to the app

This agent talks directly to the **same Supabase Postgres** the PeekScout app
uses, via its own copy of the Prisma schema. It only ever:
- **reads** `categories`,
- **inserts** into `providers` (unclaimed drafts),
- **reads/writes** `outreach_prospects`.

It never runs `prisma db push`, so it can't alter or drop the app's tables. The
`outreach_prospects` table is created idempotently by `npm run db:init`
(`prisma/create-outreach-table.sql`).

## Setup

1. `npm install` (runs `prisma generate`).
2. Copy `.env.example` → `.env` and fill in:
   - `POSTGRES_PRISMA_URL` + `POSTGRES_URL_NON_POOLING` — from the PeekScout app's
     Vercel env (the same shared DB).
   - `GOOGLE_MAPS_API_KEY` (or `GOOGLE_PLACES_API_KEY`) — Places API (New) enabled.
   - `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — verified sending domain.
   - `NEXT_PUBLIC_APP_URL` — live PeekScout domain (for the `/claim/<token>` links).
3. `npm run db:init` — create the `outreach_prospects` table (once).

## Usage

```bash
# Discover today's rotating city (all categories, business + solo queries):
npm run recruit:discover

# Specific city / category, or back-fill across N cities:
npx tsx src/recruit/discover.ts --city Miami --category "Med Spa & Aesthetics"
npx tsx src/recruit/discover.ts --cities 5
npx tsx src/recruit/discover.ts --solo          # solo/independent queries only
npx tsx src/recruit/discover.ts --no-emails     # faster first-pass collection

# Preview sends (dry-run — creates NO profiles):
npm run recruit:send

# Actually create profiles + send (cap 20):
npx tsx src/recruit/outreach.ts --live --max 20
```

## Cron

[`.github/workflows/recruit.yml`](.github/workflows/recruit.yml) runs daily at
15:00 UTC: ensure table → discover → send up to 20. Add these repo secrets:

| Secret | Notes |
|---|---|
| `POSTGRES_PRISMA_URL` | Pooled URL — shared PeekScout DB |
| `POSTGRES_URL_NON_POOLING` | Direct URL — for `db:init` |
| `GOOGLE_MAPS_API_KEY` | Or `GOOGLE_PLACES_API_KEY`. Places API (New) enabled |
| `RESEND_API_KEY` | Cold-email sends |
| `RESEND_FROM_EMAIL` | Verified domain, e.g. `Dan <dan@domain.com>` |
| `NEXT_PUBLIC_APP_URL` | Live PeekScout domain |
| `RECRUIT_BRAND` | Optional. Public name in the email copy (default "PeekScout") |

## Categories & queries

[`src/recruit/targets.ts`](src/recruit/targets.ts) — med-spa / aesthetics leads,
then the rest of the video-strong service set. Each category has **business** and
**solo** query sets; the daily run uses both. Category names must match the
PeekScout `Category.name` values.

## Notes / limits

- Email scrape only checks `/`, `/contact`, `/contact-us`, `/about`, `/book`.
  Sites hiding email behind a JS form yield none and are skipped.
- If someone replies "no thanks", delete their seeded profile in the app
  (`DELETE /api/admin/providers?slug=…`) and set the prospect's `status` to `UNSUB`.
- Places API (New) ~$32/1k calls; a daily run is a few dollars at most. Resend
  free tier (100/day) covers the 20/day cap.
