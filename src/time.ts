export function nowIso(): string {
  return new Date().toISOString();
}

export function durationMs(startIso: string, endIso = nowIso()): number {
  return new Date(endIso).getTime() - new Date(startIso).getTime();
}

export function timestampForId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function tomorrowAtTwo(date = new Date()): { isoDate: string; display: string } {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
  const isoDate = tomorrow.toISOString().slice(0, 10);
  const display = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
    tomorrow.getDate()
  ).padStart(2, "0")} 14:00`;
  return { isoDate, display };
}
