import type { InsightKind } from "shared";

export function InsightSvg({ kind }: { kind: InsightKind }) {
  switch (kind) {
    case "up":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M17 7h4v4" />
        </svg>
      );
    case "down":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M3 7l6 6 4-4 8 8" />
          <path d="M21 21h-4v-4" />
        </svg>
      );
    case "gap":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 2a10 10 0 1 0 10 10" />
          <path d="M12 2v10l7-7" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
        </svg>
      );
  }
}

export function tagClass(kind: InsightKind): string {
  if (kind === "up") return "up";
  if (kind === "down") return "dec";
  if (kind === "gap") return "opp";
  return "gem";
}
