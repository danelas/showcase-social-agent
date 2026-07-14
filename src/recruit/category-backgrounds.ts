/**
 * Category-relevant stock backdrops for the branded title card, so a recruited
 * profile's reel opens with a photo that fits their trade (spa, barbershop,
 * nails…) instead of a flat gradient. Vertical Pexels images (hotlink-friendly
 * license, CDN is range + CORS friendly). Multiple per category → variety,
 * picked deterministically by slug so a given provider is stable.
 */
const P = (id: string, file: string) => `https://images.pexels.com/videos/${id}/${file}`;
const PH = (id: string) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`;

// Keyed by Category.name (exactly what the recruiter stores as categoryName).
const BG: Record<string, string[]> = {
  "Med Spa & Aesthetics": [
    P("31653787", "aesthethic-aesthetic-beauty-aesthetic-medicine-course-aesthetic-treatment-31653787.jpeg"),
    PH("12115040"), PH("6187305"), PH("3865548"),
  ],
  "Skincare & Facials": [
    P("31653787", "aesthethic-aesthetic-beauty-aesthetic-medicine-course-aesthetic-treatment-31653787.jpeg"),
    PH("7446659"), PH("6781117"), PH("6187305"),
  ],
  "Lashes & Brows": [
    PH("8558536"), PH("2970225"), PH("14581433"), PH("8558524"),
  ],
  "Hair": [
    P("27580353", "fixing-hair-hair-style-hairstyles-salon-27580353.jpeg"),
    PH("13714796"), PH("8867400"), PH("8834018"), PH("3993320"),
  ],
  "Barbers": [
    P("4177891", "barber-barber-shop-barbering-barbershop-4177891.jpeg"),
    PH("7447152"), PH("3037244"), PH("12464843"), PH("9992820"),
  ],
  "Nails": [
    P("4786180", "beautician-beautiful-beauty-care-4786180.jpeg"),
    PH("6135675"), PH("6135685"), PH("3997384"), PH("3738377"),
  ],
  "Makeup": [
    P("6868400", "asian-woman-makeup-tiktok-tiktok-video-6868400.jpeg"),
    PH("7290109"), PH("3886313"), PH("7290644"), PH("6954005"),
  ],
  "Massage": [
    P("5659238", "pexels-photo-5659238.jpeg"),
    PH("9146381"), PH("6628649"), PH("6628601"), PH("6628701"),
  ],
  "Personal Training": [
    P("6455342", "pexels-photo-6455342.jpeg"),
  ],
  "Pet Grooming": [
    P("10914655", "pexels-photo-10914655.jpeg"),
  ],
  "Cleaning": [
    P("6195139", "pexels-photo-6195139.jpeg"),
  ],
  "Real Estate": [
    P("8293132", "buyers-agent-dream-home-first-time-home-buyer-for-sale-8293132.jpeg"),
  ],
  "Mortgage & Lending": [
    P("7646610", "adult-business-buying-a-house-chair-7646610.jpeg"),
  ],
  "Photography": [PH("13699196"), PH("3800848"), PH("8389706")],
  "Auto Detailing": [PH("29504462"), PH("6873098"), PH("14021836")],
  "Interior Design & Staging": [PH("32579238"), PH("9849647"), PH("6615107")],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Deterministic backdrop for a provider (varies by slug, stable per provider),
 * or null when the category has no curated image — the title card then uses
 * the clean gradient instead of a mismatched photo.
 */
export function categoryBackground(categoryName: string, slug: string): string | null {
  const list = BG[categoryName];
  if (!list || list.length === 0) return null;
  return list[hash(slug) % list.length];
}
