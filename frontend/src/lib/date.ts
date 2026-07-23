/** Shifts a YYYY-MM-DD string by a number of days (may be negative). */
export function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DAY_FORMATTER = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
const TIME_FORMATTER = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

export function formatDateLong(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return DAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatTime(isoString: string): string {
  return TIME_FORMATTER.format(new Date(isoString));
}

/** Human-readable "time ago" in Spanish, e.g. "hace 5 minutos". */
export function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return 'justo ahora';
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}
