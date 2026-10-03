// Reuse native ICU formatters instead of allocating one on every polling tick.
const clockFormatters = new Map();
export function clockParts(now, timeZone) {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    // Bound even unexpected caller-supplied zones; no market data is discarded.
    if (clockFormatters.size >= 8) clockFormatters.delete(clockFormatters.keys().next().value);
    clockFormatters.set(timeZone, formatter);
  }
  return formatter.formatToParts(new Date(now));
}

// Only retain the current report key. This gate never throttles entry/exit checks.
export function createReportRetryGate(intervalMs = 10 * 60_000) {
  let lastKey = null, nextAt = 0;
  return (key, now) => {
    if (key === lastKey && now < nextAt) return false;
    lastKey = key;
    nextAt = now + intervalMs;
    return true;
  };
}
