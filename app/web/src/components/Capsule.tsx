import { useState } from "react";

// The plate: the one dark surface in a light app, and the mount for every piece
// of game art the product shows. See the `.plate` block in styles.css for why it
// is a system law rather than a Library-only treatment.
//
// The plate is the component and the art is its content. Two ways the art can be
// absent and both must land on the same fallback, not on a broken image:
//   - the game has no crawled thumbnail (url is null)
//   - the URL exists but fails to load (delisted app, CDN miss, offline)
// The second is the one that is easy to miss, because it only shows up against
// real network conditions. Reserving the box also stops rows shifting as
// capsules stream in.

/** The plate's fallback glyph. Never throws on an empty or exotic title — a row
 *  with a blank name still gets a plate, not a crash or a stray "undefined". */
export function plateInitial(title: string): string {
  const ch = [...(title ?? "").trim()][0];
  return ch ? ch.toUpperCase() : "·";
}

export function Capsule({
  url,
  title,
  size = "xs",
}: {
  url: string | null | undefined;
  title: string;
  size?: "xs" | "sm";
}) {
  const [failed, setFailed] = useState(false);
  const cls = `plate plate-${size}`;

  // aria-hidden on the fallback: the title sits beside it in the same cell, so
  // announcing the initial would just repeat the first letter of the name.
  if (!url || failed) {
    return (
      <span className={cls} aria-hidden="true">
        <span className="plate-fallback">{plateInitial(title)}</span>
      </span>
    );
  }
  return (
    <span className={cls}>
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        width={size === "xs" ? 46 : 92}
        height={size === "xs" ? 22 : 43}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
