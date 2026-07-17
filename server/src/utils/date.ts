// The restaurant's business day is Bogota local time, not UTC - matters right
// around midnight UTC, which is still mid-evening in Colombia. Colombia has no
// DST (fixed UTC-5 year round), so this is safe to also mirror as a static
// SQL offset (see endOfDayService's `date(completed_at, '-5 hours')`).
export const BOGOTA_TZ = 'America/Bogota';

const bogotaDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA_TZ });

/** Today's date as YYYY-MM-DD in the restaurant's Bogota business day. */
export function todayDateStrBogota(): string {
  return bogotaDateFormat.format(new Date()); // en-CA formats as YYYY-MM-DD
}
