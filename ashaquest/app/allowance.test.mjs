// When is the next allowance paid? Run: node --test ashaquest/app/
import test from "node:test";
import assert from "node:assert/strict";
import { nextAllowance } from "./allowance.js";

// Asha: Fri–Thu weeks, payday Friday 19:00, allowance €2 a week paid with payday.
const asha = {
  start_date: "2026-11-14", period_anchor: "2026-11-13", period_days: 7, payday_hour: 19, payday_mode: "auto",
  allowance: { enabled: true, mode: "payday", cents: 200 },
};

test("with payday: next payday, amount times weeks in the period", () => {
  const n = nextAllowance(asha, { today: "2026-11-18", hour: 10 });
  assert.deepEqual(n, { date: "2026-11-20", hour: 19, cents: 200, weeks: 1, mode: "payday", payMode: "auto" });
  const two = nextAllowance({ ...asha, period_days: 14 }, { today: "2026-11-18", hour: 10 });
  assert.equal(two.cents, 400);
  assert.equal(two.date, "2026-11-27");
});

test("on payday before the hour it is today; after it is paid, next week", () => {
  assert.equal(nextAllowance(asha, { today: "2026-11-20", hour: 8 }).date, "2026-11-20");
  assert.equal(nextAllowance(asha, { today: "2026-11-20", hour: 20, paidPeriodEnds: ["2026-11-19"] }).date, "2026-11-27");
  assert.equal(nextAllowance(asha, { today: "2026-11-20", hour: 8, paidPeriodEnds: ["2026-11-19"] }).date, "2026-11-27");
});

test("child not started yet: first payday after the start", () => {
  assert.equal(nextAllowance({ ...asha, start_date: "2026-12-01" }, { today: "2026-11-18", hour: 10 }).date, "2026-12-04");
});

test("off or zero amount: nothing", () => {
  assert.equal(nextAllowance({ ...asha, allowance: { enabled: false, mode: "payday", cents: 200 } }, { today: "2026-11-18", hour: 10 }), null);
  assert.equal(nextAllowance({ ...asha, allowance: { enabled: true, mode: "payday", cents: 0 } }, { today: "2026-11-18", hour: 10 }), null);
});

test("own schedule every 2 weeks on Monday", () => {
  const c = { ...asha, allowance: { enabled: true, mode: "schedule", cents: 300, freq: "weekly", everyWeeks: 2, weekday: 1, start_date: "2026-11-16" } };
  assert.deepEqual(nextAllowance(c, { today: "2026-11-18", hour: 10 }), { date: "2026-11-30", cents: 300, mode: "schedule" });
  // due today but not written yet → today; once written → the one after
  assert.equal(nextAllowance(c, { today: "2026-11-30", hour: 0 }).date, "2026-11-30");
  assert.equal(nextAllowance(c, { today: "2026-11-30", hour: 9, paidKeys: ["allow:2026-11-30"] }).date, "2026-12-14");
});

test("own schedule monthly on the 1st", () => {
  const c = { ...asha, allowance: { enabled: true, mode: "schedule", cents: 1000, freq: "monthly", monthday: 1, start_date: "2026-11-14" } };
  assert.equal(nextAllowance(c, { today: "2026-11-18", hour: 10 }).date, "2026-12-01");
  assert.equal(nextAllowance(c, { today: "2026-12-01", hour: 9, paidKeys: ["allow:2026-12-01"] }).date, "2027-01-01");
});
