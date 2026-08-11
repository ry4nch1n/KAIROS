// Render-time image sizing for Library art.
//
// Pitch/prototype art is generated at full resolution (1376×768 or 2752×1536 PNG,
// 1–11 MB each) and archived that way on purpose — the stored headerUrl/shotUrl/
// imageUrl values are the originals and must never change. But the cards render at
// roughly Steam-capsule size, so shipping the original to a phone is ~100× more
// bytes than the slot can use.
//
// The art host is itself a Netlify site, so its own Image CDN transforms its own
// assets with zero configuration — no remote_images allowlist, no netlify.toml
// change, no derivative to generate at publish time. Rewriting the URL at render
// time is the whole fix.
//
// Two rules make this safe:
//   1. The `url` parameter must be a ROOT-RELATIVE path on the same origin. A full
//      absolute URL is treated as a *remote* image and would need an allowlist on
//      the art site — so we strip the origin and pass only the path.
//   2. Anything we don't recognise passes through untouched. Degrading to the
//      original full-size image is the correct failure mode; a broken <img> is not.

/**
 * Origins whose Netlify Image CDN is known-good for our art. Verified by fetching
 * `/.netlify/images?url=/<path>&w=460&fm=webp` and confirming a small image/webp.
 * Add a host only after checking it the same way — an origin that isn't a Netlify
 * site (or has the transform disabled) returns 415 and would break every card.
 */
const ART_HOSTS = new Set(["kairos-pitch-art.netlify.app"]);

/** Netlify's Image CDN endpoint, relative to the asset's own origin. */
const CDN_PATH = "/.netlify/images";

/**
 * Rewrite an art URL to a width-constrained WebP derivative served by the asset's
 * own Netlify Image CDN. Returns the input unchanged for an unknown host, a
 * relative URL, a data URI, an already-transformed URL, or a nonsense width.
 *
 * @param src    the stored image URL (may be null/undefined/empty)
 * @param width  target width in device pixels
 * @param height optional target height; when given, the derivative is cropped to
 *               exactly width×height (`fit=cover`) so the delivered image matches
 *               the <img> width/height attributes and cannot shift layout.
 */
export function artImage(src: string | null | undefined, width: number, height?: number): string {
  if (!src) return src ?? "";
  if (!Number.isFinite(width) || width <= 0) return src;

  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return src; // relative path, data URI without a parseable form, or malformed
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return src;
  if (!ART_HOSTS.has(u.hostname)) return src;
  if (u.pathname.startsWith(CDN_PATH)) return src; // already a transform

  const params = new URLSearchParams();
  // u.pathname is already percent-encoded by URL; URLSearchParams re-encodes the
  // slashes, which the CDN decodes back on the way in.
  params.set("url", u.pathname);
  params.set("w", String(Math.round(width)));
  if (Number.isFinite(height as number) && (height as number) > 0) {
    params.set("h", String(Math.round(height as number)));
    params.set("fit", "cover");
  }
  params.set("fm", "webp");
  return `${u.origin}${CDN_PATH}?${params.toString()}`;
}

/**
 * A 1×/2× srcset for the same slot, so high-DPI phones stay sharp (2× is still a
 * few tens of kB). Returns undefined when the URL isn't rewritable — React drops
 * an undefined attribute, leaving a plain `src` rather than a bogus srcset.
 */
export function artSrcSet(
  src: string | null | undefined,
  width: number,
  height?: number,
): string | undefined {
  const one = artImage(src, width, height);
  if (!src || one === src) return undefined;
  const two = artImage(src, width * 2, height ? height * 2 : undefined);
  return `${one} 1x, ${two} 2x`;
}
