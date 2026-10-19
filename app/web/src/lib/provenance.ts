// Where a Revenue input's value came from — shown as a small note under every field so a
// default guess is never mistaken for a real figure.
//   assumed  — still the default; `basis` names the published reasoning behind it
//   seeded   — prefilled from a real comparable (today only the Steam list price)
//   edited   — the user changed it this session (overrides the other two)
//   measured — observed data; nothing sets this yet, reserved for a future ingest
export type Provenance =
  | { kind: "assumed"; basis: string }
  | { kind: "seeded"; from: string }
  | { kind: "edited" }
  | { kind: "measured"; basis: string };

export function provenanceNote(p: Provenance): string {
  switch (p.kind) {
    case "assumed":
      return "assumed · " + p.basis;
    case "seeded":
      return "from " + p.from;
    case "edited":
      return "edited";
    case "measured":
      return "measured · " + p.basis;
  }
}

/** An edit wins over any origin; otherwise the origin as given. */
export function resolveProvenance(origin: Provenance, edited: boolean): Provenance {
  return edited ? { kind: "edited" } : origin;
}
