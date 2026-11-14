// Kids Quest web app (Asha Quest). Preact + htm, no build step.
import { h, render } from "https://esm.sh/preact@10.24.3";
import { useState, useEffect, useMemo, useCallback, useRef } from "https://esm.sh/preact@10.24.3/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as E from "./engine.js";
import * as A from "./api.js";
import { t, locale } from "./i18n.js";

const html = htm.bind(h);

// ---------- formatting ----------
const eur = (c) => (c < 0 ? "−" : "") + (Math.abs(c) / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
const fmtDay = (s, long) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(locale, long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" }); };
const parseEur = (v) => { const n = Number(String(v).replace(/[€\s]/g, "").replace(",", ".")); return isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const errText = (e) => { const m = String(e?.message || e); return m.includes("period_paid") ? t("errPaid") : t("errGeneric", { m }); };
const amtClass = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");

function Tag({ status, auto }) {
  if (auto && status === "approved") return html`<span class="tag auto">${t("st_auto")}</span>`;
  const cls = { pending: "wait", approved: "ok", rejected: "no", waived: "no" }[status] || "info";
  return html`<span class="tag ${cls}">${t("st_" + status)}</span>`;
}

const Mascot = ({ size = 56 }) => html`<svg width=${size} height=${Math.round(size * 0.78)} viewBox="0 0 64 50" aria-hidden="true">
  <path d="M15 46c-8 0-11-7-7-12-3-7 4-14 11-11 2-9 15-11 19-3 7-5 18 1 15 10 7 4 5 16-4 16z" fill="#fff" stroke="#b9d8f3" stroke-width="2"/>
  <circle cx="51" cy="9" r="5" fill="#ffd66b"/></svg>`;

// ---------- toast + sheet ----------
let showToast = () => {};
function Toast() {
  const [msg, setMsg] = useState(null);
  const tm = useRef();
  showToast = (m) => { setMsg(m); clearTimeout(tm.current); tm.current = setTimeout(() => setMsg(null), 2800); };
  return msg ? html`<div class="toast" role="status">${msg}</div>` : null;
}
function Sheet({ title, onClose, children }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}><h3>${title}</h3>${children}</div></div>`;
}
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => { if (busy) return; setBusy(true); try { await fn(); okMsg && showToast(okMsg); return true; } catch (e) { showToast(errText(e)); return false; } finally { setBusy(false); } };
  return [busy, run];
}

// ---------- derived data per child ----------
function childView(S, child) {
  const tz = S.family.timezone;
  const today = E.localDate(new Date(), tz);
  const period = E.periodOf(today, { anchor: S.family.period_anchor, periodDays: S.family.period_days });
  const entries = S.entries.filter((x) => x.child_id === child.id);
  const money = S.money.filter((x) => x.child_id === child.id);
  const acts = S.activities.filter((a) => a.child_id === child.id).sort((a, b) => a.sort - b.sort);
  const sessions = S.sessions.filter((s) => s.child_id === child.id);
  return { tz, today, period, entries, money, acts, sessions, balance: E.balance(money), sum: E.summarize(entries, period.start, period.end) };
}

// =====================================================================
// Login
function Login() {
  const [tab, setTab] = useState("child");
  const saved = (() => { try { return JSON.parse(localStorage.getItem("kq_child") || "{}"); } catch { return {}; } })();
  const [f, setF] = useState({ email: "", password: "", code: saved.code || "", username: saved.username || "", pin: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      if (tab === "parent") await A.signInParent(f.email, f.password);
      else { await A.signInChild(f.code, f.username, f.pin); try { localStorage.setItem("kq_child", JSON.stringify({ code: f.code, username: f.username })); } catch { /* ignore */ } }
    } catch { setErr(t("signInFail")); }
    setBusy(false);
  };
  return html`<main class="login">
    <div class="mascot"><${Mascot} size=${96} /></div>
    <h1 style="text-align:center;font-size:34px">${t("app")}</h1>
    <div class="seg">
      <button type="button" aria-pressed=${tab === "child"} onClick=${() => setTab("child")}>${t("childTab")}</button>
      <button type="button" aria-pressed=${tab === "parent"} onClick=${() => setTab("parent")}>${t("parentTab")}</button>
    </div>
    <form class="panel" onSubmit=${submit}>
      ${tab === "parent" ? html`
        <label class="f">${t("email")}<input class="in" id="l-email" type="email" autocomplete="username" value=${f.email} onInput=${set("email")} required /></label>
        <label class="f">${t("password")}<input class="in" id="l-pass" type="password" autocomplete="current-password" value=${f.password} onInput=${set("password")} required /></label>` : html`
        <label class="f">${t("familyCode")}<input class="in" id="l-code" autocapitalize="none" value=${f.code} onInput=${set("code")} required /></label>
        <label class="f">${t("username")}<input class="in" id="l-user" autocapitalize="none" autocomplete="username" value=${f.username} onInput=${set("username")} required /></label>
        <label class="f">${t("pin")}<input class="in" id="l-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" value=${f.pin} onInput=${set("pin")} required /></label>`}
      ${err && html`<p class="err">${err}</p>`}
      <button class="btn big" disabled=${busy}>${t("signIn")}</button>
    </form>
  </main>`;
}

// =====================================================================
// Child home
function SavingsHero({ S, child, v }) {
  const debt = v.balance < 0;
  return html`<section class="hero">
    <div class="money ${debt ? "debt" : ""}">
      <span class="lbl">${debt ? t("debt") : t("savings")}</span>
      <span class="big num">${eur(Math.abs(v.balance))}</span>
      <span class="lbl">${t("payday", { date: fmtDay(v.period.payday, true) })}</span>
    </div>
    <div class="points">
      <span class="lbl">${t("points")}</span>
      <span class="big num">${signed(v.sum.approved) || "0"} <span class="small muted">${t("approved")}</span></span>
      <div class="pbar"><span class="tag info">${signed(v.sum.reported) || "0"} ${t("reported")}</span>
        ${v.sum.pending ? html`<span class="tag wait">${signed(v.sum.pending)} ${t("waiting")}</span>` : null}</div>
      <span class="muted small">≈ ${eur(v.sum.approved * S.family.cents_per_point)}</span>
    </div>
  </section>`;
}

function ScreenCard({ S, child, v, reload }) {
  const cfg = child.screen || {};
  const devices = S.categories.filter((c) => c.kind === "screen" && c.active);
  const open = v.sessions.find((s) => !s.ended_at);
  const [now, setNow] = useState(Date.now());
  const [dev, setDev] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { if (!open) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [open?.id]);
  if (cfg.enabled === false) return null;
  const dayStart = E.localMidnight(v.today, v.tz);
  const usedMs = v.sessions.reduce((sum, s) => sum + Math.max(0, Math.min(s.ended_at ? new Date(s.ended_at).getTime() : now, dayStart + 864e5) - Math.max(new Date(s.started_at).getTime(), dayStart)), 0);
  const used = Math.round(usedMs / 60000);
  const limit = E.screenLimit(cfg, v.today);
  const leftMs = limit * 60000 - usedMs;
  const left = Math.ceil(leftMs / 60000);
  return html`<section class="panel screen" aria-label=${t("screen")}>
    <div class="panel-head"><h2>${t("screen")}</h2><span class="muted">${t("usedToday", { m: used, l: limit })}</span></div>
    ${open ? html`
      <p class="muted">${t("running", { what: open.device_label || "" })}</p>
      <div class="clock num ${leftMs < 0 ? "over" : ""}">${leftMs < 0 ? "−" : ""}${mmss(Math.abs(leftMs))}</div>
      ${left >= 0 && left <= (cfg.warnMin || 5) ? html`<div class="banner warn">${t("warn5", { m: left })}</div>` : null}
      ${left < 0 ? html`<div class="banner bad">${t("overNow", { m: -left })}</div>` : html`<p class="muted">${t("leftToday")}</p>`}
      <button class="btn big bad" disabled=${busy} onClick=${() => run(async () => { await A.screenStop(); await reload(); })}>${t("stop")}</button>` : html`
      <div class="clock num ${left < 0 ? "over" : ""}">${left < 0 ? "−" : ""}${Math.abs(left)} <span class="small muted">${t("leftToday")}</span></div>
      <p class="muted">${t("whatPlay")}</p>
      <div class="chips">${devices.map((d) => html`<button type="button" class="chip-btn" aria-pressed=${dev === d.id} onClick=${() => setDev(d.id)}>${d.emoji} ${d.name}</button>`)}</div>
      <button class="btn big" disabled=${!dev || busy} onClick=${() => run(async () => { await A.screenStart(dev); setDev(null); await reload(); })}>${t("start")}</button>`}
  </section>`;
}

function slotState(v, act, day) {
  const xs = v.entries.filter((x) => x.activity_id === act.id && x.date === day && x.status !== "rejected" && x.status !== "waived");
  const real = xs.find((x) => !x.auto_key);
  if (real) return { entry: real, outcome: (act.outcomes || []).find((o) => o.key === real.outcome_key) };
  const auto = xs.find((x) => x.auto_key);
  if (auto) return { entry: auto, missed: true };
  return {};
}

function PrayerStrip({ S, child, v, reload }) {
  const prayers = v.acts.filter((a) => a.kind === "outcome" && a.daily_required && a.active);
  const [day, setDay] = useState(0);
  const [open, setOpen] = useState(null);
  if (!prayers.length) return null;
  const date = E.addDays(v.today, -day);
  return html`<section class="panel">
    <div class="panel-head"><h2>${day ? t("prayersYesterday") : t("prayersToday")}</h2>
      <div class="seg" style="width:200px"><button type="button" aria-pressed=${day === 0} onClick=${() => setDay(0)}>${t("today")}</button><button type="button" aria-pressed=${day === 1} onClick=${() => setDay(1)}>${t("yesterday")}</button></div></div>
    <div class="prayers">${prayers.map((p, i) => {
      const st = slotState(v, p, date);
      const label = st.outcome ? st.outcome.label || st.outcome.key : st.missed ? t("missed") : t("notYet");
      return html`<button type="button" class="prayer t${i % 5} ${st.outcome ? "done" : ""} ${st.missed ? "missed" : ""}" onClick=${() => setOpen(p)}>
        <span class="pi">${p.emoji || "🕌"}</span><span class="pn">${p.name.replace(/^Sholat\s+/i, "")}</span><span class="ps">${label}</span>
        ${st.entry && st.entry.status === "pending" ? html`<span class="tag wait" style="font-size:11px">${t("st_pending")}</span>` : null}</button>`;
    })}</div>
    ${open && html`<${OutcomeSheet} act=${open} date=${date} child=${child} v=${v} onClose=${() => setOpen(null)} reload=${reload} />`}
  </section>`;
}

function OutcomeSheet({ act, date, child, v, onClose, reload }) {
  const st = slotState(v, act, date);
  const [pick, setPick] = useState(st.entry && !st.entry.auto_key ? st.entry.outcome_key : null);
  const [busy, run] = useBusy();
  const locked = st.entry && !st.entry.auto_key && st.entry.status !== "pending";
  const send = () => run(async () => {
    if (st.entry && !st.entry.auto_key && st.entry.status === "pending") await A.deleteEntry(st.entry.id);
    await A.logEntry(child.id, act, { date, outcome_key: pick });
    const o = act.outcomes.find((x) => x.key === pick);
    showToast(o && o.points < 0 ? t("sentHonest") : t("sentWait"));
    onClose(); await reload();
  });
  return html`<${Sheet} title=${t("howPray", { name: act.name.replace(/^Sholat\s+/i, "") }) + " · " + fmtDay(date)} onClose=${onClose}>
    ${locked ? html`<p class="muted">${t("st_approved")}: ${(act.outcomes.find((o) => o.key === st.entry.outcome_key) || {}).label}</p>` : html`
    <div class="outcomes">${(act.outcomes || []).map((o) => html`<button type="button" aria-pressed=${pick === o.key} onClick=${() => setPick(o.key)}>
      <span>${o.label || o.key}</span><span class="amt ${amtClass(o.points)}">${signed(o.points) || "0"}</span></button>`)}</div>
    <div class="row"><button class="btn ghost grow" onClick=${onClose}>${t("cancel")}</button><button class="btn grow" disabled=${!pick || busy} onClick=${send}>${t("praySave")}</button></div>`}
  </${Sheet}>`;
}

function WeeklyCards({ child, v, reload }) {
  const weekly = v.acts.filter((a) => a.kind === "weekly" && a.active);
  const [open, setOpen] = useState(null);
  if (!weekly.length) return null;
  const ws = E.weekStart(v.today);
  return html`<section class="panel">
    <div class="panel-head"><h2>${t("weekly")}</h2><span class="muted">${fmtDay(ws)} – ${fmtDay(E.addDays(ws, 6))}</span></div>
    ${weekly.map((a) => {
      const qty = v.entries.filter((x) => x.activity_id === a.id && !x.auto_key && (x.status === "approved" || x.status === "pending") && x.date >= ws).reduce((s, x) => s + Number(x.qty || 0), 0);
      const pct = Math.min(100, a.quota ? (qty / a.quota) * 100 : 100);
      const bonus = Math.max(0, qty - (a.quota || 0)) * (a.bonus_per_unit || 0);
      return html`<div class="week">
        <div class="row"><span style="font-size:26px">${a.emoji}</span><div class="grow"><b>${a.name}</b><div class="muted small">${qty} / ${a.quota} ${a.unit || ""} · ${qty >= a.quota ? (bonus ? t("weeklyBonus", { p: bonus }) : t("weeklyDone")) : t("weeklyLeft", { n: a.quota - qty, unit: a.unit || "" })}</div></div>
          <button class="btn" onClick=${() => setOpen(a)}>${t("logIt")}</button></div>
        <div class="meter ${qty >= a.quota ? "full" : ""}"><div style="width:${pct}%"></div></div></div>`;
    })}
    ${open && html`<${LogSheet} act=${open} child=${child} v=${v} onClose=${() => setOpen(null)} reload=${reload} />`}
  </section>`;
}

function LogSheet({ act, child, v, onClose, reload, parentUid }) {
  const [qty, setQty] = useState(1);
  const [day, setDay] = useState(0);
  const [note, setNote] = useState("");
  const [busy, run] = useBusy();
  const needsQty = act.kind === "weekly" || !!act.unit;
  const pts = E.entryPoints(act, { qty: needsQty ? qty : 1 });
  const send = () => run(async () => {
    const date = E.addDays(v.today, -day);
    if (parentUid) await A.parentLog(parentUid, child.id, act, { date, qty: needsQty ? qty : null, note });
    else await A.logEntry(child.id, act, { date, qty: needsQty ? qty : null, note });
    showToast(parentUid ? t("saved") : pts < 0 ? t("sentHonest") : t("sentWait"));
    onClose(); await reload();
  });
  return html`<${Sheet} title=${(act.emoji || "") + " " + act.name} onClose=${onClose}>
    ${needsQty ? html`<div class="f"><span class="muted">${t("howMany", { unit: act.unit || "" })}</span>
      <div class="stepper"><button type="button" aria-label="−" onClick=${() => setQty(Math.max(1, qty - 1))}>−</button><span class="v num">${qty}</span><button type="button" aria-label="+" onClick=${() => setQty(qty + 1)}>+</button></div></div>` : null}
    ${act.kind !== "weekly" ? html`<p class="amt ${amtClass(pts)}">${signed(pts) || "0"} poin</p>` : null}
    <div class="seg"><button type="button" aria-pressed=${day === 0} onClick=${() => setDay(0)}>${t("today")}</button><button type="button" aria-pressed=${day === 1} onClick=${() => setDay(1)}>${t("yesterday")}</button></div>
    <label class="f">${t("note")}<input class="in" id="log-note" maxlength="80" value=${note} onInput=${(e) => setNote(e.target.value)} /></label>
    <div class="row"><button class="btn ghost grow" onClick=${onClose}>${t("cancel")}</button><button class="btn grow" disabled=${busy} onClick=${send}>${t("send")}</button></div>
  </${Sheet}>`;
}

function ActivityTiles({ S, child, v, reload }) {
  const list = v.acts.filter((a) => a.kind === "simple" && a.active);
  const [open, setOpen] = useState(null);
  if (!list.length) return null;
  const cats = S.categories.filter((c) => c.kind === "activity");
  const groups = [...cats.map((c) => [c, list.filter((a) => a.category_id === c.id)]), [{ id: null, name: "Lainnya" }, list.filter((a) => !cats.some((c) => c.id === a.category_id))]].filter(([, xs]) => xs.length);
  return html`<section class="panel"><h2>${t("activities")}</h2>
    ${groups.map(([c, xs]) => html`<div class="cat-title">${c.emoji || ""} ${c.name}</div>
      <div class="tiles">${xs.map((a) => html`<button type="button" class="tile ${a.points < 0 ? "neg" : ""}" onClick=${() => setOpen(a)}>
        <span class="em">${a.emoji || "⭐"}</span><span class="nm">${a.name}</span><span class="pt">${signed(a.points)}${a.unit ? " / " + a.unit : ""}</span></button>`)}</div>`)}
    ${open && html`<${LogSheet} act=${open} child=${child} v=${v} onClose=${() => setOpen(null)} reload=${reload} />`}
  </section>`;
}

function ProposeForm({ S, child, v, reload }) {
  const cats = S.categories.filter((c) => c.kind === "activity" && c.active);
  const [f, setF] = useState({ title: "", points: 1, category_id: cats[0]?.id || "", day: 0 });
  const [busy, run] = useBusy();
  const submit = (e) => { e.preventDefault(); if (!f.title.trim()) return;
    run(async () => { await A.proposeEntry(child.id, { title: f.title.trim(), category_id: f.category_id || null, requested_points: Math.max(1, Number(f.points) || 1), date: E.addDays(v.today, -f.day) }); setF({ ...f, title: "", points: 1 }); await reload(); }, t("sentWait")); };
  return html`<section class="panel"><h2>${t("propose")}</h2><p class="muted">${t("proposeHint")}</p>
    <form class="form" onSubmit=${submit}>
      <label class="f full">${t("whatDid")}<input class="in" id="pr-title" maxlength="60" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} required /></label>
      <label class="f">${t("category")}<select class="in" id="pr-cat" value=${f.category_id} onChange=${(e) => setF({ ...f, category_id: e.target.value })}>${cats.map((c) => html`<option value=${c.id}>${c.emoji} ${c.name}</option>`)}</select></label>
      <label class="f">${t("askPoints")}<input class="in" id="pr-pts" type="number" min="1" max="50" value=${f.points} onInput=${(e) => setF({ ...f, points: e.target.value })} /></label>
      <div class="full"><button class="btn" disabled=${busy}>${t("send")}</button></div>
    </form></section>`;
}

function SpendForm({ S, child, v, reload }) {
  const cats = S.categories.filter((c) => c.kind === "spend" && c.active);
  const [f, setF] = useState({ note: "", price: "", category_id: cats[0]?.id || "" });
  const [msg, setMsg] = useState("");
  const [busy, run] = useBusy();
  const cat = cats.find((c) => c.id === f.category_id);
  const cents = parseEur(f.price);
  const submit = (e) => { e.preventDefault(); setMsg("");
    if (!f.note.trim() || !cents) return;
    if (cents > v.balance) { setMsg(t("notEnough", { amt: eur(cents - Math.max(0, v.balance)) })); return; }
    run(async () => { await A.askSpend(child.id, { category_id: f.category_id, cents, note: f.note.trim(), date: v.today }); setF({ ...f, note: "", price: "" }); await reload(); }, t("sentWait")); };
  return html`<section class="panel"><h2>${t("spend")}</h2>
    <form class="form" onSubmit=${submit}>
      <label class="f">${t("category")}<select class="in" id="sp-cat" value=${f.category_id} onChange=${(e) => setF({ ...f, category_id: e.target.value })}>${cats.map((c) => html`<option value=${c.id}>${c.emoji} ${c.name}</option>`)}</select></label>
      <label class="f">${t("price")}<input class="in" id="sp-price" inputmode="decimal" placeholder="2,50" value=${f.price} onInput=${(e) => setF({ ...f, price: e.target.value })} required /></label>
      <label class="f full">${t("spendWhat")}<input class="in" id="sp-note" maxlength="60" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} required /></label>
      ${cat?.points_ratio && cents ? html`<p class="ok-msg full">${t("charityNote", { p: E.charityPoints(cents, S.family.cents_per_point, Number(cat.points_ratio)) })}</p>` : null}
      ${msg && html`<p class="err full">${msg}</p>`}
      <div class="full"><button class="btn" disabled=${busy}>${t("askSpend")}</button></div>
    </form></section>`;
}

function History({ v, canDeletePending, reload, limit = 25 }) {
  const [busy, run] = useBusy();
  const rows = [
    ...v.entries.map((x) => ({ k: "e" + x.id, at: x.created_at, date: x.date, em: x.emoji || "⭐", title: x.title, sub: x.note, amt: signed(x.points) || "0", n: x.points, status: x.status, auto: !!x.auto_key, del: canDeletePending && x.status === "pending" ? () => A.deleteEntry(x.id) : null })),
    ...v.money.map((x) => ({ k: "m" + x.id, at: x.created_at, date: x.date, em: x.cents > 0 ? "💶" : "🛍️", title: x.note, amt: (x.cents < 0 ? "−" : "+") + eur(Math.abs(x.cents)), n: x.cents, status: x.status, del: canDeletePending && x.status === "pending" ? () => A.deleteTx(x.id) : null })),
  ].sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, limit);
  return html`<section class="panel"><h2>${t("history")}</h2>
    <div class="list">${rows.length ? rows.map((r) => html`<div class="item" key=${r.k}><span class="em">${r.em}</span>
      <div class="main"><b>${r.title}</b><span>${fmtDay(r.date)} ${r.sub ? "· " + r.sub : ""} <${Tag} status=${r.status} auto=${r.auto} /></span></div>
      <span class="amt ${amtClass(r.n)}">${r.amt}</span>
      ${r.del ? html`<button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await r.del(); await reload(); })}>${t("remove")}</button>` : null}</div>`) : html`<div class="empty">${t("noHistory")}</div>`}</div></section>`;
}

function ChildHome({ S, reload }) {
  const child = S.children.find((c) => c.id === S.me.child_id);
  if (!child) return html`<div class="wrap"><div class="empty">${t("noFamily")}</div></div>`;
  const v = childView(S, child);
  return html`<div class="wrap">
    <header class="top"><${Mascot} /><h1>${t("hello", { name: child.name })}<small>${fmtDay(v.today, true)}</small></h1>
      <button class="linkbtn" onClick=${() => A.signOut()}>${t("signOut")}</button></header>
    <${SavingsHero} S=${S} child=${child} v=${v} />
    <${PrayerStrip} S=${S} child=${child} v=${v} reload=${reload} />
    <${ScreenCard} S=${S} child=${child} v=${v} reload=${reload} />
    <${WeeklyCards} child=${child} v=${v} reload=${reload} />
    <${ActivityTiles} S=${S} child=${child} v=${v} reload=${reload} />
    <${ProposeForm} S=${S} child=${child} v=${v} reload=${reload} />
    <${SpendForm} S=${S} child=${child} v=${v} reload=${reload} />
    <${History} v=${v} canDeletePending=${true} reload=${reload} />
  </div>`;
}

// =====================================================================
// Parent home
function ParentHome({ S, reload }) {
  const [childId, setChildId] = useState(S.children[0]?.id || null);
  const [tab, setTab] = useState("check");
  const child = S.children.find((c) => c.id === childId) || S.children[0];
  const pendingCount = S.entries.filter((x) => x.status === "pending").length + S.money.filter((x) => x.status === "pending").length
    + S.sessions.filter((s) => s.needs_review).length + S.paydays.filter((p) => p.status === "draft").length;
  const tabs = [["check", t("tabCheck"), pendingCount], ["money", t("tabMoney")], ["rules", t("tabRules")], ["screen", t("tabScreen")], ["family", t("tabFamily")], ...(S.isAdmin ? [["admin", t("tabAdmin")]] : [])];
  const v = child ? childView(S, child) : null;
  return html`<div class="wrap">
    <header class="top"><${Mascot} /><h1>${S.family.name}<small>${S.me.display_name}</small></h1>
      <button class="linkbtn" onClick=${() => A.signOut()}>${t("signOut")}</button></header>
    ${S.children.length > 1 ? html`<div class="seg" style="grid-template-columns:repeat(${S.children.length},1fr)">${S.children.map((c) => html`<button type="button" aria-pressed=${c.id === child.id} onClick=${() => setChildId(c.id)}>${c.name}</button>`)}</div>` : null}
    ${child ? html`<${SavingsHero} S=${S} child=${child} v=${v} />` : null}
    <nav class="tabs" role="tablist">${tabs.map(([k, label, n]) => html`<button role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${label}${n ? html`<span class="badge">${n}</span>` : null}</button>`)}</nav>
    ${!child && tab !== "family" && tab !== "admin" ? html`<div class="empty">Tambahkan anak dulu di tab Keluarga.</div>` : null}
    ${child && tab === "check" ? html`<${CheckTab} S=${S} child=${child} v=${v} reload=${reload} />` : null}
    ${child && tab === "money" ? html`<${MoneyTab} S=${S} child=${child} v=${v} reload=${reload} />` : null}
    ${child && tab === "rules" ? html`<${RulesTab} S=${S} child=${child} v=${v} reload=${reload} />` : null}
    ${child && tab === "screen" ? html`<${ScreenTab} S=${S} child=${child} v=${v} reload=${reload} />` : null}
    ${tab === "family" ? html`<${FamilyTab} S=${S} child=${child} reload=${reload} />` : null}
    ${tab === "admin" ? html`<${AdminTab} S=${S} reload=${reload} />` : null}
  </div>`;
}

function CheckTab({ S, child, v, reload }) {
  const [busy, run] = useBusy();
  const uid = S.uid;
  const pend = v.entries.filter((x) => x.status === "pending" && x.source === "child");
  const props = v.entries.filter((x) => x.status === "pending" && x.source === "proposal");
  const spends = v.money.filter((x) => x.status === "pending");
  const review = v.sessions.filter((s) => s.needs_review);
  const days = [...new Set(pend.map((x) => x.date))].sort().reverse();
  const [logOpen, setLogOpen] = useState(null);
  const approveDay = (d) => run(async () => { for (const x of pend.filter((y) => y.date === d)) await A.decideEntry(uid, x, true, {}, v.entries); await reload(); }, t("saved"));
  const nothing = !pend.length && !props.length && !spends.length && !review.length;
  return html`
    ${nothing ? html`<div class="empty">${t("nothingToCheck")}</div>` : null}
    ${days.map((d) => html`<section class="panel"><div class="panel-head"><h2>${fmtDay(d, true)}</h2>
      <button class="btn good sm" disabled=${busy} onClick=${() => approveDay(d)}>${t("approveAll")}</button></div>
      <div class="list">${pend.filter((x) => x.date === d).map((x) => html`<div class="item"><span class="em">${x.emoji}</span>
        <div class="main"><b>${x.title}${x.outcome_key ? " · " + ((v.acts.find((a) => a.id === x.activity_id)?.outcomes || []).find((o) => o.key === x.outcome_key)?.label || x.outcome_key) : ""}${x.qty ? " · " + x.qty : ""}</b><span>${x.note || ""}</span></div>
        <span class="amt ${amtClass(x.points)}">${signed(x.points) || "0"}</span>
        <button class="btn sm good" aria-label=${t("approve")} disabled=${busy} onClick=${() => run(async () => { await A.decideEntry(uid, x, true, {}, v.entries); await reload(); })}>✓</button>
        <button class="btn sm bad" aria-label=${t("reject")} disabled=${busy} onClick=${() => run(async () => { await A.decideEntry(uid, x, false); await reload(); })}>✕</button></div>`)}</div></section>`)}
    ${props.length ? html`<section class="panel"><h2>${t("proposal")}</h2>${props.map((x) => html`<${ProposalRow} key=${x.id} S=${S} x=${x} child=${child} v=${v} reload=${reload} />`)}</section>` : null}
    ${spends.length ? html`<section class="panel"><h2>${t("spendReq")}</h2><div class="list">${spends.map((x) => html`<div class="item"><span class="em">${S.categories.find((c) => c.id === x.category_id)?.emoji || "🛍️"}</span>
      <div class="main"><b>${x.note}</b><span>${S.categories.find((c) => c.id === x.category_id)?.name || ""} · ${fmtDay(x.date)} ${v.balance + x.cents < 0 ? html`<span class="tag no">saldo kurang</span>` : null}</span></div>
      <span class="amt neg">−${eur(-x.cents)}</span>
      <button class="btn sm good" disabled=${busy} onClick=${() => run(async () => { await A.decideTx(uid, x.id, true); await reload(); })}>✓</button>
      <button class="btn sm bad" disabled=${busy} onClick=${() => run(async () => { await A.decideTx(uid, x.id, false); await reload(); })}>✕</button></div>`)}</div></section>` : null}
    ${review.length ? html`<section class="panel"><h2>${t("sessionsReview")}</h2>${review.map((s) => html`<${SessionRow} key=${s.id} s=${s} v=${v} reload=${reload} />`)}</section>` : null}
    <section class="panel"><div class="panel-head"><h2>${t("logFor", { name: child.name })}</h2></div>
      <div class="tiles">${v.acts.filter((a) => a.active).map((a) => html`<button type="button" class="tile ${a.points < 0 ? "neg" : ""}" onClick=${() => setLogOpen(a)}><span class="em">${a.emoji}</span><span class="nm">${a.name}</span></button>`)}</div>
      ${logOpen && (logOpen.kind === "outcome" ? html`<${ParentOutcomeSheet} S=${S} act=${logOpen} child=${child} v=${v} onClose=${() => setLogOpen(null)} reload=${reload} />` : html`<${LogSheet} act=${logOpen} child=${child} v=${v} parentUid=${uid} onClose=${() => setLogOpen(null)} reload=${reload} />`)}
    </section>
    <${ParentHistory} S=${S} v=${v} reload=${reload} />`;
}

function ParentOutcomeSheet({ S, act, child, v, onClose, reload }) {
  const [pick, setPick] = useState(null);
  const [date, setDate] = useState(v.today);
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    for (const x of v.entries.filter((y) => y.activity_id === act.id && y.date === date && (y.status === "approved" || y.status === "pending") && !y.payday_id)) await A.setEntryStatus(S.uid, x.id, "waived");
    await A.parentLog(S.uid, child.id, act, { date, outcome_key: pick });
    onClose(); await reload();
  }, t("saved"));
  return html`<${Sheet} title=${act.name} onClose=${onClose}>
    <label class="f">${t("date")}<input class="in" id="po-date" type="date" max=${v.today} value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
    <div class="outcomes">${act.outcomes.map((o) => html`<button type="button" aria-pressed=${pick === o.key} onClick=${() => setPick(o.key)}><span>${o.label || o.key}</span><span class="amt ${amtClass(o.points)}">${signed(o.points) || "0"}</span></button>`)}</div>
    <p class="muted small">Catatan lain untuk slot ini (termasuk −1 otomatis) akan dibatalkan.</p>
    <div class="row"><button class="btn ghost grow" onClick=${onClose}>${t("cancel")}</button><button class="btn grow" disabled=${!pick || busy} onClick=${save}>${t("save")}</button></div>
  </${Sheet}>`;
}

function ProposalRow({ S, x, child, v, reload }) {
  const [pts, setPts] = useState(x.requested_points || x.points || 1);
  const [perm, setPerm] = useState(false);
  const [busy, run] = useBusy();
  const approve = () => run(async () => {
    let actId = null;
    if (perm) {
      const r = await A.saveActivity({ child_id: child.id, kind: "simple", name: x.title, emoji: x.emoji || "⭐", category_id: x.category_id, points: Number(pts), start_date: v.today, sort: 100 });
      actId = r?.[0]?.id || null;
    }
    await A.decideEntry(S.uid, x, true, { points: Number(pts), activity_id: actId });
    await reload();
  }, t("saved"));
  return html`<div class="rule"><div class="row"><span style="font-size:24px">${x.emoji || "💡"}</span><div class="grow"><b>${x.title}</b><div class="muted small">${fmtDay(x.date)} · minta ${x.requested_points} poin ${x.note ? "· " + x.note : ""}</div></div></div>
    <div class="row wrap-row"><label class="f" style="width:110px">${t("pointsGiven")}<input class="in" type="number" value=${pts} onInput=${(e) => setPts(e.target.value)} /></label>
      <label class="check grow"><input type="checkbox" checked=${perm} onChange=${(e) => setPerm(e.target.checked)} /> ${t("asPermanent")}</label>
      <button class="btn good sm" disabled=${busy} onClick=${approve}>${t("approve")}</button>
      <button class="btn bad sm" disabled=${busy} onClick=${() => run(async () => { await A.decideEntry(S.uid, x, false); await reload(); })}>${t("reject")}</button></div></div>`;
}

function ParentHistory({ S, v, reload }) {
  const [busy, run] = useBusy();
  const [days, setDays] = useState(7);
  const from = E.addDays(v.today, -days);
  const rows = v.entries.filter((x) => x.date >= from && x.status !== "pending").sort((a, b) => (a.date === b.date ? (b.created_at > a.created_at ? 1 : -1) : b.date > a.date ? 1 : -1));
  return html`<section class="panel"><div class="panel-head"><h2>Catatan ${days} hari terakhir</h2>
    <button class="btn ghost sm" onClick=${() => setDays(days === 7 ? 30 : 7)}>${days === 7 ? "30 hari" : "7 hari"}</button></div>
    <div class="list">${rows.length ? rows.map((x) => html`<div class="item"><span class="em">${x.emoji || "⭐"}</span>
      <div class="main"><b>${x.title}${x.outcome_key ? " · " + x.outcome_key : ""}${x.qty ? " · " + x.qty : ""}</b><span>${fmtDay(x.date)} <${Tag} status=${x.status} auto=${!!x.auto_key} /> ${x.payday_id ? html`<span class="tag info">dibayar</span>` : null}</span></div>
      <span class="amt ${amtClass(x.points)}">${signed(x.points) || "0"}</span>
      ${!x.payday_id && x.status === "approved" ? html`<button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.setEntryStatus(S.uid, x.id, x.auto_key ? "waived" : "rejected"); await reload(); })}>Batalkan</button>` : null}
      ${!x.payday_id && (x.status === "waived" || x.status === "rejected") ? html`<button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.setEntryStatus(S.uid, x.id, "approved"); await reload(); })}>Pulihkan</button>` : null}
    </div>`) : html`<div class="empty">${t("noHistory")}</div>`}</div></section>`;
}

function SessionRow({ s, v, reload }) {
  const toLocal = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [a, setA] = useState(toLocal(s.started_at));
  const [b, setB] = useState(s.ended_at ? toLocal(s.ended_at) : "");
  const [busy, run] = useBusy();
  const mins = s.ended_at ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 60000) : null;
  return html`<div class="rule"><div class="row"><b class="grow">${s.device_label || "Screentime"}</b><span class="muted small">${mins != null ? mins + " menit" : "berjalan"}</span>
    ${s.auto_stopped ? html`<span class="tag wait">berhenti otomatis</span>` : null}</div>
    <div class="form"><label class="f">Mulai<input class="in" type="datetime-local" value=${a} onInput=${(e) => setA(e.target.value)} /></label>
      <label class="f">Selesai<input class="in" type="datetime-local" value=${b} onInput=${(e) => setB(e.target.value)} /></label></div>
    <div class="row"><button class="btn sm" disabled=${busy} onClick=${() => run(async () => { await A.updateSession(s.id, { started_at: new Date(a).toISOString(), ended_at: b ? new Date(b).toISOString() : null, needs_review: false }); await reload(); }, t("saved"))}>${t("save")}</button>
      <button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.deleteSession(s.id); await reload(); })}>${t("remove")}</button></div></div>`;
}

function MoneyTab({ S, child, v, reload }) {
  const [busy, run] = useBusy();
  const fam = S.family;
  const myPaydays = S.paydays.filter((p) => p.child_id === child.id);
  const paidEnds = new Set(myPaydays.filter((p) => p.status === "paid").map((p) => p.period_end));
  const due = [];
  for (let i = Math.max(0, E.periodOf(child.start_date, { anchor: fam.period_anchor, periodDays: fam.period_days }).index); ; i++) {
    const end = E.addDays(fam.period_anchor, (i + 1) * fam.period_days - 1);
    if (end >= v.today) break;
    if (!paidEnds.has(end)) due.push(end);
  }
  const pay = (end) => run(async () => {
    await A.materializeAutos(S, child, v.today);
    await A.payChild(child.id, end); await reload();
  }, t("paid"));
  const preview = (end) => E.payable(v.entries, end, fam.cents_per_point, child.start_date);
  return html`
    <section class="panel"><h2>${t("paydayMode")}</h2>
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">${["auto", "approval", "manual"].map((m) => html`<button type="button" aria-pressed=${fam.payday_mode === m} onClick=${() => run(async () => { await A.updateFamily(fam.id, { payday_mode: m }); await reload(); })}>${t("mode_" + m)}</button>`)}</div>
      <p class="muted">${t("modeHelp_" + fam.payday_mode)}</p>
      ${due.map((end) => { const p = preview(end); const draft = myPaydays.find((d) => d.period_end === end && d.status === "draft");
        return html`<div class="week"><div class="row"><div class="grow"><b>${draft ? t("draft") + " · " : ""}Periode s.d. ${fmtDay(end, true)}</b><div class="muted small">${t("payPreview", { p: signed(p.points) || "0", amt: eur(p.cents) })} (sebelum −1 otomatis terakhir)</div></div>
          <button class="btn good" disabled=${busy} onClick=${() => pay(end)}>${t("payNow", { date: fmtDay(end) })}</button></div></div>`; })}
      <div class="week"><div class="row"><div class="grow"><b>Periode berjalan</b><div class="muted small">${fmtDay(v.period.start)} – ${fmtDay(v.period.end)} · ${t("payPreview", { p: signed(E.payable(v.entries, v.today, fam.cents_per_point, child.start_date).points) || "0", amt: eur(E.payable(v.entries, v.today, fam.cents_per_point, child.start_date).cents) })}</div></div>
        <button class="btn ghost sm" disabled=${busy} onClick=${() => pay(E.addDays(v.today, -1))}>Bayar sampai kemarin</button></div></div>
    </section>
    <${MoneyForm} S=${S} child=${child} v=${v} reload=${reload} />
    <section class="panel"><h2>${t("ledger")}</h2><div class="list">${v.money.filter((x) => x.status === "approved").slice(0, 60).map((x) => html`<div class="item">
      <span class="em">${S.categories.find((c) => c.id === x.category_id)?.emoji || (x.source === "payday" ? "💰" : "💶")}</span>
      <div class="main"><b>${x.note}</b><span>${fmtDay(x.date)} · ${S.categories.find((c) => c.id === x.category_id)?.name || x.source}</span></div>
      <span class="amt ${amtClass(x.cents)}">${x.cents < 0 ? "−" : "+"}${eur(Math.abs(x.cents))}</span></div>`)}</div></section>`;
}

function MoneyForm({ S, child, v, reload }) {
  const [dir, setDir] = useState("in");
  const cats = S.categories.filter((c) => c.kind === (dir === "in" ? "income" : "spend") && c.active);
  const [f, setF] = useState({ category_id: "", amount: "", note: "", date: v.today });
  const [busy, run] = useBusy();
  const submit = (e) => { e.preventDefault(); const c = parseEur(f.amount); if (!c || !f.note.trim()) return;
    run(async () => { await A.addMoney(S.uid, child.id, { category_id: f.category_id || cats[0]?.id, cents: dir === "in" ? c : -c, note: f.note.trim(), date: f.date }); setF({ ...f, amount: "", note: "" }); await reload(); }, t("saved")); };
  return html`<section class="panel"><h2>${dir === "in" ? t("moneyIn") : t("moneyOut")}</h2>
    <div class="seg"><button type="button" aria-pressed=${dir === "in"} onClick=${() => setDir("in")}>${t("moneyIn")}</button><button type="button" aria-pressed=${dir === "out"} onClick=${() => setDir("out")}>${t("moneyOut")}</button></div>
    <form class="form" onSubmit=${submit}>
      <label class="f">${t("category")}<select class="in" id="mf-cat" value=${f.category_id || cats[0]?.id} onChange=${(e) => setF({ ...f, category_id: e.target.value })}>${cats.map((c) => html`<option value=${c.id}>${c.emoji} ${c.name}</option>`)}</select></label>
      <label class="f">${t("amount")}<input class="in" id="mf-amt" inputmode="decimal" value=${f.amount} onInput=${(e) => setF({ ...f, amount: e.target.value })} required /></label>
      <label class="f">${t("date")}<input class="in" id="mf-date" type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /></label>
      <label class="f">Keterangan<input class="in" id="mf-note" maxlength="80" placeholder="contoh: hadiah ulang tahun dari Eyang" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} required /></label>
      <div class="full"><button class="btn" disabled=${busy}>${t("save")}</button></div></form></section>`;
}

// ---------- rules ----------
const blankAct = (kind, child, today) => ({ child_id: child.id, kind, name: "", emoji: "⭐", unit: null, points: 1, outcomes: kind === "outcome" ? [{ key: "ya", label: "Ya", points: 1 }, { key: "tidak", label: "Tidak", points: -1 }] : [], missed_key: null, daily_required: false, quota: kind === "weekly" ? 1 : null, penalty: kind === "weekly" ? -2 : null, bonus_per_unit: kind === "weekly" ? 2 : null, partial: false, start_date: today, active: true, sort: 50 });

function RulesTab({ S, child, v, reload }) {
  const [busy, run] = useBusy();
  const [tplName, setTplName] = useState("");
  const tpls = S.templates;
  const cats = S.categories.filter((c) => c.kind === "activity");
  const [adding, setAdding] = useState(null);
  return html`
    <section class="panel"><div class="panel-head"><h2>Nilai poin</h2></div>
      <div class="row wrap-row"><label class="f" style="width:160px">1 poin = (sen)<input class="in" id="cpp" type="number" min="1" value=${S.family.cents_per_point} onChange=${(e) => run(async () => { await A.updateFamily(S.family.id, { cents_per_point: Math.max(1, Number(e.target.value) || 10) }); await reload(); }, t("saved"))} /></label>
      <p class="muted grow">10 poin = ${eur(10 * S.family.cents_per_point)}</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Kegiatan ${child.name}</h2></div>
      ${v.acts.map((a) => html`<${ActivityEditor} key=${a.id + a.sort} S=${S} a=${a} cats=${cats} reload=${reload} />`)}
      ${adding ? html`<${ActivityEditor} S=${S} a=${adding} cats=${cats} reload=${async () => { setAdding(null); await reload(); }} onCancel=${() => setAdding(null)} />` : html`
      <div class="row wrap-row"><button class="btn sm" onClick=${() => setAdding(blankAct("simple", child, v.today))}>+ Kegiatan biasa</button>
        <button class="btn sm" onClick=${() => setAdding(blankAct("outcome", child, v.today))}>+ Pilihan hasil</button>
        <button class="btn sm" onClick=${() => setAdding(blankAct("weekly", child, v.today))}>+ Wajib mingguan</button></div>`}
    </section>
    <${CategoryEditor} S=${S} kind="activity" title="Kategori kegiatan" reload=${reload} />
    <section class="panel"><h2>Template</h2>
      <div class="row wrap-row"><input class="in grow" id="tpl-name" placeholder="Nama template" value=${tplName} onInput=${(e) => setTplName(e.target.value)} />
        <button class="btn sm" disabled=${busy || !tplName.trim()} onClick=${() => run(async () => { await A.saveTemplate(S.family.id, tplName.trim(), A.templateFrom(S, child)); setTplName(""); await reload(); }, t("saved"))}>Simpan aturan ${child.name} sebagai template</button></div>
      <div class="list">${tpls.map((tp) => html`<div class="item"><span class="em">📋</span><div class="main"><b>${tp.name}</b><span>${tp.is_public ? "umum" : "keluarga"} · ${(tp.data.activities || []).length} kegiatan</span></div>
        <button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.applyTemplate(S, child, tp, child.start_date > v.today ? child.start_date : v.today); await reload(); }, t("saved"))}>Tambahkan ke ${child.name}</button></div>`)}</div>
    </section>`;
}

function ActivityEditor({ S, a, cats, reload, onCancel }) {
  const [x, setX] = useState({ ...a, outcomes: [...(a.outcomes || [])] });
  const [busy, run] = useBusy();
  const set = (k, num) => (e) => setX({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : num ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value });
  const setO = (i, k) => (e) => { const o = x.outcomes.map((y, j) => (j === i ? { ...y, [k]: k === "points" ? Number(e.target.value) : e.target.value } : y)); setX({ ...x, outcomes: o }); };
  const save = () => run(async () => {
    const o = x.outcomes.map((y) => ({ ...y, key: y.key || (y.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
    await A.saveActivity({ ...x, outcomes: o, unit: x.unit || null }); await reload();
  }, t("saved"));
  const kindName = { simple: "Biasa", outcome: "Pilihan hasil", weekly: "Wajib mingguan" }[x.kind];
  return html`<div class="rule ${x.active ? "" : "off"}">
    <div class="row wrap-row"><input class="in" style="width:60px;text-align:center" aria-label="Ikon" value=${x.emoji || ""} onInput=${set("emoji")} />
      <input class="in grow" aria-label="Nama" placeholder="Nama kegiatan" value=${x.name} onInput=${set("name")} />
      <span class="tag info">${kindName}</span></div>
    <div class="form">
      <label class="f">Kategori<select class="in" value=${x.category_id || ""} onChange=${set("category_id")}><option value="">—</option>${cats.map((c) => html`<option value=${c.id}>${c.emoji} ${c.name}</option>`)}</select></label>
      <label class="f">Satuan (kosongkan jika tidak ada)<input class="in" value=${x.unit || ""} placeholder="halaman, ayat" onInput=${set("unit")} /></label>
      ${x.kind === "simple" ? html`<label class="f">Poin ${x.unit ? "per " + x.unit : ""}<input class="in" type="number" value=${x.points} onInput=${set("points", true)} /></label>` : null}
      ${x.kind === "weekly" ? html`
        <label class="f">Kuota per minggu<input class="in" type="number" min="1" value=${x.quota} onInput=${set("quota", true)} /></label>
        <label class="f">Penalti jika kurang<input class="in" type="number" value=${x.penalty} onInput=${set("penalty", true)} /></label>
        <label class="f">Bonus per ${x.unit || "unit"} di atas kuota<input class="in" type="number" value=${x.bonus_per_unit} onInput=${set("bonus_per_unit", true)} /></label>
        <label class="check">${html`<input type="checkbox" checked=${x.partial} onChange=${set("partial")} />`} Penalti sebagian</label>` : null}
      <label class="f">Urutan<input class="in" type="number" value=${x.sort} onInput=${set("sort", true)} /></label>
      <label class="f">Berlaku mulai<input class="in" type="date" value=${x.start_date} onInput=${set("start_date")} /></label>
    </div>
    ${x.kind === "outcome" ? html`<div class="list"><span class="muted small">Pilihan hasil dan poinnya</span>
      ${x.outcomes.map((o, i) => html`<div class="outcome-row"><input class="in" value=${o.label} placeholder="Label" onInput=${setO(i, "label")} /><input class="in" type="number" value=${o.points} onInput=${setO(i, "points")} />
        <button class="btn sm ghost" onClick=${() => setX({ ...x, outcomes: x.outcomes.filter((_, j) => j !== i) })}>${t("remove")}</button></div>`)}
      <button class="btn sm ghost" style="align-self:flex-start" onClick=${() => setX({ ...x, outcomes: [...x.outcomes, { key: "", label: "", points: 0 }] })}>+ Pilihan</button>
      <label class="check"><input type="checkbox" checked=${x.daily_required} onChange=${set("daily_required")} /> Wajib harian: kalau tidak dicatat, otomatis dihitung</label>
      ${x.daily_required ? html`<label class="f">Hasil jika tidak dicatat<select class="in" value=${x.missed_key || ""} onChange=${set("missed_key")}><option value="">—</option>${x.outcomes.map((o) => html`<option value=${o.key || (o.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}>${o.label}</option>`)}</select></label>` : null}
    </div>` : null}
    <div class="row wrap-row"><button class="btn sm" disabled=${busy || !x.name.trim()} onClick=${save}>${t("save")}</button>
      ${a.id ? html`<button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.saveActivity({ ...a, active: !a.active }); await reload(); })}>${a.active ? "Nonaktifkan" : "Aktifkan"}</button>` : null}
      ${onCancel ? html`<button class="btn sm ghost" onClick=${onCancel}>${t("cancel")}</button>` : null}</div>
  </div>`;
}

function CategoryEditor({ S, kind, title, reload }) {
  const [busy, run] = useBusy();
  const [n, setN] = useState({ emoji: "", name: "", ratio: "" });
  const list = S.categories.filter((c) => c.kind === kind);
  return html`<section class="panel"><h2>${title}</h2><div class="list">${list.map((c) => html`<div class="item ${c.active ? "" : "off"}"><span class="em">${c.emoji}</span>
    <div class="main"><b>${c.name}</b>${c.points_ratio ? html`<span>kembali ${Number(c.points_ratio) * 100}% sebagai poin</span>` : null}</div>
    <button class="btn sm ghost" disabled=${busy} onClick=${() => run(async () => { await A.saveCategory({ ...c, active: !c.active }); await reload(); })}>${c.active ? "Sembunyikan" : "Tampilkan"}</button></div>`)}</div>
    <div class="row wrap-row"><input class="in" style="width:60px" aria-label="Ikon" value=${n.emoji} onInput=${(e) => setN({ ...n, emoji: e.target.value })} />
      <input class="in grow" aria-label="Nama kategori" placeholder="Kategori baru" value=${n.name} onInput=${(e) => setN({ ...n, name: e.target.value })} />
      ${kind === "spend" ? html`<input class="in" style="width:110px" aria-label="Rasio poin" placeholder="rasio poin" value=${n.ratio} onInput=${(e) => setN({ ...n, ratio: e.target.value })} />` : null}
      <button class="btn sm" disabled=${busy || !n.name.trim()} onClick=${() => run(async () => { await A.saveCategory({ family_id: S.family.id, kind, name: n.name.trim(), emoji: n.emoji || "⭐", points_ratio: n.ratio ? Number(String(n.ratio).replace(",", ".")) : null, sort: list.length + 1 }); setN({ emoji: "", name: "", ratio: "" }); await reload(); })}>Tambah</button></div></section>`;
}

// ---------- screen settings ----------
function ScreenTab({ S, child, v, reload }) {
  const [c, setC] = useState({ ...child.screen });
  const [busy, run] = useBusy();
  const num = (k) => (e) => setC({ ...c, [k]: Number(e.target.value) });
  const mins = E.screenMinutesByDay(v.sessions, v.tz);
  const ws = E.weekStart(v.today);
  const byDevice = {};
  for (const s of v.sessions.filter((s) => E.localDate(s.started_at, v.tz) >= ws)) {
    const m = Math.round(((s.ended_at ? new Date(s.ended_at) : new Date()) - new Date(s.started_at)) / 60000);
    byDevice[s.device_label || "?"] = (byDevice[s.device_label || "?"] || 0) + m;
  }
  return html`
    <section class="panel"><h2>Minggu ini</h2>
      <div class="list">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = E.addDays(ws, i); if (d > v.today) return null; const used = mins[d] || 0; const lim = E.screenLimit(c, d);
        return html`<div class="item"><div class="main"><b>${fmtDay(d)}</b><div class="meter ${used <= lim ? "full" : ""}" style="margin-top:6px"><div style="width:${Math.min(100, (used / lim) * 100)}%"></div></div></div><span class="amt ${used > lim ? "neg" : "zero"}">${used}/${lim} mnt</span></div>`; })}</div>
      ${Object.keys(byDevice).length ? html`<p class="muted">${Object.entries(byDevice).map(([k, m]) => `${k}: ${m} mnt`).join(" · ")}</p>` : null}
    </section>
    <section class="panel"><h2>Aturan screentime</h2>
      <label class="check"><input type="checkbox" checked=${c.enabled !== false} onChange=${(e) => setC({ ...c, enabled: e.target.checked })} /> Screentime aktif</label>
      <div class="form">
        <label class="f">Jatah hari sekolah (menit)<input class="in" type="number" value=${c.weekdayLimitMin} onInput=${num("weekdayLimitMin")} /></label>
        <label class="f">Jatah akhir pekan (menit)<input class="in" type="number" value=${c.weekendLimitMin} onInput=${num("weekendLimitMin")} /></label>
        <label class="f">Penalti tiap kelebihan (menit)<input class="in" type="number" value=${c.overBlockMin} onInput=${num("overBlockMin")} /></label>
        <label class="f">Poin penalti per blok<input class="in" type="number" value=${c.overPenalty} onInput=${num("overPenalty")} /></label>
        <label class="f">Hadiah tiap sisa (menit)<input class="in" type="number" value=${c.leftoverBlockMin} onInput=${num("leftoverBlockMin")} /></label>
        <label class="f">Poin hadiah per blok<input class="in" type="number" value=${c.leftoverPointsPerBlock} onInput=${num("leftoverPointsPerBlock")} /></label>
        <label class="f">Peringatan saat sisa (menit)<input class="in" type="number" value=${c.warnMin} onInput=${num("warnMin")} /></label>
      </div>
      <button class="btn" disabled=${busy} onClick=${() => run(async () => { await A.updateChild(child.id, { screen: c }); await reload(); }, t("saved"))}>${t("save")}</button></section>
    <${CategoryEditor} S=${S} kind="screen" title="Pilihan perangkat / kegiatan layar" reload=${reload} />
    <section class="panel"><h2>Sesi terakhir</h2>${v.sessions.slice(0, 10).map((s) => html`<${SessionRow} key=${s.id + (s.ended_at || "")} s=${s} v=${v} reload=${reload} />`)}</section>`;
}

// ---------- family ----------
function FamilyTab({ S, child, reload }) {
  const [busy, run] = useBusy();
  const firstDay = (() => { const td = E.localDate(new Date(), S.family.timezone); return S.family.period_anchor > td ? S.family.period_anchor : td; })();
  const [nc, setNc] = useState({ name: "", username: "", pin: "", start_date: firstDay });
  const [np, setNp] = useState({ name: "", email: "", password: "" });
  const [pin, setPin] = useState("");
  const [al, setAl] = useState(child ? { ...child.allowance, amount: child.allowance?.cents ? String(child.allowance.cents / 100).replace(".", ",") : "" } : {});
  const [exDay, setExDay] = useState("");
  const myExcused = child ? S.excused.filter((x) => x.child_id === child.id).map((x) => x.date).sort().reverse() : [];
  return html`
    ${child ? html`<section class="panel"><h2>${child.name}</h2>
      <p class="muted">Masuk anak: kode keluarga <b>${S.family.code}</b>, nama pengguna <b>${child.username}</b>.</p>
      <div class="row wrap-row"><input class="in" style="width:160px" inputmode="numeric" maxlength="6" placeholder="PIN baru (6 angka)" value=${pin} onInput=${(e) => setPin(e.target.value)} />
        <button class="btn sm" disabled=${busy || !/^\d{6}$/.test(pin)} onClick=${() => run(async () => { await A.accounts({ action: "set_pin", child_id: child.id, pin }); setPin(""); }, t("saved"))}>Ganti PIN</button></div>
      <h3>Uang saku</h3>
      <label class="check"><input type="checkbox" checked=${!!al.enabled} onChange=${(e) => setAl({ ...al, enabled: e.target.checked })} /> Uang saku otomatis</label>
      <div class="form"><label class="f">Nominal (€)<input class="in" inputmode="decimal" value=${al.amount} onInput=${(e) => setAl({ ...al, amount: e.target.value })} /></label>
        <label class="f">Setiap<select class="in" value=${al.freq} onChange=${(e) => setAl({ ...al, freq: e.target.value })}><option value="weekly">minggu</option><option value="monthly">bulan</option></select></label>
        ${al.freq === "monthly" ? html`<label class="f">Tanggal<input class="in" type="number" min="1" max="28" value=${al.monthday || 1} onInput=${(e) => setAl({ ...al, monthday: Number(e.target.value) })} /></label>`
          : html`<label class="f">Hari<select class="in" value=${al.weekday || 1} onChange=${(e) => setAl({ ...al, weekday: Number(e.target.value) })}>${["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"].map((d, i) => html`<option value=${i + 1}>${d}</option>`)}</select></label>`}</div>
      <button class="btn sm" style="align-self:flex-start" disabled=${busy} onClick=${() => run(async () => { const a = { enabled: !!al.enabled, cents: parseEur(al.amount) || 0, freq: al.freq || "weekly", weekday: al.weekday || 1, monthday: al.monthday || 1, start_date: al.start_date || E.localDate(new Date(), S.family.timezone) }; await A.updateChild(child.id, { allowance: a }); await reload(); }, t("saved"))}>${t("save")}</button>
      <h3>Hari libur sholat</h3>
      <label class="check"><input type="checkbox" checked=${child.excused_enabled} onChange=${(e) => run(async () => { await A.updateChild(child.id, { excused_enabled: e.target.checked }); await reload(); })} /> Aktifkan fitur libur (tidak ada −1 otomatis pada hari libur)</label>
      ${child.excused_enabled ? html`<div class="row wrap-row"><input class="in" type="date" style="width:180px" value=${exDay} onInput=${(e) => setExDay(e.target.value)} />
        <button class="btn sm" disabled=${busy || !exDay} onClick=${() => run(async () => { await A.addExcused(child.id, exDay); setExDay(""); await reload(); })}>Tandai libur</button></div>
        <div class="chips">${myExcused.map((d) => html`<button class="chip-btn" onClick=${() => run(async () => { await A.removeExcused(child.id, d); await reload(); })}>${fmtDay(d)} ✕</button>`)}</div>` : null}
    </section>` : null}
    <section class="panel"><h2>Tambah anak</h2>
      <div class="form"><label class="f">Nama<input class="in" value=${nc.name} onInput=${(e) => setNc({ ...nc, name: e.target.value })} /></label>
        <label class="f">Nama pengguna (huruf kecil)<input class="in" autocapitalize="none" value=${nc.username} onInput=${(e) => setNc({ ...nc, username: e.target.value.toLowerCase() })} /></label>
        <label class="f">PIN (6 angka)<input class="in" inputmode="numeric" maxlength="6" value=${nc.pin} onInput=${(e) => setNc({ ...nc, pin: e.target.value })} /></label>
        <label class="f">Mulai dihitung<input class="in" type="date" value=${nc.start_date} onInput=${(e) => setNc({ ...nc, start_date: e.target.value })} /></label></div>
      <p class="muted small">Catatan sebelum tanggal mulai dianggap latihan dan tidak ikut gajian.</p>
      <button class="btn sm" style="align-self:flex-start" disabled=${busy} onClick=${() => run(async () => { await A.accounts({ action: "create_child", ...nc }); setNc({ name: "", username: "", pin: "", start_date: firstDay }); await reload(); }, t("saved"))}>Buat akun anak</button></section>
    <section class="panel"><h2>Orang tua</h2>
      <div class="list">${S.members.filter((m) => m.role === "parent").map((m) => html`<div class="item"><span class="em">👤</span><div class="main"><b>${m.display_name}</b></div></div>`)}</div>
      <div class="form"><label class="f">Nama<input class="in" value=${np.name} onInput=${(e) => setNp({ ...np, name: e.target.value })} /></label>
        <label class="f">Email<input class="in" type="email" value=${np.email} onInput=${(e) => setNp({ ...np, email: e.target.value })} /></label>
        <label class="f">Kata sandi awal (min. 8)<input class="in" type="password" value=${np.password} onInput=${(e) => setNp({ ...np, password: e.target.value })} /></label></div>
      <button class="btn sm" style="align-self:flex-start" disabled=${busy} onClick=${() => run(async () => { await A.accounts({ action: "add_parent", ...np }); setNp({ name: "", email: "", password: "" }); await reload(); }, t("saved"))}>Tambah orang tua</button></section>
    <${CategoryEditor} S=${S} kind="spend" title="Kategori uang keluar" reload=${reload} />
    <${CategoryEditor} S=${S} kind="income" title="Kategori uang masuk" reload=${reload} />
    <${ChangePassword} />`;
}

function ChangePassword() {
  const [p, setP] = useState("");
  const [busy, run] = useBusy();
  return html`<section class="panel"><h2>Kata sandi saya</h2><div class="row wrap-row"><input class="in grow" type="password" autocomplete="new-password" placeholder="Kata sandi baru (min. 8)" value=${p} onInput=${(e) => setP(e.target.value)} />
    <button class="btn sm" disabled=${busy || p.length < 8} onClick=${() => run(async () => { const r = await A.sb.auth.updateUser({ password: p }); if (r.error) throw r.error; setP(""); }, t("saved"))}>Ganti</button></div></section>`;
}

function AdminTab({ S, reload }) {
  const [f, setF] = useState({ name: "", code: "", pname: "", email: "", password: "" });
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<section class="panel"><h2>Buat keluarga baru</h2>
    <div class="form"><label class="f">Nama keluarga<input class="in" value=${f.name} onInput=${set("name")} /></label>
      <label class="f">Kode (huruf kecil/angka)<input class="in" autocapitalize="none" value=${f.code} onInput=${set("code")} /></label>
      <label class="f">Nama orang tua<input class="in" value=${f.pname} onInput=${set("pname")} /></label>
      <label class="f">Email orang tua<input class="in" type="email" value=${f.email} onInput=${set("email")} /></label>
      <label class="f">Kata sandi awal (min. 8)<input class="in" type="password" value=${f.password} onInput=${set("password")} /></label></div>
    <button class="btn" disabled=${busy} onClick=${() => run(async () => { await A.accounts({ action: "create_family", name: f.name, code: f.code, parent: { name: f.pname, email: f.email, password: f.password } }); setF({ name: "", code: "", pname: "", email: "", password: "" }); }, t("saved"))}>Buat keluarga</button></section>`;
}

// =====================================================================
function App() {
  const [session, setSession] = useState(undefined);
  const [S, setS] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    A.sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = A.sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const reload = useCallback(async () => {
    try { setS(await A.loadAll()); setErr(null); } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { if (session) reload(); else setS(null); }, [session?.user?.id]);
  useEffect(() => {
    if (!session) return;
    const i = setInterval(reload, 60000);
    const vis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, [session?.user?.id]);

  let body;
  if (session === undefined) body = html`<div class="wrap"><p class="muted">${t("loading")}</p></div>`;
  else if (!session) body = html`<${Login} />`;
  else if (err && !S) body = html`<div class="wrap"><div class="banner bad">${t("loadFail")}</div><button class="btn" onClick=${reload}>${t("retry")}</button></div>`;
  else if (!S) body = html`<div class="wrap"><p class="muted">${t("loading")}</p></div>`;
  else if (!S.me) body = S.isAdmin ? html`<div class="wrap"><${AdminTab} S=${S} reload=${reload} /><button class="linkbtn" onClick=${() => A.signOut()}>${t("signOut")}</button></div>`
    : html`<div class="wrap"><div class="banner warn">${t("noFamily")}</div><button class="btn" onClick=${() => A.signOut()}>${t("signOut")}</button></div>`;
  else if (S.me.role === "child") body = html`<${ChildHome} S=${S} reload=${reload} />`;
  else body = html`<${ParentHome} S=${S} reload=${reload} />`;
  return html`${body}<${Toast} />`;
}

const root = document.getElementById("app");
root.textContent = ""; // remove the static loading text before Preact takes over
render(html`<${App} />`, root);
