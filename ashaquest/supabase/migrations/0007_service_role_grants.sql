-- The project was created with "automatically expose new tables" off, so the service role
-- (used by the Edge Functions) needs explicit grants. RLS does not apply to it.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.pay_child(uuid, date), public.tick_secret_ok(text) to service_role;
grant usage on schema kq to service_role;
grant execute on all functions in schema kq to service_role;
