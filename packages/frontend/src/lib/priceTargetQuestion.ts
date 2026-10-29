export function priceTargetDeadline(atTime: Date): string {
  if (Number.isNaN(atTime.getTime())) return "at the selected time";

  const year = atTime.getFullYear();
  const month = atTime.getMonth();
  const isMonthEnd = atTime.getDate() === new Date(year, month + 1, 0).getDate();
  if (isMonthEnd && atTime.getHours() === 23 && atTime.getMinutes() === 59) {
    if (month === 11) return `at the end of ${year}`;
    const monthName = atTime.toLocaleString("en-US", { month: "long" });
    return `at the end of ${monthName} ${year}`;
  }

  const date = atTime.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = atTime.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `on ${date} at ${time}`;
}

export function priceTargetQuestion(symbol: string, price: number, above: boolean, atTime: Date): string {
  return `Will ${symbol} finish ${above ? "at or above" : "at or below"} $${price.toLocaleString()} ${priceTargetDeadline(atTime)}?`;
}
