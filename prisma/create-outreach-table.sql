-- One-time creation of the outreach_prospects table in the shared PeekScout
-- Postgres. Mirrors the Prisma OutreachProspect model exactly (camelCase,
-- quoted columns) so this agent and the PeekScout app agree on the schema.
--
-- Run once:  npm run db:init
-- Safe to re-run (IF NOT EXISTS). Does NOT touch any other table.

CREATE TABLE IF NOT EXISTS "outreach_prospects" (
  "id"           UUID          NOT NULL,
  "placeKey"     TEXT          NOT NULL,
  "name"         TEXT          NOT NULL,
  "categoryName" TEXT          NOT NULL,
  "city"         TEXT          NOT NULL,
  "state"        TEXT,
  "address"      TEXT,
  "phone"        TEXT,
  "website"      TEXT,
  "emails"       TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "primaryEmail" TEXT,
  "status"       TEXT          NOT NULL DEFAULT 'NEW',
  "providerId"   UUID,
  "claimToken"   TEXT,
  "resendId"     TEXT,
  "sendError"    TEXT,
  "query"        TEXT,
  "emailVariant" TEXT,
  "scrapedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"       TIMESTAMP(3),
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outreach_prospects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_prospects_placeKey_key" ON "outreach_prospects" ("placeKey");
CREATE INDEX IF NOT EXISTS "outreach_prospects_status_idx"       ON "outreach_prospects" ("status");
CREATE INDEX IF NOT EXISTS "outreach_prospects_categoryName_idx" ON "outreach_prospects" ("categoryName");
CREATE INDEX IF NOT EXISTS "outreach_prospects_city_idx"         ON "outreach_prospects" ("city");
