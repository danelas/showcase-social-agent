import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type Bubble = { side: "in" | "out"; text: string };
export type Caption = { text: string; accent?: boolean; at?: number };
export type Scene = {
  clip: string | null;
  durationInFrames: number;
  cards: string[];
  cardReveal?: boolean;
  captions: Caption[];
  headline?: string;
  subhead?: string;
  cta?: string;
  bubbles: Bubble[];
};
export type AdProps = {
  width: number;
  height: number;
  fps: number;
  brand: {
    name: string;
    accent: string;
    ink: string;
    tagline: string;
    logo: string | null;
    fontFamily: string;
  };
  scenes: Scene[];
};

export const AdVideo: React.FC<AdProps> = ({ brand, scenes }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: brand.fontFamily }}>
      <Series>
        {scenes.map((scene, i) => (
          <Series.Sequence key={i} durationInFrames={scene.durationInFrames}>
            <SceneView scene={scene} brand={brand} first={i === 0} />
          </Series.Sequence>
        ))}
      </Series>
      <Logo brand={brand} />
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: Scene; brand: AdProps["brand"]; first?: boolean }> = ({
  scene,
  brand,
  first,
}) => {
  const { width, durationInFrames } = useVideoConfig();
  const u = width / 1080;
  const reveal = !!scene.cardReveal && scene.cards.length > 0;
  const revealFrames = Math.min(84, Math.round(durationInFrames * 0.4));
  // In reveal mode, captions must clear out before the phone slides up.
  const reserveEnd = reveal ? revealFrames + 6 : 42;

  return (
    <AbsoluteFill>
      <KenBurns>
        {scene.clip ? (
          <OffthreadVideo
            src={staticFile(scene.clip)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <AbsoluteFill
            style={{
              background: `linear-gradient(135deg, ${brand.accent} 0%, #101014 70%)`,
            }}
          />
        )}
      </KenBurns>

      {/* readability scrim */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.78) 100%)",
        }}
      />

      {scene.cards.map((c, i) => (
        <PhoneCard
          key={i}
          src={c}
          index={i}
          count={scene.cards.length}
          u={u}
          reveal={reveal}
          revealFrames={revealFrames}
        />
      ))}

      {scene.captions.length > 0 && (
        <Captions
          captions={scene.captions}
          accent={brand.accent}
          u={u}
          reserveEnd={reserveEnd}
        />
      )}

      {/* legacy static overlays still supported */}
      {scene.headline && (
        <Headline u={u} headline={scene.headline} subhead={scene.subhead} />
      )}
      {scene.bubbles.map((b, i) => (
        <ChatBubble
          key={i}
          u={u}
          bubble={b}
          index={i}
          count={scene.bubbles.length}
          accent={brand.accent}
        />
      ))}

      {scene.cta && <CTA u={u} label={scene.cta} accent={brand.accent} />}

      {/* Flash only on scene *cuts* (2..N). The first scene's frame 0 is also
          the video's opening frame / thumbnail, so flashing there would wash
          the whole opening out to grey-white. */}
      {!first && <CutFlash />}
    </AbsoluteFill>
  );
};

/** Slow zoom on the background for constant energy. */
const KenBurns: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.16]);
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: "50% 45%" }}>
      {children}
    </AbsoluteFill>
  );
};

/** White flash on the first frames of a scene = punchy cut. */
const CutFlash: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5], [0.6, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#fff", opacity }} />;
};

/** A screenshot in a phone frame. Default: floats the whole scene. Reveal
 *  mode: slides up from the bottom only for the last ~2.5s (app reveal). */
const PhoneCard: React.FC<{
  src: string;
  index: number;
  count: number;
  u: number;
  reveal?: boolean;
  revealFrames?: number;
}> = ({ src, index, count, u, reveal, revealFrames = 84 }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const delay = reveal ? durationInFrames - revealFrames : 6 + index * 10;
  const s = spring({
    frame: frame - delay,
    fps,
    config: reveal ? { damping: 18, mass: 0.9 } : { damping: 15, mass: 0.7 },
  });

  const cardW = width * (reveal ? 0.52 : count > 1 ? 0.46 : 0.58);
  const spread = reveal ? 0 : count > 1 ? (index - (count - 1) / 2) * cardW * 0.62 : 0;
  const baseTilt = reveal ? -3 : count > 1 ? (index - (count - 1) / 2) * 8 : -4;

  const enterY = interpolate(s, [0, 1], [(reveal ? 1000 : 520) * u, 0]);
  const bob = reveal ? 0 : Math.sin((frame - delay) / 26) * 10 * u;
  const tilt = baseTilt + (reveal ? 0 : Math.sin((frame - delay) / 34) * 1.4);
  const opacity = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: reveal ? "44%" : "50%",
        width: cardW,
        transform: `translate(-50%,-50%) translateX(${spread}px) translateY(${
          enterY + bob + (reveal ? 0 : 40 * u)
        }px) rotate(${tilt}deg) scale(${interpolate(s, [0, 1], [0.9, 1])})`,
        opacity,
        zIndex: 6,
      }}
    >
      <div
        style={{
          background: "#0b0b0d",
          padding: 10 * u,
          borderRadius: 46 * u,
          boxShadow: `0 ${34 * u}px ${70 * u}px rgba(0,0,0,0.55)`,
          border: `${2 * u}px solid rgba(255,255,255,0.14)`,
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            display: "block",
            width: "100%",
            borderRadius: 36 * u,
          }}
        />
      </div>
    </div>
  );
};

/** Kinetic captions: each pops in for its slice of the scene. */
const Captions: React.FC<{
  captions: Caption[];
  accent: string;
  u: number;
  reserveEnd?: number;
}> = ({ captions, accent, u, reserveEnd = 42 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const usable = Math.max(30, durationInFrames - reserveEnd);
  const slot = usable / captions.length;

  return (
    <>
      {captions.map((c, i) => {
        const start = c.at != null ? c.at * fps : i * slot;
        const end = c.at != null ? start + slot : (i + 1) * slot;
        const local = frame - start;
        if (frame < start - 2 || frame > end + 2) return null;

        const pop = spring({ frame: local, fps, config: { damping: 12, mass: 0.5 } });
        const scale = interpolate(pop, [0, 1], [0.5, 1]);
        const rot = interpolate(pop, [0, 1], [-4, 0]);
        const opacity = interpolate(
          frame,
          [start, start + 5, end - 5, end],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 210 * u,
              left: 50 * u,
              right: 50 * u,
              textAlign: "center",
              transform: `scale(${scale}) rotate(${rot}deg)`,
              opacity,
            }}
          >
            <span
              style={{
                display: "inline",
                fontWeight: 900,
                fontSize: 96 * u,
                lineHeight: 1.0,
                letterSpacing: -2 * u,
                textTransform: "uppercase",
                color: c.accent ? accent : "#fff",
                WebkitTextStroke: c.accent ? `${2 * u}px rgba(0,0,0,0.25)` : undefined,
                textShadow: `0 ${4 * u}px ${20 * u}px rgba(0,0,0,0.6)`,
              }}
            >
              {c.text}
            </span>
          </div>
        );
      })}
    </>
  );
};

const Headline: React.FC<{ u: number; headline: string; subhead?: string }> = ({
  u,
  headline,
  subhead,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(s, [0, 1], [40 * u, 0]);
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 120 * u,
        left: 64 * u,
        right: 64 * u,
        transform: `translateY(${y}px)`,
        opacity,
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 104 * u,
          lineHeight: 0.94,
          letterSpacing: -2 * u,
          color: "#fff",
          textShadow: `0 ${4 * u}px ${24 * u}px rgba(0,0,0,0.45)`,
        }}
      >
        {headline}
      </div>
      {subhead && (
        <div
          style={{
            marginTop: 24 * u,
            fontWeight: 600,
            fontSize: 40 * u,
            lineHeight: 1.2,
            color: "#f2f2f2",
            maxWidth: 640 * u,
            textShadow: `0 ${2 * u}px ${14 * u}px rgba(0,0,0,0.5)`,
          }}
        >
          {subhead}
        </div>
      )}
    </div>
  );
};

const ChatBubble: React.FC<{
  u: number;
  bubble: Bubble;
  index: number;
  count: number;
  accent: string;
}> = ({ u, bubble, index, count, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = 18 + index * 16;
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.6 } });
  const scale = interpolate(s, [0, 1], [0.6, 1]);
  const opacity = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = bubble.side === "out";
  return (
    <div
      style={{
        position: "absolute",
        left: out ? undefined : 48 * u,
        right: out ? 48 * u : undefined,
        bottom: (340 + (count - 1 - index) * 210) * u,
        maxWidth: 620 * u,
        transform: `scale(${scale})`,
        transformOrigin: out ? "right bottom" : "left bottom",
        opacity,
      }}
    >
      <div
        style={{
          background: out ? accent : "#ffffff",
          color: out ? "#fff" : "#141414",
          padding: `${22 * u}px ${30 * u}px`,
          fontSize: 34 * u,
          fontWeight: 600,
          lineHeight: 1.25,
          borderRadius: out
            ? `${30 * u}px ${30 * u}px ${8 * u}px ${30 * u}px`
            : `${30 * u}px ${30 * u}px ${30 * u}px ${8 * u}px`,
          boxShadow: `0 ${14 * u}px ${34 * u}px rgba(0,0,0,0.28)`,
        }}
      >
        {bubble.text}
      </div>
    </div>
  );
};

const CTA: React.FC<{ u: number; label: string; accent: string }> = ({
  u,
  label,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const inAt = Math.max(0, durationInFrames - 40);
  const s = spring({ frame: frame - inAt, fps, config: { damping: 16 } });
  const scale = interpolate(s, [0, 1], [0.8, 1]);
  const opacity = interpolate(frame, [inAt, inAt + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 150 * u,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <div
        style={{
          background: accent,
          color: "#fff",
          fontWeight: 800,
          fontSize: 40 * u,
          padding: `${26 * u}px ${64 * u}px`,
          borderRadius: 999,
          boxShadow: `0 ${16 * u}px ${40 * u}px ${accent}66`,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Logo: React.FC<{ brand: AdProps["brand"] }> = ({ brand }) => {
  const { width } = useVideoConfig();
  const u = width / 1080;
  return (
    <div
      style={{
        position: "absolute",
        top: 48 * u,
        left: 56 * u,
        display: "flex",
        alignItems: "center",
        gap: 16 * u,
      }}
    >
      {brand.logo ? (
        <Img src={staticFile(brand.logo)} style={{ height: 64 * u, width: "auto" }} />
      ) : (
        <div
          style={{
            width: 56 * u,
            height: 56 * u,
            borderRadius: 14 * u,
            background: brand.accent,
            color: "#fff",
            fontWeight: 900,
            fontSize: 32 * u,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {brand.name.charAt(0)}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 34 * u, lineHeight: 1 }}>
          {brand.name}
        </div>
        {brand.tagline && (
          <div style={{ color: "#ffffffcc", fontWeight: 500, fontSize: 22 * u }}>
            {brand.tagline}
          </div>
        )}
      </div>
    </div>
  );
};
