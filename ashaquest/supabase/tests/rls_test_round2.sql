-- Round 2 security behaviour tests. Rolls back; results arrive as PASS/FAIL lines in the error message.
create temp table t_res (n serial, name text, ok boolean, info text);
grant all on t_res to authenticated;
grant usage, select on sequence t_res_n_seq to authenticated;
do $$
declare uPA uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uPB uuid := gen_random_uuid();
  fA uuid; fB uuid; cA uuid; act uuid; n int; v int; pd record;
begin
  insert into auth.users (id, aud, role, email) values (uPA,'authenticated','authenticated','pa-'||uPA||'@test.invalid'),(uC,'authenticated','authenticated','c-'||uC||'@test.invalid'),(uPB,'authenticated','authenticated','pb-'||uPB||'@test.invalid');
  insert into public.families (name, code) values ('Test A','ztesta') returning id into fA;
  insert into public.families (name, code) values ('Test B','ztestb') returning id into fB;
  insert into public.children (family_id, name, username, start_date, period_anchor, period_days, allowance, proposals)
    values (fA,'Kid','kida', current_date - 10, current_date - 10, 7, '{"enabled":true,"mode":"payday","cents":200}', '{"enabled":true,"perWeek":1}') returning id into cA;
  insert into public.categories (family_id, kind, name) values (fA, 'income', 'Uang saku');
  insert into public.members values (uPA,fA,'parent',null,'P'),(uC,fA,'child',cA,'K'),(uPB,fB,'parent',null,'PB');
  insert into public.activities (child_id, kind, name, points, max_per_day, start_date) values (cA,'simple','Kamar',2,1,current_date-10) returning id into act;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',uC,'role','authenticated')::text, true);
  insert into public.entries (child_id, activity_id, title, date, status, source) values (cA, act, 'x', current_date, 'pending', 'child');
  begin insert into public.entries (child_id, activity_id, title, date, status, source) values (cA, act, 'x', current_date, 'pending', 'child');
    insert into t_res(name,ok) values ('daily limit blocks a second log', false);
  exception when others then insert into t_res(name,ok,info) values ('daily limit blocks a second log', sqlerrm like '%limit_day%', sqlerrm); end;
  insert into public.entries (child_id, title, date, requested_points, status, source) values (cA, 'idea', current_date, 3, 'pending', 'proposal');
  begin insert into public.entries (child_id, title, date, requested_points, status, source) values (cA, 'idea2', current_date, 3, 'pending', 'proposal');
    insert into t_res(name,ok) values ('weekly proposal limit', false);
  exception when others then insert into t_res(name,ok,info) values ('weekly proposal limit', sqlerrm like '%limit_week%', sqlerrm); end;
  begin insert into public.stars (child_id, date, note) values (cA, current_date, 'self star');
    insert into t_res(name,ok) values ('child cannot give herself a star', false);
  exception when others then insert into t_res(name,ok,info) values ('child cannot give herself a star', true, sqlerrm); end;
  begin insert into public.screen_adjust (child_id, date, minutes) values (cA, current_date, 120);
    insert into t_res(name,ok) values ('child cannot raise her screen limit', false);
  exception when others then insert into t_res(name,ok,info) values ('child cannot raise her screen limit', true, sqlerrm); end;
  insert into public.media (family_id, child_id, kind, path) values (fA, cA, 'gallery', fA || '/gallery/a.jpg');
  insert into t_res(name,ok) values ('child can add a gallery photo', true);
  begin insert into public.media (family_id, child_id, kind, path) values (fA, cA, 'background', fA || '/background/a.jpg');
    insert into t_res(name,ok) values ('child cannot set a background', false);
  exception when others then insert into t_res(name,ok,info) values ('child cannot set a background', true, sqlerrm); end;
  begin insert into public.media (family_id, kind, path) values (fB, 'gallery', fB || '/gallery/x.jpg');
    insert into t_res(name,ok) values ('child cannot add photos to another family', false);
  exception when others then insert into t_res(name,ok,info) values ('child cannot add photos to another family', true, sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub',uPB,'role','authenticated')::text, true);
  select count(*) into n from public.media where family_id = fA;
  insert into t_res(name,ok,info) values ('other family cannot see photos', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub',uPA,'role','authenticated')::text, true);
  insert into public.stars (child_id, date, note) values (cA, current_date, 'kind');
  insert into t_res(name,ok) values ('parent can give a star', true);
  update public.entries set status = 'approved' where child_id = cA;
  select * into pd from public.pay_child(cA, current_date);
  select cents into v from public.money_tx where child_id = cA and source = 'allowance';
  insert into t_res(name,ok,info) values ('allowance is paid with payday (1 week)', v = 200, coalesce(v::text,'none'));
  insert into t_res(name,ok,info) values ('payday period follows the child cycle', pd.period_start = current_date - 6, pd.period_start::text);
  raise exception 'RESULTS%', (select string_agg(E'\n' || case when ok then 'PASS ' else 'FAIL ' end || name || coalesce(' [' || left(info, 50) || ']', ''), '' order by t_res.n) from t_res);
end $$;
