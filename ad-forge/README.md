# ad-forge

Generate branded **video ads** from a folder of assets.

- **Veo** (Google's video model) turns your real assets into footage —
  `image2video` animates your actual screenshots/product shots, or
  `text2video` invents fresh b-roll from a prompt.
- **Remotion** overlays your brand on top — logo, headline, captions,
  chat bubbles, CTA — pixel-exact and animated.

One tool, any brand. Add a brand file + point it at an asset folder.

---

## Setup

```bash
cd ad-forge
npm install
cp .env.example .env      # paste your paid GEMINI_API_KEY
```

## Make an ad

```bash
# free preview — skips Veo, renders overlays over a gradient
MOCK=1 npm run make -- briefs/peekscout-scroll-to-booked.json

# the real thing (spends Veo credits)
npm run make -- briefs/peekscout-scroll-to-booked.json
```

Output lands in `out/<brief>.mp4`. Or run the two steps separately:

```bash
npm run generate -- briefs/peekscout-scroll-to-booked.json   # Veo -> clips + props
npx remotion render Ad out/ad.mp4 --props=out/peekscout-scroll-to-booked.props.json
```

Tweak the look live in the browser:

```bash
npm run studio
```

---

## Concepts

**Brand** (`brands/<name>.json`) — reusable identity + where to pull assets:

```json
{
  "name": "PeekScout",
  "accent": "#7c3aed",
  "tagline": "See it before you book it.",
  "logo": "brands/peekscout/logo.png",      // relative to public/
  "assetsDir": "C:/Users/dandu/Downloads/ads for peekscout"
}
```

**Brief** (`briefs/<name>.json`) — one ad. Each scene is one Veo clip plus
its overlays:

```json
{
  "brand": "peekscout",
  "aspect": "9:16",
  "scenes": [
    {
      "source": { "type": "image2video", "image": "screenshot.png" },
      "prompt": "cinematic push-in, gentle motion, no on-screen text",
      "seconds": 8,
      "headline": "From Scroll to Booked",
      "subhead": "The video-first way to book local pros.",
      "bubbles": [
        { "side": "in",  "text": "Loved your facial video — Saturday open?" },
        { "side": "out", "text": "Yes! Booked you in for 10am ✨" }
      ],
      "cta": "Book on PeekScout"
    }
  ]
}
```

- `image` is a filename inside the brand's `assetsDir` (or an absolute path).
- **Keep Veo prompts about the *footage*, not text** — let Remotion draw the
  words. Veo's own text tends to be garbled; add `no on-screen text` to prompts.
- `bubbles` are optional; `cta` shows in the last ~1.5s of a scene.

---

## Add a new brand (any project)

1. Drop assets in a folder anywhere.
2. `brands/mybrand.json` pointing `assetsDir` at it; put a `logo.png` in
   `public/brands/mybrand/`.
3. Write `briefs/mybrand-<campaign>.json`.
4. `npm run make -- briefs/mybrand-<campaign>.json`.

## Cost note

Veo 3 is roughly **$0.15–$0.40 per second** of generated video. The 2-scene
example (~16s) is a few dollars. Use `MOCK=1` to iterate on copy/layout for
free, and `VEO_MODEL=veo-3.0-fast-generate-001` in `.env` for cheaper drafts.
