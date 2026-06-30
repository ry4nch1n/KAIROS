// Calendar-week helpers (Monday-start, UTC) for grouping brief editions.
// "This week" must mean the actual current calendar week — a Friday edition from
// last week belongs to "Earlier", not "This week".

/** Epoch ms of the Monday 00:00 UTC that starts the calendar week containing `d`. */
export function mondayOf(d: Date): number {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7)); // 0=Mon..6=Sun
  return u.getTime();
}

/** True if the ISO date (YYYY-MM-DD) falls in the same calendar week as `ref`. */
export function isSameWeek(isoDate: string, ref: Date): boolean {
  return mondayOf(new Date(isoDate + "T00:00:00Z")) === mondayOf(ref);
}
