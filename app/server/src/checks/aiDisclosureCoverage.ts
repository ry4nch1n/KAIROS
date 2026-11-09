// AI-disclosure coverage reads for the crawl gate (#283). Both are warnings, never failures.
//
// parseAiDisclosure returns a measured `false` when its heading anchor is missing, so a Steam
// layout change would read as 0% disclosure at full capture and the capture-yield row would stay
// green. With roughly a third of recent releases disclosing, 20 readings with none disclosed is
// far more likely a broken parse than a real market.
import type { Querier } from "../db/db.ts";
import { CENSUS_MAX_TAGS } from "../crawler/census.ts";
import { getBriefSteering } from "../queries/library.ts";
import { matchSteering } from "../queries/shared.ts";
import { AI_SPLIT_MIN, getSteamTagEconomics } from "../queries/steam.ts";

export const AI_CANARY_MIN_CAPTURED = 20;

/** A warning when a full-sized cohort of readings has no disclosure at all; otherwise null. */
export function aiDisclosureCanary(captured: number, disclosed: number): string | null {
  if (captured < AI_CANARY_MIN_CAPTURED || disclosed > 0) return null;
  return `${captured} readings captured and 0 disclosed — check the store-page parse before trusting the 0%.`;
}

export interface AiCoverageRow {
  genre: string;
  games: number;
  aiChecked: number;
  aiDisclosed: number | null;
}

export function formatAiCoverage(r: AiCoverageRow): string {
  const pct = r.games ? Math.round((r.aiChecked / r.games) * 100) : 0;
  const disclosed = r.aiDisclosed ?? 0;
  const undisclosed = r.aiChecked - disclosed;
  const thin = disclosed < AI_SPLIT_MIN || undisclosed < AI_SPLIT_MIN;
  return (
    `${r.genre} ${r.aiChecked}/${r.games} checked (${pct}%), ${disclosed} disclosed` +
    (thin ? ` ⚠️ under ${AI_SPLIT_MIN} a side` : "")
  );
}

/** The tag rows the standing flags steer to, read through the same query the Radar row uses. */
export async function steeredAiCoverage(db: Querier): Promise<AiCoverageRow[]> {
  const { flags } = await getBriefSteering(db);
  if (!flags.length) return [];
  const rows = await getSteamTagEconomics(db, { limit: Number.MAX_SAFE_INTEGER });
  return rows
    .filter((r) => matchSteering(flags, { genre: "", tag: r.genre }).length)
    .slice(0, CENSUS_MAX_TAGS);
}
