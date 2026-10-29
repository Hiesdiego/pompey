type TimeInput = Date | number | string;

function validDate(input: TimeInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcDate(input: TimeInput): string {
  const date = validDate(input);
  return date ? `${date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })} UTC` : "Date unavailable";
}

export function formatUtcTime(input: TimeInput): string {
  const date = validDate(input);
  return date ? `${date.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true })} UTC` : "Time unavailable";
}

export function formatUtcDateTime(input: TimeInput): string {
  const date = validDate(input);
  if (!date) return "Time unavailable";
  const day = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });
  return `${day} at ${time} UTC`;
}
