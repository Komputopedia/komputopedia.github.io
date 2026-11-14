// Kids Quest account management. Needs the caller's JWT.
// Actions: create_family (platform admin); add_parent, rename_parent, reset_parent_password, remove_parent,
// create_child, set_pin (parents of the family).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
class Fail extends Error { constructor(public code: string, public status = 400) { super(code); } }

export const childEmail = (code: string, username: string) => `${username}.${code}@kids.kidsquest.app`;

const DEFAULT_CATEGORIES = [
  ["activity", "Ibadah", "🕌", null], ["activity", "Rumah", "🏠", null], ["activity", "Akademis", "🎓", null], ["activity", "Lainnya", "⭐", null],
  ["spend", "Jajan", "🍬", null], ["spend", "Mainan", "🧸", null], ["spend", "Buku & alat tulis", "📚", null],
  ["spend", "Hadiah untuk orang lain", "🎁", null], ["spend", "Sedekah", "🤲", 0.5], ["spend", "Lainnya", "🛍️", null],
  ["income", "Uang saku", "💶", null], ["income", "Hadiah", "🎉", null], ["income", "Honor video AO Family", "🎬", null],
  ["income", "Koreksi", "✏️", null], ["income", "Lainnya", "💰", null],
  ["screen", "iPad", "📱", null], ["screen", "YouTube", "▶️", null], ["screen", "Switch", "🎮", null], ["screen", "Laptop", "💻", null], ["screen", "HP", "📞", null],
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) throw new Fail("not_signed_in", 401);
    const admin = createClient(URL_, SERVICE);
    const body = await req.json();
    const me = (await admin.from("members").select("*").eq("user_id", u.user.id).maybeSingle()).data;
    const isAdmin = !!(await admin.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle()).data;

    const familyFor = async (fid?: string) => {
      const id = fid && isAdmin ? fid : me?.family_id;
      if (!id) throw new Fail("no_family", 403);
      if (!isAdmin && me?.role !== "parent") throw new Fail("parents_only", 403);
      const f = (await admin.from("families").select("*").eq("id", id).single()).data;
      if (!f) throw new Fail("no_family", 404);
      return f;
    };
    const newUser = async (email: string, password: string, name: string) => {
      const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (r.error) throw new Fail(r.error.message.includes("already") ? "email_taken" : "auth_" + r.error.message);
      return r.data.user!;
    };
    const pinOk = (p: string) => /^\d{6}$/.test(String(p || ""));

    switch (body.action) {
      case "create_family": {
        if (!isAdmin) throw new Fail("admins_only", 403);
        const { name, code, timezone, parent } = body;
        if (!/^[a-z0-9]{3,24}$/.test(code || "")) throw new Fail("bad_code");
        const f = await admin.from("families").insert({ name, code, timezone: timezone || "Europe/Amsterdam" }).select().single();
        if (f.error) throw new Fail(f.error.code === "23505" ? "code_taken" : f.error.message);
        await admin.from("categories").insert(DEFAULT_CATEGORIES.map(([kind, n, emoji, ratio], i) => ({ family_id: f.data.id, kind, name: n, emoji, points_ratio: ratio, sort: i })));
        if (parent?.email) {
          const pu = await newUser(parent.email, parent.password, parent.name);
          await admin.from("members").insert({ user_id: pu.id, family_id: f.data.id, role: "parent", display_name: parent.name || parent.email });
        }
        return json({ family: f.data });
      }
      case "add_parent": {
        const f = await familyFor(body.family_id);
        if (!body.email || String(body.password || "").length < 8) throw new Fail("bad_input");
        const pu = await newUser(body.email, body.password, body.name);
        await admin.from("members").insert({ user_id: pu.id, family_id: f.id, role: "parent", display_name: body.name || body.email });
        return json({ ok: true });
      }
      case "create_child": {
        const f = await familyFor(body.family_id);
        const username = String(body.username || "").toLowerCase();
        if (!/^[a-z0-9]{2,20}$/.test(username) || !pinOk(body.pin) || !body.name) throw new Fail("bad_input");
        const c = await admin.from("children").insert({ family_id: f.id, name: body.name, username, start_date: body.start_date || undefined }).select().single();
        if (c.error) throw new Fail(c.error.code === "23505" ? "username_taken" : c.error.message);
        try {
          const cu = await newUser(childEmail(f.code, username), body.pin, body.name);
          await admin.from("members").insert({ user_id: cu.id, family_id: f.id, role: "child", child_id: c.data.id, display_name: body.name });
        } catch (e) { await admin.from("children").delete().eq("id", c.data.id); throw e; }
        return json({ child: c.data });
      }
      case "set_pin": {
        const f = await familyFor(body.family_id);
        if (!pinOk(body.pin)) throw new Fail("bad_pin");
        const m = (await admin.from("members").select("user_id").eq("child_id", body.child_id).eq("family_id", f.id).single()).data;
        if (!m) throw new Fail("no_child", 404);
        const r = await admin.auth.admin.updateUserById(m.user_id, { password: body.pin });
        if (r.error) throw new Fail(r.error.message);
        return json({ ok: true });
      }
      case "rename_parent": case "reset_parent_password": case "remove_parent": {
        const f = await familyFor(body.family_id);
        const target = (await admin.from("members").select("*").eq("user_id", body.user_id).eq("family_id", f.id).eq("role", "parent").maybeSingle()).data;
        if (!target) throw new Fail("no_parent", 404);
        if (body.action === "rename_parent") {
          const name = String(body.name || "").trim();
          if (!name) throw new Fail("bad_input");
          await admin.from("members").update({ display_name: name }).eq("user_id", target.user_id);
          return json({ ok: true });
        }
        if (body.action === "reset_parent_password") {
          if (String(body.password || "").length < 8) throw new Fail("bad_password");
          const r = await admin.auth.admin.updateUserById(target.user_id, { password: body.password });
          if (r.error) throw new Fail(r.error.message);
          return json({ ok: true });
        }
        // remove_parent: never yourself, never the last parent, never a platform admin
        if (target.user_id === u.user.id) throw new Fail("cannot_remove_self");
        const parents = (await admin.from("members").select("user_id").eq("family_id", f.id).eq("role", "parent")).data || [];
        if (parents.length <= 1) throw new Fail("last_parent");
        const adm = (await admin.from("platform_admins").select("user_id").eq("user_id", target.user_id).maybeSingle()).data;
        if (adm) throw new Fail("is_admin");
        const r = await admin.auth.admin.deleteUser(target.user_id); // members row goes with it (on delete cascade)
        if (r.error) throw new Fail(r.error.message);
        return json({ ok: true });
      }
      default: throw new Fail("unknown_action");
    }
  } catch (e) {
    const f = e instanceof Fail ? e : new Fail(String((e as Error)?.message || e), 500);
    return json({ error: f.code }, f.status);
  }
});
