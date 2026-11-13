// Data access for Kids Quest. All security is enforced by the database (RLS); this file only shapes calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as E from "./engine.js";

export const SUPABASE_URL = "https://giedyhskakaarfxylrsy.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_E_Ffj6dlK78QeMOHKYp6gA_YIZhCxKv"; // safe to publish; access is governed by RLS
export const sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

export const childEmail = (code, username) => `${username}.${code}@kids.kidsquest.app`;

async function must(q) {
  const r = await q;
  if (r.error) throw r.error;
  return r.data;
}

export async function signInParent(email, password) {
  const r = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (r.error) throw r.error;
}
export async function signInChild(code, username, pin) {
  const r = await sb.auth.signInWithPassword({ email: childEmail(code.trim().toLowerCase(), username.trim().toLowerCase()), password: pin });
  if (r.error) throw r.error;
}
export const signOut = () => sb.auth.signOut();

/** Everything the signed-in member may see, in one snapshot. */
export async function loadAll() {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return null;
  const uid = u.user.id;
  const me = (await must(sb.from("members").select("*").eq("user_id", uid))).at(0) || null;
  const isAdmin = (await must(sb.from("platform_admins").select("user_id").eq("user_id", uid))).length > 0;
  if (!me) return { uid, me: null, isAdmin };
  const since = E.addDays(E.localDate(new Date(), "Europe/Amsterdam"), -120);
  const [family, members, children, categories, activities, entries, money, paydays, sessions, excused, templates] = await Promise.all([
    must(sb.from("families").select("*").eq("id", me.family_id).single()),
    must(sb.from("members").select("user_id,role,child_id,display_name").eq("family_id", me.family_id)),
    must(sb.from("children").select("*").eq("family_id", me.family_id).order("sort")),
    must(sb.from("categories").select("*").eq("family_id", me.family_id).order("sort")),
    must(sb.from("activities").select("*").eq("family_id", me.family_id).order("sort")),
    must(sb.from("entries").select("*").eq("family_id", me.family_id).gte("date", since).order("created_at", { ascending: false }).limit(5000)),
    must(sb.from("money_tx").select("*").eq("family_id", me.family_id).order("created_at", { ascending: false }).limit(5000)),
    must(sb.from("paydays").select("*").eq("family_id", me.family_id).order("period_end", { ascending: false })),
    must(sb.from("screen_sessions").select("*").eq("family_id", me.family_id).gte("started_at", new Date(Date.now() - 40 * 864e5).toISOString()).order("started_at", { ascending: false })),
    must(sb.from("excused_days").select("*").eq("family_id", me.family_id)),
    must(sb.from("templates").select("*").order("created_at", { ascending: false })),
  ]);
  return { uid, me, isAdmin, family, members, children, categories, activities, entries, money, paydays, sessions, excused, templates };
}

// ---------- child actions ----------
export const logEntry = (childId, activity, { date, qty, outcome_key, note }) =>
  must(sb.from("entries").insert({ child_id: childId, activity_id: activity.id, title: activity.name, date, qty: qty ?? null, outcome_key: outcome_key || null, note: note || null, status: "pending", source: "child" }));
export const proposeEntry = (childId, { title, emoji, category_id, requested_points, date, note }) =>
  must(sb.from("entries").insert({ child_id: childId, title, emoji: emoji || "💡", category_id: category_id || null, requested_points, date, note: note || null, status: "pending", source: "proposal" }));
export const askSpend = (childId, { category_id, cents, note, date }) =>
  must(sb.from("money_tx").insert({ child_id: childId, category_id, cents: -Math.abs(cents), note, date, status: "pending", source: "child" }));
export const deleteEntry = (id) => must(sb.from("entries").delete().eq("id", id));
export const deleteTx = (id) => must(sb.from("money_tx").delete().eq("id", id));
export const screenStart = (deviceId) => must(sb.rpc("screen_start", { p_device: deviceId }));
export const screenStop = () => must(sb.rpc("screen_stop"));

// ---------- parent actions ----------
const stamp = (uid) => ({ decided_by: uid, decided_at: new Date().toISOString() });
export async function decideEntry(uid, entry, ok, extra = {}, allEntries = []) {
  await must(sb.from("entries").update({ status: ok ? "approved" : "rejected", ...stamp(uid), ...extra }).eq("id", entry.id));
  // A late log for a prayer slot replaces the automatic "missed" entry for the same slot.
  if (ok && entry.activity_id) {
    const auto = allEntries.find((x) => x.auto_key === "miss:" + entry.activity_id + ":" + entry.date && x.status === "approved" && !x.payday_id);
    if (auto) await must(sb.from("entries").update({ status: "waived", ...stamp(uid) }).eq("id", auto.id));
  }
}
export const setEntryStatus = (uid, id, status) => must(sb.from("entries").update({ status, ...stamp(uid) }).eq("id", id));
export const parentLog = (uid, childId, activity, { date, qty, outcome_key, note, points }) =>
  must(sb.from("entries").insert({
    child_id: childId, activity_id: activity?.id || null, category_id: activity?.category_id || null, title: activity?.name || note || "Catatan",
    emoji: activity?.emoji || "⭐", date, qty: qty ?? null, outcome_key: outcome_key || null, note: note || null,
    points: activity ? E.entryPoints(activity, { qty, outcome_key }) : points, status: "approved", source: "parent", ...stamp(uid),
  }));
export const decideTx = (uid, id, ok) => must(sb.from("money_tx").update({ status: ok ? "approved" : "rejected", ...stamp(uid) }).eq("id", id));
export const addMoney = (uid, childId, { category_id, cents, note, date }) =>
  must(sb.from("money_tx").insert({ child_id: childId, category_id: category_id || null, cents, note, date, status: "approved", source: "parent", ...stamp(uid) }));

/** Write automatic entries the hourly job would write, so a manual payday is complete. */
export async function materializeAutos(state, child, today) {
  const lastPaid = state.paydays.filter((p) => p.child_id === child.id && p.status === "paid").map((p) => p.period_end).sort().at(-1);
  let from = E.addDays(today, -45);
  if (lastPaid && E.addDays(lastPaid, 1) > from) from = E.addDays(lastPaid, 1);
  if (child.start_date > from) from = child.start_date;
  const autos = E.deriveAutoEntries({
    today, fromDate: from,
    activities: state.activities.filter((a) => a.child_id === child.id),
    entries: state.entries.filter((x) => x.child_id === child.id),
    excused: child.excused_enabled ? state.excused.filter((x) => x.child_id === child.id).map((x) => x.date) : [],
    sessions: state.sessions.filter((s) => s.child_id === child.id),
    screen: child.screen?.enabled === false ? null : { ...child.screen, start_date: child.start_date },
    tz: state.family.timezone,
  });
  if (!autos.length) return 0;
  await must(sb.from("entries").upsert(autos.map((a) => ({
    child_id: child.id, activity_id: a.activity_id || null, category_id: a.category_id || null, title: a.title, emoji: a.emoji,
    date: a.date, qty: a.qty ?? null, outcome_key: a.outcome_key || null, points: a.points, status: "approved", source: "auto",
    auto_key: a.auto_key, decided_at: new Date().toISOString(),
  })), { onConflict: "child_id,auto_key", ignoreDuplicates: true }));
  return autos.length;
}
export const payChild = (childId, upto) => must(sb.rpc("pay_child", { p_child: childId, p_upto: upto }));

export const updateFamily = (id, patch) => must(sb.from("families").update(patch).eq("id", id));
export const updateChild = (id, patch) => must(sb.from("children").update(patch).eq("id", id));
export const saveActivity = (a) => { const r = { ...strip(a), category_id: a.category_id || null }; return a.id ? must(sb.from("activities").update(r).eq("id", a.id)) : must(sb.from("activities").insert(r).select()); };
export const deleteActivity = (id) => must(sb.from("activities").delete().eq("id", id));
export const saveCategory = (c) => c.id ? must(sb.from("categories").update(strip(c)).eq("id", c.id)) : must(sb.from("categories").insert(strip(c)));
export const updateSession = (id, patch) => must(sb.from("screen_sessions").update(patch).eq("id", id));
export const deleteSession = (id) => must(sb.from("screen_sessions").delete().eq("id", id));
export const addExcused = (childId, date) => must(sb.from("excused_days").upsert({ child_id: childId, date }, { onConflict: "child_id,date", ignoreDuplicates: true }));
export const removeExcused = (childId, date) => must(sb.from("excused_days").delete().eq("child_id", childId).eq("date", date));
function strip(o) { const c = { ...o }; delete c.id; delete c.created_at; delete c.family_id; return c; }

// templates: activities stored with category names so they move between families
export function templateFrom(state, child) {
  const cat = (id) => state.categories.find((c) => c.id === id)?.name || null;
  return {
    screen: child.screen,
    activities: state.activities.filter((a) => a.child_id === child.id).map((a) => ({
      kind: a.kind, name: a.name, emoji: a.emoji, unit: a.unit, points: a.points, outcomes: a.outcomes, missed_key: a.missed_key,
      daily_required: a.daily_required, quota: a.quota, penalty: a.penalty, bonus_per_unit: a.bonus_per_unit, partial: a.partial,
      active: a.active, sort: a.sort, category: cat(a.category_id),
    })),
  };
}
export const saveTemplate = (familyId, name, data) => must(sb.from("templates").insert({ family_id: familyId, name, data }));
export async function applyTemplate(state, child, tpl, startDate) {
  const catId = (name) => state.categories.find((c) => c.kind === "activity" && c.name === name)?.id || null;
  const rows = (tpl.data.activities || []).map((a) => {
    const r = { ...a, child_id: child.id, category_id: catId(a.category), start_date: startDate };
    delete r.category;
    return r;
  });
  if (rows.length) await must(sb.from("activities").insert(rows));
  if (tpl.data.screen) await updateChild(child.id, { screen: tpl.data.screen });
}

export async function accounts(body) {
  const { data, error } = await sb.functions.invoke("accounts", { body });
  if (error) {
    let code = error.message;
    try { code = (await error.context.json()).error || code; } catch { /* keep message */ }
    throw new Error(code);
  }
  return data;
}
