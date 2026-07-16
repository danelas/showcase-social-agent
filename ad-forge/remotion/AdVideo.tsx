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
export type Scene = {
  clip: string | null;
  durationInFrames: number;
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
            <SceneView scene={scene} brand={brand} />
          </Series.Sequence>
        ))}
      </Series>
      <Logo brand={brand} />
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: Scene; brand: AdProps["brand"] }> = ({
  scene,
  brand,
}) => {
  const { width } = useVideoConfig();
  const u = width / 1080; // scale unit so both 9:16 and 16:9 look right

  return (
    <AbsoluteFill>
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

      {/* readability scrim */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      {scene.headline && (
        <Headline
          u={u}
          headline={scene.headline}
          subhead={scene.subhead}
        />
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
    </AbsoluteFill>
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
        // Stack earliest message highest so the thread reads top-to-bottom.
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
