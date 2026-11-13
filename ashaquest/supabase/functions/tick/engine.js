// Kids Quest rules engine. Pure functions, no dependencies.
// Shared by the browser app and the scheduled Edge Function, so keep it plain ES2020.
// Dates are local calendar days as "YYYY-MM-DD" strings.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");

export function dayNum(s) { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); }
export function dayStr(n) { const t = new Date(n * DAY); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); }
export function addDays(s, n) { return dayStr(dayNum(s) + n); }
/** 1 = Monday ... 7 = Sunday */
export function weekday(s) { return ((dayNum(s) + 3) % 7 + 7) % 7 + 1; }
export function weekStart(s) { return addDays(s, 1 - weekday(s)); }
export function isWeekend(s) { return weekday(s) >= 6; }

/** Local calendar date of an instant in a time zone. */
export function localDate(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return g("year") + "-" + g("month") + "-" + g("day");
}

/** Offset in ms of tz from UTC at an instant. */
function tzOffset(ms, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}
/** UTC instant (ms) of local midnight starting the given day. */
export function localMidnight(day, tz) {
  const guess = dayNum(day) * DAY;
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

export function periodOf(day, cfg) {
  const len = cfg.periodDays || 14;
  const index = Math.floor((dayNum(day) - dayNum(cfg.anchor)) / len);
  const st = dayNum(cfg.anchor) + index * len;
  return { index, start: dayStr(st), end: dayStr(st + len - 1), payday: dayStr(st + len) };
}

const LIVE = new Set(["approved", "pending"]);

/** Points an entry is worth when a child or parent logs it. */
export function entryPoints(activity, entry) {
  if (!activity) return Number(entry.points) || 0;
  if (activity.kind === "weekly") return 0;
  if (activity.kind === "outcome") {
    const o = (activity.outcomes || []).find((x) => x.key === entry.outcome_key);
    return o ? Number(o.points) || 0 : 0;
  }
  const qty = entry.qty == null ? 1 : Number(entry.qty);
  return Math.round((Number(activity.points) || 0) * qty);
}

/** Minutes of screen time per local day. Open sessions run until `now`. */
export function screenMinutesByDay(sessions, tz, now) {
  const out = {};
  const nowMs = now ? new Date(now).getTime() : Date.now();
  for (const s of sessions || []) {
    let a = new Date(s.started_at).getTime();
    const b = s.ended_at ? new Date(s.ended_at).getTime() : nowMs;
    while (a < b) {
      const day = localDate(a, tz);
      const next = localMidnight(addDays(day, 1), tz);
      const end = Math.min(b, next);
      out[day] = (out[day] || 0) + (end - a) / 60000;
      a = end;
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

export function screenLimit(screen, day) { return isWeekend(day) ? screen.weekendLimitMin : screen.weekdayLimitMin; }

/**
 * Automatic entries for closed days and weeks that do not exist yet.
 * Closed means strictly before `today`. `fromDate` bounds how far back to look
 * (callers pass the day after the last paid period, so paid periods are never touched).
 */
export function deriveAutoEntries({ today, fromDate, activities = [], entries = [], excused = [], sessions = [], screen = null, tz = "Europe/Amsterdam" }) {
  const lastClosed = addDays(today, -1);
  const have = new Set(entries.filter((x) => x.auto_key).map((x) => x.auto_key));
  const exc = new Set(excused);
  const out = [];
  const push = (a) => { if (!have.has(a.auto_key)) out.push(a); };
  const from = (start) => (fromDate && fromDate > start ? fromDate : start);

  for (const act of activities) {
    if (act.active === false) continue;
    const start = from(act.start_date || today);
    if (act.kind === "outcome" && act.daily_required) {
      const miss = (act.outcomes || []).find((o) => o.key === act.missed_key);
      if (!miss) continue;
      for (let d = start; d <= lastClosed; d = addDays(d, 1)) {
        if (exc.has(d)) continue;
        const logged = entries.some((x) => x.activity_id === act.id && x.date === d && !x.auto_key && LIVE.has(x.status));
        if (!logged) push({ auto_key: "miss:" + act.id + ":" + d, activity_id: act.id, date: d, outcome_key: miss.key, points: Number(miss.points) || 0, title: act.name, emoji: act.emoji, category_id: act.category_id });
      }
    }
    if (act.kind === "weekly") {
      for (let w = weekStart(start) < start ? addDays(weekStart(start), 7) : weekStart(start); addDays(w, 6) <= lastClosed; w = addDays(w, 7)) {
        const sun = addDays(w, 6);
        const qty = entries.filter((x) => x.activity_id === act.id && !x.auto_key && LIVE.has(x.status) && x.date >= w && x.date <= sun)
          .reduce((s, x) => s + (Number(x.qty) || 0), 0);
        const quota = Number(act.quota) || 0;
        let pts = 0;
        if (qty < quota) pts = act.partial ? Math.round((Number(act.penalty) || 0) * (quota - qty) / quota) : Number(act.penalty) || 0;
        else pts = (qty - quota) * (Number(act.bonus_per_unit) || 0);
        if (pts !== 0) push({ auto_key: "week:" + act.id + ":" + w, activity_id: act.id, date: sun, qty, points: pts, title: act.name, emoji: act.emoji, category_id: act.category_id });
      }
    }
  }

  if (screen) {
    const start = from(screen.start_date || today);
    const mins = screenMinutesByDay(sessions, tz);
    for (let d = start; d <= lastClosed; d = addDays(d, 1)) {
      const over = (mins[d] || 0) - screenLimit(screen, d);
      if (over > 0) push({ auto_key: "st-over:" + d, date: d, points: Math.ceil(over / screen.overBlockMin) * screen.overPenalty, title: "Screentime lebih", emoji: "⏰", kind: "screen" });
    }
    for (let w = weekStart(start) < start ? addDays(weekStart(start), 7) : weekStart(start); addDays(w, 6) <= lastClosed; w = addDays(w, 7)) {
      let left = 0;
      for (let i = 0; i < 7; i++) { const d = addDays(w, i); left += Math.max(0, screenLimit(screen, d) - (mins[d] || 0)); }
      const pts = Math.floor(left / screen.leftoverBlockMin) * screen.leftoverPointsPerBlock;
      if (pts > 0) push({ auto_key: "st-left:" + w, date: addDays(w, 6), qty: left, points: pts, title: "Hemat screentime", emoji: "🌤️", kind: "screen" });
    }
  }
  return out;
}

/** Points in a date range: approved, pending, and reported (both). */
export function summarize(entries, from, to) {
  let approved = 0, pending = 0;
  for (const x of entries) {
    if (x.date < from || x.date > to) continue;
    if (x.status === "approved") approved += Number(x.points) || 0;
    else if (x.status === "pending") pending += Number(x.points) || 0;
  }
  return { approved, pending, reported: approved + pending };
}

/** What a payday up to `upTo` pays: approved, unpaid entries dated up to that day (and not before `from`). */
export function payable(entries, upTo, centsPerPoint, from) {
  const rows = entries.filter((x) => x.status === "approved" && !x.payday_id && x.date <= upTo && (!from || x.date >= from));
  const points = rows.reduce((s, x) => s + (Number(x.points) || 0), 0);
  return { ids: rows.map((x) => x.id), points, cents: points * centsPerPoint };
}

export function balance(txs) { return txs.filter((t) => t.status === "approved").reduce((s, t) => s + (Number(t.cents) || 0), 0); }

/** Points earned back for charity spending (cents negative or positive). */
export function charityPoints(cents, centsPerPoint, ratio) { return Math.ceil((Math.abs(cents) / centsPerPoint) * ratio - 1e-9); }

/** Allowance pay dates in [from, to], never before the allowance start date. */
export function allowanceDates(a, from, to) {
  const out = [];
  const s = a.start_date && a.start_date > from ? a.start_date : from;
  for (let d = s; d <= to; d = addDays(d, 1)) {
    if (a.freq === "weekly" && weekday(d) === (a.weekday || 1)) out.push(d);
    if (a.freq === "monthly" && Number(d.slice(8)) === (a.monthday || 1)) out.push(d);
  }
  return out;
}
