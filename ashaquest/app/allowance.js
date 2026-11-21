// Next allowance payment for a child, mirroring what the hourly job and pay_child do.
import { addDays, periodOf, allowanceDates } from "./engine.js?v=202611210713";

/**
 * @param child  children row (allowance, period_anchor, period_days, payday_hour, payday_mode, start_date)
 * @param today  local "YYYY-MM-DD"; hour: local hour 0–23
 * @param paidPeriodEnds  period_end of paid paydays; paidKeys: auto_key of allowance money already written
 * @returns {date, cents, mode, ...} or null when allowance is off
 */
export function nextAllowance(child, { today, hour, paidPeriodEnds = [], paidKeys = [] }) {
  const a = child.allowance || {};
  if (!a.enabled || !(a.cents > 0)) return null;
  if (a.mode === "payday") {
    const cyc = { anchor: child.period_anchor, periodDays: child.period_days };
    const weeks = Math.max(1, Math.floor(child.period_days / 7));
    const payHour = child.payday_hour ?? 6;
    let date;
    if (child.start_date > today) date = periodOf(child.start_date, cyc).payday;
    else {
      const cur = periodOf(today, cyc);
      const prevEnd = addDays(cur.start, -1);
      const dueToday = cur.start === today && prevEnd >= child.start_date && !paidPeriodEnds.includes(prevEnd) && hour < payHour;
      date = dueToday ? today : cur.payday;
    }
    return { date, hour: payHour, cents: a.cents * weeks, weeks, mode: "payday", payMode: child.payday_mode };
  }
  const dates = allowanceDates({ ...a, start_date: a.start_date || child.start_date }, today, addDays(today, 70));
  const date = dates.find((d) => d > today || !paidKeys.includes("allow:" + d));
  return date ? { date, cents: a.cents, mode: "schedule" } : null;
}
