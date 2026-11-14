// Behaviour tests for the Kids Quest rules engine. Run: node --test ashaquest/app/
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "./engine.js";

const sholat = (id) => ({
  id, kind: "outcome", name: id, emoji: "🕌", category_id: "ibadah", daily_required: true, start_date: "2026-11-16",
  outcomes: [{ key: "sendiri", points: 0 }, { key: "jamaah", points: 1 }, { key: "tidak", points: -1 }],
  missed_key: "tidak",
});
const mengaji = {
  id: "ngaji", kind: "weekly", name: "Mengaji", emoji: "📖", category_id: "ibadah", unit: "halaman",
  quota: 1, penalty: -2, bonus_per_unit: 2, partial: false, start_date: "2026-11-16",
};
const e = (o) => Object.assign({ status: "approved", points: 0, qty: 1 }, o);

test("periods are two-week blocks from the anchor, payday the Monday after", () => {
  const cfg = { anchor: "2026-11-16", periodDays: 14 };
  assert.deepEqual(E.periodOf("2026-11-29", cfg), { index: 0, start: "2026-11-16", end: "2026-11-29", payday: "2026-11-30" });
  assert.deepEqual(E.periodOf("2026-11-30", cfg), { index: 1, start: "2026-11-30", end: "2026-12-13", payday: "2026-12-14" });
  assert.equal(E.periodOf("2026-11-12", cfg).index, -1);
});

test("weeks run Monday to Sunday", () => {
  assert.equal(E.weekStart("2026-11-22"), "2026-11-16"); // Sunday
  assert.equal(E.weekStart("2026-11-23"), "2026-11-23"); // Monday
});

test("local date follows the family time zone", () => {
  assert.equal(E.localDate("2026-11-16T23:30:00Z", "Europe/Amsterdam"), "2026-11-17");
  assert.equal(E.localDate("2026-11-16T22:30:00Z", "Europe/Amsterdam"), "2026-11-16");
});

test("an unlogged prayer on a closed day becomes a missed entry", () => {
  const autos = E.deriveAutoEntries({
    today: "2026-11-18", activities: [sholat("subuh")],
    entries: [e({ activity_id: "subuh", date: "2026-11-16", outcome_key: "jamaah", points: 1 })],
  });
  assert.deepEqual(autos.map((a) => [a.auto_key, a.points, a.date]), [["miss:subuh:2026-11-17", -1, "2026-11-17"]]);
});

test("today is not closed, and days before the activity started are ignored", () => {
  const autos = E.deriveAutoEntries({ today: "2026-11-16", activities: [sholat("isya")], entries: [] });
  assert.equal(autos.length, 0);
});

test("a pending log fills the slot, a rejected one does not", () => {
  const base = { today: "2026-11-17", activities: [sholat("subuh")] };
  assert.equal(E.deriveAutoEntries({ ...base, entries: [e({ activity_id: "subuh", date: "2026-11-16", status: "pending" })] }).length, 0);
  assert.equal(E.deriveAutoEntries({ ...base, entries: [e({ activity_id: "subuh", date: "2026-11-16", status: "rejected" })] }).length, 1);
});

test("an auto entry that already exists, even waived, is not created again", () => {
  const autos = E.deriveAutoEntries({
    today: "2026-11-17", activities: [sholat("subuh")],
    entries: [e({ auto_key: "miss:subuh:2026-11-16", status: "waived", points: -1, date: "2026-11-16" })],
  });
  assert.equal(autos.length, 0);
});

test("excused days skip prayer penalties", () => {
  const autos = E.deriveAutoEntries({ today: "2026-11-17", activities: [sholat("subuh")], entries: [], excused: ["2026-11-16"] });
  assert.equal(autos.length, 0);
});

test("weekly obligation: missing the quota gives the penalty once the week closes", () => {
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [mengaji], entries: [] });
  assert.deepEqual(autos.map((a) => [a.auto_key, a.points, a.date]), [["week:ngaji:2026-11-16", -2, "2026-11-22"]]);
});

test("weekly obligation: meeting the quota exactly gives nothing", () => {
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [mengaji], entries: [e({ activity_id: "ngaji", date: "2026-11-18", qty: 1 })] });
  assert.equal(autos.length, 0);
});

test("weekly obligation: pages above the quota earn the bonus per page", () => {
  const entries = [e({ activity_id: "ngaji", date: "2026-11-17", qty: 2 }), e({ activity_id: "ngaji", date: "2026-11-20", qty: 2, status: "pending" })];
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [mengaji], entries });
  assert.deepEqual(autos.map((a) => a.points), [6]); // 4 pages, quota 1, 3 extra x 2
});

test("weekly obligation: partial penalty scales with the shortfall", () => {
  const act = { ...mengaji, quota: 4, penalty: -2, partial: true };
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [act], entries: [e({ activity_id: "ngaji", date: "2026-11-17", qty: 2 })] });
  assert.deepEqual(autos.map((a) => a.points), [-1]);
});

test("weekly obligation: a week still running gives nothing yet", () => {
  assert.equal(E.deriveAutoEntries({ today: "2026-11-22", activities: [mengaji], entries: [] }).length, 0);
});

const screen = { start_date: "2026-11-16", weekdayLimitMin: 60, weekendLimitMin: 120, overBlockMin: 15, overPenalty: -1, leftoverBlockMin: 30, leftoverPointsPerBlock: 1 };

test("screen minutes are split across local midnight", () => {
  const s = [{ started_at: "2026-11-16T22:30:00Z", ended_at: "2026-11-16T23:30:00Z" }]; // 23:30-00:30 Amsterdam
  assert.deepEqual(E.screenMinutesByDay(s, "Europe/Amsterdam"), { "2026-11-16": 30, "2026-11-17": 30 });
});

test("overtime costs points per started block", () => {
  const sessions = [{ started_at: "2026-11-16T15:00:00Z", ended_at: "2026-11-16T16:20:00Z" }]; // 80 min Monday
  const autos = E.deriveAutoEntries({ today: "2026-11-17", activities: [], entries: [], sessions, screen, tz: "Europe/Amsterdam" });
  assert.deepEqual(autos.map((a) => [a.auto_key, a.points]), [["st-over:2026-11-16", -2]]);
});

test("unused screen time is rewarded weekly per full block", () => {
  // Week 16-22 Nov: Mon uses 80 (0 left), Tue-Fri unused 4x60, Sat-Sun unused 2x120 => 480 min left = 16 blocks
  const sessions = [{ started_at: "2026-11-16T15:00:00Z", ended_at: "2026-11-16T16:20:00Z" }];
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [], entries: [], sessions, screen, tz: "Europe/Amsterdam" });
  const left = autos.find((a) => a.auto_key === "st-left:2026-11-16");
  assert.equal(left.points, 16);
  assert.equal(left.date, "2026-11-22");
});

test("summary shows reported and approved points for a range", () => {
  const entries = [
    e({ date: "2026-11-16", points: 3 }), e({ date: "2026-11-17", points: 2, status: "pending" }),
    e({ date: "2026-11-17", points: 5, status: "rejected" }), e({ date: "2026-11-30", points: 9 }),
  ];
  assert.deepEqual(E.summarize(entries, "2026-11-16", "2026-11-29"), { approved: 3, pending: 2, reported: 5 });
});

test("payday pays approved, unpaid entries up to the period end", () => {
  const entries = [
    e({ id: "a", date: "2026-11-20", points: 4 }), e({ id: "b", date: "2026-11-21", points: -1 }),
    e({ id: "c", date: "2026-11-10", points: 2 }), // late approval from an earlier period
    e({ id: "d", date: "2026-11-21", points: 3, payday_id: "p0" }), e({ id: "f", date: "2026-11-22", points: 1, status: "pending" }),
    e({ id: "g", date: "2026-11-30", points: 7 }),
  ];
  const r = E.payable(entries, "2026-11-29", 10);
  assert.deepEqual(r.ids.sort(), ["a", "b", "c"]);
  assert.equal(r.points, 5);
  assert.equal(r.cents, 50);
});

test("payday ignores entries before the child's start date (trial days)", () => {
  const entries = [e({ id: "a", date: "2026-11-14", points: 5 }), e({ id: "b", date: "2026-11-16", points: 2 })];
  assert.deepEqual(E.payable(entries, "2026-11-29", 10, "2026-11-16").ids, ["b"]);
});

test("negative points make negative pay", () => {
  assert.equal(E.payable([e({ id: "a", date: "2026-11-20", points: -3 })], "2026-11-29", 10).cents, -30);
});

test("balance counts approved money only", () => {
  const tx = [{ cents: 500, status: "approved" }, { cents: -120, status: "approved" }, { cents: -300, status: "pending" }];
  assert.equal(E.balance(tx), 380);
});

test("charity points use the category ratio", () => {
  assert.equal(E.charityPoints(-100, 10, 0.5), 5);
  assert.equal(E.charityPoints(-150, 10, 0.5), 8); // 7.5 rounds up
});

test("entry points: simple x qty, outcome by key, weekly 0", () => {
  assert.equal(E.entryPoints({ kind: "simple", points: 2 }, { qty: 3 }), 6);
  assert.equal(E.entryPoints(sholat("x"), { outcome_key: "jamaah" }), 1);
  assert.equal(E.entryPoints(mengaji, { qty: 5 }), 0);
});

test("allowance dates: weekly on a weekday, monthly on a day of month", () => {
  assert.deepEqual(E.allowanceDates({ freq: "weekly", weekday: 1, start_date: "2026-11-16" }, "2026-11-10", "2026-11-30"), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.deepEqual(E.allowanceDates({ freq: "monthly", monthday: 1, start_date: "2026-11-16" }, "2026-11-01", "2027-01-15"), ["2026-12-01", "2027-01-01"]);
});

// ---- round 2: weeks follow the payday cycle ----
test("week start follows the cycle anchor (Friday cycle)", () => {
  assert.equal(E.weekStartFrom("2026-11-19", "2026-11-13"), "2026-11-13"); // Thursday -> Friday before
  assert.equal(E.weekStartFrom("2026-11-20", "2026-11-13"), "2026-11-20"); // Friday
  assert.equal(E.weekStartFrom("2026-11-10", "2026-11-13"), "2026-11-06"); // before the anchor
});

test("weekly obligation uses the cycle week and counts a partial first week", () => {
  const act = { ...mengaji, quota: 1, penalty: -5, start_date: "2026-11-14" };
  // cycle Fri 13 - Thu 19; child starts Sat 14; the week closes when Friday 20 begins
  assert.equal(E.deriveAutoEntries({ today: "2026-11-19", weekAnchor: "2026-11-13", activities: [act], entries: [] }).length, 0);
  const autos = E.deriveAutoEntries({ today: "2026-11-20", weekAnchor: "2026-11-13", activities: [act], entries: [] });
  assert.deepEqual(autos.map((a) => [a.auto_key, a.points, a.date]), [["week:ngaji:2026-11-13", -5, "2026-11-19"]]);
});

test("entries before the start date do not count toward a partial week", () => {
  const act = { ...mengaji, start_date: "2026-11-14" };
  const autos = E.deriveAutoEntries({ today: "2026-11-20", weekAnchor: "2026-11-13", activities: [act], entries: [e({ activity_id: "ngaji", date: "2026-11-13", qty: 5 })] });
  assert.deepEqual(autos.map((a) => a.points), [-2]);
});

test("a parent adjustment changes that day's screen limit", () => {
  const scr = { ...screen, adjust: { "2026-11-16": 30 } };
  assert.equal(E.screenLimit(scr, "2026-11-16"), 90);
  assert.equal(E.screenLimit(scr, "2026-11-17"), 60);
  const sessions = [{ started_at: "2026-11-16T15:00:00Z", ended_at: "2026-11-16T16:20:00Z" }]; // 80 min, limit 90
  const autos = E.deriveAutoEntries({ today: "2026-11-17", activities: [], entries: [], sessions, screen: scr, tz: "Europe/Amsterdam" });
  assert.equal(autos.length, 0);
});

test("screen leftover in a partial first week counts only days from the start", () => {
  const scr = { ...screen, start_date: "2026-11-18" }; // Wed; Monday-anchored week 16-22
  const autos = E.deriveAutoEntries({ today: "2026-11-23", activities: [], entries: [], sessions: [], screen: scr, tz: "Europe/Amsterdam" });
  // Wed-Fri 3x60 + Sat-Sun 2x120 = 420 min = 14 blocks
  assert.equal(autos.find((a) => a.auto_key === "st-left:2026-11-16").points, 14);
});

test("entries logged today for an activity are counted for the daily limit", () => {
  const entries = [e({ activity_id: "kamar", date: "2026-11-16" }), e({ activity_id: "kamar", date: "2026-11-16", status: "rejected" })];
  assert.equal(E.countToday(entries, "kamar", "2026-11-16"), 1);
});
