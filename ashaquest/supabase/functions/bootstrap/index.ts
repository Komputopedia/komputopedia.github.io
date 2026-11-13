// One-shot: creates the first platform admin as a parent of an existing family.
// Works only while no platform admin exists, and only with the tick secret (called from SQL via pg_net).
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const ok = await db.rpc("tick_secret_ok", { p_secret: req.headers.get("x-tick-secret") || "" });
  if (ok.error || ok.data !== true) return new Response("forbidden", { status: 403 });
  const admins = (await db.from("platform_admins").select("user_id").limit(1)).data || [];
  if (admins.length) return new Response(JSON.stringify({ error: "already_bootstrapped" }), { status: 409 });
  const { email, name, family_code } = await req.json();
  const fam = (await db.from("families").select("id").eq("code", family_code).single()).data;
  if (!fam) return new Response(JSON.stringify({ error: "no_family" }), { status: 404 });
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const password = "kq-" + Array.from(bytes, (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const r = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (r.error) return new Response(JSON.stringify({ error: r.error.message }), { status: 400 });
  const uid = r.data.user!.id;
  await db.from("members").insert({ user_id: uid, family_id: fam.id, role: "parent", display_name: name });
  await db.from("platform_admins").insert({ user_id: uid });
  return new Response(JSON.stringify({ ok: true, email, temporary_password: password }), { headers: { "Content-Type": "application/json" } });
});
