import { useEffect, useState } from "react";
import { copyText } from "../lib/pitchSeed.ts";

const LABEL = { idle: "copy pitch seed", copied: "copied", failed: "copy unavailable" } as const;

// "Copy pitch seed" (#69) — the seed is built on click, not render; the label resets after 2s.
export function CopySeed({ seed }: { seed: () => string }) {
  const [state, setState] = useState<keyof typeof LABEL>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="project-btn"
      aria-live="polite"
      title="Copy this evidence as a plain-text brief to start a pitch from."
      onClick={async () => setState((await copyText(seed())) ? "copied" : "failed")}
    >
      {LABEL[state]}
    </button>
  );
}
