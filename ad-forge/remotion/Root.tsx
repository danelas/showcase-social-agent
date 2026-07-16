import { Composition } from "remotion";
import { AdVideo, type AdProps } from "./AdVideo.tsx";

/** A tiny stand-in so `remotion studio` opens without a props file. */
const sample: AdProps = {
  width: 1080,
  height: 1920,
  fps: 30,
  brand: {
    name: "PeekScout",
    accent: "#7c3aed",
    ink: "#141414",
    tagline: "See it before you book it.",
    logo: null,
    fontFamily: "Segoe UI, Arial, Helvetica, sans-serif",
  },
  scenes: [
    {
      clip: null,
      durationInFrames: 150,
      headline: "From Scroll to Booked",
      subhead: "The video-first way to book local pros.",
      cta: "Book on PeekScout",
      bubbles: [
        { side: "in", text: "Loved your facial video — Saturday open?" },
        { side: "out", text: "Yes! Booked you in for 10am ✨" },
      ],
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Ad"
      component={AdVideo}
      defaultProps={sample}
      // Real dimensions + duration come from the props file at render time.
      calculateMetadata={({ props }) => {
        const total = props.scenes.reduce(
          (n, s) => n + s.durationInFrames,
          0
        );
        return {
          width: props.width,
          height: props.height,
          fps: props.fps,
          durationInFrames: Math.max(1, total),
        };
      }}
    />
  );
};
