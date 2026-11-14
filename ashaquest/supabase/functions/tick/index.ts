// Kids Quest hourly job. Idempotent: safe to run any number of times.
// Per child: stop forgotten timers, write automatic entries, pay allowance, handle payday by family mode.
// Called by pg_cron with the x-tick-secret header (checked against the database vault).
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as E from "./engine.js";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function localHour(tz: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
}
const screenCfg = (c: any, adj: any[]) => c.screen?.enabled === false ? null
  : { ...c.screen, start_date: c.start_date, adjust: Object.fromEntries(adj.map((x: any) => [x.date, x.minutes])) };

async function tickChild(f: any, c: any, today: string, log: string[]) {
  // 1. forgotten timers stop at 23:59 of the day they started
  const open = (await db.from("screen_sessions").select("*").eq("child_id", c.id).is("ended_at", null)).data || [];
  for (const s of open) {
    const day = E.localDate(s.started_at, f.timezone);
    if (day < today) {
      const end = new Date(E.localMidnight(E.addDays(day, 1), f.timezone) - 60000).toISOString();
      await db.from("screen_sessions").update({ ended_at: end, auto_stopped: true, needs_review: true }).eq("id", s.id);
      log.push(`${c.username}: stopped timer from ${day}`);
    }
  }

  // 2. automatic entries since the last paid period (max 45 days back)
  const lastPaid = (await db.from("paydays").select("period_end").eq("child_id", c.id).eq("status", "paid").order("period_end", { ascending: false }).limit(1)).data?.[0]?.period_end;
  let from = E.addDays(today, -45);
  if (lastPaid && E.addDays(lastPaid, 1) > from) from = E.addDays(lastPaid, 1);
  if (c.start_date > from) from = c.start_date;
  const [acts, ents, sess, exc, adj] = await Promise.all([
    db.from("activities").select("*").eq("child_id", c.id),
    db.from("entries").select("id,activity_id,date,status,qty,auto_key").eq("child_id", c.id).gte("date", E.addDays(from, -7)),
    db.from("screen_sessions").select("started_at,ended_at").eq("child_id", c.id).gte("started_at", new Date(E.localMidnight(E.addDays(from, -1), f.timezone)).toISOString()),
    c.excused_enabled ? db.from("excused_days").select("date").eq("child_id", c.id) : Promise.resolve({ data: [] }),
    db.from("screen_adjust").select("date,minutes").eq("child_id", c.id).gte("date", from),
  ]);
  const autos = E.deriveAutoEntries({
    today, fromDate: from, activities: acts.data || [], entries: ents.data || [],
    excused: (exc.data || []).map((x: any) => x.date), sessions: sess.data || [], screen: screenCfg(c, adj.data || []), tz: f.timezone, weekAnchor: c.period_anchor,
  });
  if (autos.length) {
    const rows = autos.map((a: any) => ({
      child_id: c.id, activity_id: a.activity_id || null, category_id: a.category_id || null, title: a.title, emoji: a.emoji,
      date: a.date, qty: a.qty ?? null, outcome_key: a.outcome_key || null, points: a.points,
      status: "approved", source: "auto", auto_key: a.auto_key, decided_at: new Date().toISOString(),
    }));
    const r = await db.from("entries").upsert(rows, { onConflict: "child_id,auto_key", ignoreDuplicates: true });
    if (r.error) log.push(`${c.username}: auto entries failed: ${r.error.message}`); else log.push(`${c.username}: ${rows.length} auto entries`);
  }

  // 3. allowance
  const al = c.allowance || {};
  if (al.enabled && al.cents > 0 && al.mode !== "payday") {
    const cat = (await db.from("categories").select("id").eq("family_id", f.id).eq("kind", "income").eq("name", "Uang saku").maybeSingle()).data;
    const dates = E.allowanceDates({ ...al, start_date: al.start_date || c.start_date }, E.addDays(today, -14), today);
    if (dates.length) {
      await db.from("money_tx").upsert(dates.map((d: string) => ({
        child_id: c.id, category_id: cat?.id || null, cents: al.cents, note: "Uang saku", date: d,
        status: "approved", source: "allowance", auto_key: "allow:" + d, decided_at: new Date().toISOString(),
      })), { onConflict: "child_id,auto_key", ignoreDuplicates: true });
    }
  }

  // 4. payday for the period that just ended, from the child's payday hour on payday
  const cyc = { anchor: c.period_anchor, periodDays: c.period_days };
  const cur = E.periodOf(today, cyc);
  const prevEnd = E.addDays(cur.start, -1);
  const prev = E.periodOf(prevEnd, cyc);
  if (prevEnd < c.start_date || c.payday_mode === "manual" || localHour(f.timezone) < (c.payday_hour ?? 6)) return;
  const pd = (await db.from("paydays").select("*").eq("child_id", c.id).eq("period_end", prevEnd).maybeSingle()).data;
  if (pd?.status === "paid") return;
  if (c.payday_mode === "auto") {
    const r = await db.rpc("pay_child", { p_child: c.id, p_upto: prevEnd });
    log.push(`${c.username}: auto payday ${prevEnd} ${r.error ? "failed: " + r.error.message : "paid"}`);
  } else if (!pd) {
    const all = (await db.from("entries").select("id,date,points,status,payday_id").eq("child_id", c.id).is("payday_id", null)).data || [];
    const p = E.payable(all, prevEnd, f.cents_per_point, c.start_date);
    await db.from("paydays").upsert({ child_id: c.id, period_start: prev.start, period_end: prevEnd, points: p.points, cents: p.cents, status: "draft" }, { onConflict: "child_id,period_end", ignoreDuplicates: true });
    log.push(`${c.username}: payday draft ${prevEnd}`);
  }
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-tick-secret") || "";
  const ok = await db.rpc("tick_secret_ok", { p_secret: secret });
  if (ok.error || ok.data !== true) return new Response("forbidden", { status: 403 });
  const log: string[] = [];
  const fams = (await db.from("families").select("*")).data || [];
  for (const f of fams) {
    const today = E.localDate(new Date(), f.timezone);
    const kids = (await db.from("children").select("*").eq("family_id", f.id)).data || [];
    for (const c of kids) {
      if (c.start_date > today) continue;
      try { await tickChild(f, c, today, log); } catch (e) { log.push(`${c.username}: error ${(e as Error).message}`); }
    }
  }
  console.log(log.join("\n"));
  return new Response(JSON.stringify({ ok: true, log }), { headers: { "Content-Type": "application/json" } });
});
