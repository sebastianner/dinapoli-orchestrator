// The restaurant's business day is Bogota local time, not UTC - matters right
// around midnight UTC, which is still mid-evening in Colombia. Colombia has no
// DST (fixed UTC-5 year round), so this is safe to also mirror as a static
// SQL offset (see BUSINESS_DAY_SQL_OFFSET below).
export const BOGOTA_TZ = 'America/Bogota';
const BOGOTA_UTC_OFFSET_HOURS = 5;

// The restaurant runs a night shift (roughly 4pm to past midnight) - an
// order rung in at 1am is still that same shift, not the start of a new
// business day. Anything before this hour (Bogota local time) still counts
// as part of the PREVIOUS calendar day's business day; this hour and later
// belongs to the new one. This only changes which day an order/report/
// counter is bucketed into for reporting purposes - actual timestamps
// (orders.created_at, completed_at, etc.) are never altered.
const BUSINESS_DAY_CUTOFF_HOURS = 2;

/**
 * Static SQL offset for `date(col, BUSINESS_DAY_SQL_OFFSET)` - combines the
 * Bogota UTC offset with the business-day cutoff shift above, so a raw UTC
 * timestamp maps directly to its business-day date in one step. Used for
 * deciding which day's *total* an order counts toward: closing reports,
 * analytics range filters/summaries, order-history's date filter, and the
 * delivery counter (see endOfDayService, analyticsService, orderService,
 * printerService).
 *
 * Deliberately NOT used for a value that gets displayed as a specific date/
 * hour/day-of-week (a chart axis label, the heatmap's cells) - those stay on
 * the plain Bogota offset, "-5 hours", so what's shown is the real time an
 * order happened, not which business day it was folded into.
 */
export const BUSINESS_DAY_SQL_OFFSET = `-${BOGOTA_UTC_OFFSET_HOURS + BUSINESS_DAY_CUTOFF_HOURS} hours`;

const bogotaDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA_TZ }); // en-CA formats as YYYY-MM-DD

/**
 * Today's date as YYYY-MM-DD in the restaurant's *business* day, not the
 * literal Bogota calendar day - returns yesterday's date until
 * BUSINESS_DAY_CUTOFF_HOURS (2am), matching BUSINESS_DAY_SQL_OFFSET above.
 */
export function currentBusinessDateBogota(): string {
  return bogotaDateFormat.format(new Date(Date.now() - BUSINESS_DAY_CUTOFF_HOURS * 60 * 60 * 1000));
}
