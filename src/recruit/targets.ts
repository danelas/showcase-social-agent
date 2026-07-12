// What to search for, per PeekScout category. `categoryName` must match a
// Category.name exactly (see prisma/seed.ts) so the sender can resolve the id
// when it creates the draft Provider.
//
// Two query sets per category:
//   business — established shops/studios with a website (email is scrapeable)
//   solo     — independent / freelance / mobile providers listed under a name
// The daily cron runs both. Med spa & aesthetics leads (highest local ad
// budgets + heaviest existing reel culture), then the rest of the video-strong
// service set. Real-estate / mortgage / interior-design categories are omitted
// here — they need a different pitch than "we filmed-ready your profile."

export type Target = {
  categoryName: string;
  business: string[];
  solo: string[];
};

export const TARGETS: Target[] = [
  {
    categoryName: "Med Spa & Aesthetics",
    business: ["med spa", "aesthetics clinic", "botox clinic"],
    solo: ["independent nurse injector", "freelance aesthetic nurse"],
  },
  {
    categoryName: "Skincare & Facials",
    business: ["facial spa", "esthetician"],
    solo: ["independent esthetician", "solo esthetician"],
  },
  {
    categoryName: "Lashes & Brows",
    business: ["lash studio", "brow bar"],
    solo: ["independent lash artist", "freelance brow artist", "solo lash tech"],
  },
  {
    categoryName: "Makeup",
    business: ["makeup studio"],
    solo: ["freelance makeup artist", "mobile makeup artist"],
  },
  {
    categoryName: "Hair",
    business: ["hair salon", "hair stylist"],
    solo: ["independent hair stylist", "booth rental stylist", "mobile hair stylist"],
  },
  {
    categoryName: "Nails",
    business: ["nail salon"],
    solo: ["independent nail tech", "solo nail artist"],
  },
  {
    categoryName: "Massage",
    business: ["massage spa", "massage therapist"],
    solo: ["independent massage therapist", "mobile massage therapist"],
  },
  {
    categoryName: "Personal Training",
    business: ["personal training studio"],
    solo: ["independent personal trainer", "private personal trainer"],
  },
  {
    categoryName: "Pet Grooming",
    business: ["pet grooming"],
    solo: ["mobile pet groomer", "independent dog groomer"],
  },
  {
    categoryName: "Cleaning",
    business: ["house cleaning service", "maid service"],
    solo: ["independent house cleaner", "self-employed housekeeper"],
  },
];

export function findTarget(categoryName: string): Target | undefined {
  return TARGETS.find((t) => t.categoryName === categoryName);
}
