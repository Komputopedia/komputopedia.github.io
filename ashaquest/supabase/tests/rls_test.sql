-- Security behaviour tests. Creates two throwaway families, acts as each role, then rolls everything back.
create temp table t_res (n serial, name text, ok boolean, info text);
grant all on t_res to authenticated;
grant usage, select on sequence t_res_n_seq to authenticated;

do $$
declare
  uPA uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uPB uuid := gen_random_uuid();
  fA uuid; fB uuid; cA uuid; cB uuid; act uuid; spend uuid; dev uuid; e1 uuid; eB uuid; tx1 uuid; n int; v int; s record;
  procedure_dummy int;
begin
  insert into auth.users (id, aud, role, email) values
    (uPA, 'authenticated', 'authenticated', 'pa-' || uPA || '@test.invalid'),
    (uC,  'authenticated', 'authenticated', 'c-'  || uC  || '@test.invalid'),
    (uPB, 'authenticated', 'authenticated', 'pb-' || uPB || '@test.invalid');
  insert into public.families (name, code) values ('Test A', 'ztesta') returning id into fA;
  insert into public.families (name, code) values ('Test B', 'ztestb') returning id into fB;
  insert into public.children (family_id, name, username, start_date) values (fA, 'Kid A', 'kida', current_date - 30) returning id into cA;
  insert into public.children (family_id, name, username, start_date) values (fB, 'Kid B', 'kidb', current_date - 30) returning id into cB;
  insert into public.members values (uPA, fA, 'parent', null, 'Parent A'), (uC, fA, 'child', cA, 'Kid A'), (uPB, fB, 'parent', null, 'Parent B');
  insert into public.activities (child_id, kind, name, outcomes, missed_key, daily_required, start_date)
    values (cA, 'outcome', 'Subuh', '[{"key":"sendiri","points":0},{"key":"jamaah","points":1},{"key":"tidak","points":-1}]', 'tidak', true, current_date - 30) returning id into act;
  insert into public.categories (family_id, kind, name, points_ratio) values (fA, 'spend', 'Sedekah', 0.5) returning id into spend;
  insert into public.categories (family_id, kind, name) values (fA, 'screen', 'iPad') returning id into dev;
  insert into public.entries (child_id, title, date, points, status, source) values (cB, 'B thing', current_date, 5, 'approved', 'parent') returning id into eB;

  -- ===== as child A =====
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uC, 'role', 'authenticated')::text, true);

  insert into public.entries (child_id, activity_id, title, date, outcome_key, points, status, source)
    values (cA, act, 'x', current_date - 20, 'jamaah', 999, 'pending', 'child') returning id, points into e1, v;
  insert into t_res (name, ok, info) values ('child entry points come from the rules', v = 1, v::text);

  begin
    insert into public.entries (child_id, activity_id, title, date, outcome_key, status, source) values (cA, act, 'x', current_date, 'jamaah', 'approved', 'child');
    insert into t_res (name, ok) values ('child cannot insert approved entry', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot insert approved entry', true, sqlerrm); end;

  update public.entries set status = 'approved' where id = e1; get diagnostics n = row_count;
  insert into t_res (name, ok, info) values ('child cannot approve own entry', n = 0, n::text);

  begin
    insert into public.entries (child_id, activity_id, title, date, outcome_key, status, source) values (cA, act, 'x', current_date + 2, 'jamaah', 'pending', 'child');
    insert into t_res (name, ok) values ('child cannot log a future date', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot log a future date', true, sqlerrm); end;

  begin
    insert into public.entries (child_id, title, date, status, source) values (cB, 'spoof', current_date, 'pending', 'child');
    insert into t_res (name, ok) values ('child cannot write for another family''s child', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot write for another family''s child', true, sqlerrm); end;

  select count(*) into n from public.entries where family_id = fB;
  insert into t_res (name, ok, info) values ('child cannot read another family', n = 0, n::text);

  begin
    insert into public.money_tx (child_id, cents, note, date, status, source) values (cA, 500, 'free money', current_date, 'pending', 'child');
    insert into t_res (name, ok) values ('child cannot add money in', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot add money in', true, sqlerrm); end;

  insert into public.money_tx (child_id, category_id, cents, note, date, status, source) values (cA, spend, -100, 'masjid', current_date, 'pending', 'child') returning id into tx1;
  insert into t_res (name, ok) values ('child can ask to spend', tx1 is not null);

  begin
    perform public.pay_child(cA, current_date);
    insert into t_res (name, ok) values ('child cannot run payday', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot run payday', true, sqlerrm); end;

  begin
    insert into public.screen_sessions (child_id, started_at, ended_at) values (cA, now() - interval '1 hour', now());
    insert into t_res (name, ok) values ('child cannot write screen sessions directly', false);
  exception when others then insert into t_res (name, ok, info) values ('child cannot write screen sessions directly', true, sqlerrm); end;

  select * into s from public.screen_start(dev);
  insert into t_res (name, ok, info) values ('child can start the timer', s.id is not null and s.ended_at is null, s.device_label);
  update public.screen_sessions set started_at = now() where id = s.id; get diagnostics n = row_count;
  insert into t_res (name, ok, info) values ('child cannot edit a session', n = 0, n::text);
  select * into s from public.screen_stop();
  insert into t_res (name, ok) values ('child can stop the timer', s.ended_at is not null);

  -- ===== as parent B =====
  perform set_config('request.jwt.claims', json_build_object('sub', uPB, 'role', 'authenticated')::text, true);
  select count(*) into n from public.entries where family_id = fA;
  insert into t_res (name, ok, info) values ('other family parent cannot read', n = 0, n::text);
  update public.entries set status = 'approved' where id = e1; get diagnostics n = row_count;
  insert into t_res (name, ok, info) values ('other family parent cannot approve', n = 0, n::text);
  begin
    perform public.pay_child(cA, current_date);
    insert into t_res (name, ok) values ('other family parent cannot pay', false);
  exception when others then insert into t_res (name, ok, info) values ('other family parent cannot pay', true, sqlerrm); end;

  -- ===== as parent A =====
  perform set_config('request.jwt.claims', json_build_object('sub', uPA, 'role', 'authenticated')::text, true);
  update public.entries set status = 'approved' where id = e1; get diagnostics n = row_count;
  insert into t_res (name, ok, info) values ('parent can approve', n = 1, n::text);
  update public.money_tx set status = 'approved' where id = tx1;
  select points into v from public.entries where auto_key = 'sedekah:' || tx1;
  insert into t_res (name, ok, info) values ('approved charity gives points back', v = 5, coalesce(v::text, 'none'));
  perform public.pay_child(cA, current_date - 1);
  select cents into v from public.money_tx where child_id = cA and source = 'payday';
  insert into t_res (name, ok, info) values ('payday pays approved points', v = 10, coalesce(v::text, 'none'));
  begin
    insert into public.entries (child_id, title, date, points, status, source) values (cA, 'late', current_date - 5, 1, 'approved', 'parent');
    insert into t_res (name, ok) values ('no new entries in a paid period', false);
  exception when others then insert into t_res (name, ok, info) values ('no new entries in a paid period', true, sqlerrm); end;
  begin
    perform public.pay_child(cA, current_date - 1);
    insert into t_res (name, ok) values ('a period cannot be paid twice', false);
  exception when others then insert into t_res (name, ok, info) values ('a period cannot be paid twice', true, sqlerrm); end;

  -- Abort so nothing persists; the results travel in the error message.
  raise exception 'RESULTS%', (select string_agg(E'\n' || case when ok then 'PASS ' else 'FAIL ' end || name || coalesce(' [' || left(info, 60) || ']', ''), '' order by t_res.n) from t_res);
end $$;
