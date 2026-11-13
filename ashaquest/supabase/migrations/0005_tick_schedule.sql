-- Hourly scheduled job that calls the tick Edge Function.
-- The shared secret lives in Supabase Vault; the function checks it through tick_secret_ok (service role only).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'kq_tick_secret', 'Kids Quest tick shared secret')
where not exists (select 1 from vault.secrets where name = 'kq_tick_secret');

create or replace function public.tick_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'kq_tick_secret' and decrypted_secret = p_secret)
$$;
revoke execute on function public.tick_secret_ok(text) from public, anon, authenticated;
grant execute on function public.tick_secret_ok(text) to service_role;

select cron.schedule('kq-tick', '7 * * * *', $$
  select net.http_post(
    url := 'https://giedyhskakaarfxylrsy.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kq_tick_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
