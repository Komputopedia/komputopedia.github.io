-- Row Level Security, grants, guard triggers and RPCs.

do $$ declare t text; begin
  foreach t in array array['families','children','members','platform_admins','categories','activities','paydays','entries','money_tx','screen_sessions','excused_days','templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

grant insert, update, delete on public.children, public.categories, public.activities, public.paydays,
  public.entries, public.money_tx, public.screen_sessions, public.excused_days, public.templates to authenticated;
grant update on public.families to authenticated;

-- families / members / admins
create policy fam_read on public.families for select to authenticated using (id = kq.my_family() or kq.is_admin());
create policy fam_update on public.families for update to authenticated using (kq.is_parent(id)) with check (kq.is_parent(id));
create policy mem_read on public.members for select to authenticated using (family_id = kq.my_family() or kq.is_admin());
create policy adm_read on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- family-owned tables: whole family reads, parents write
do $$ declare t text; begin
  foreach t in array array['children','categories','activities','paydays','excused_days'] loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (family_id = kq.my_family())', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id))', t);
  end loop;
end $$;

create policy tpl_read on public.templates for select to authenticated using (is_public or family_id = kq.my_family() or kq.is_admin());
create policy tpl_write on public.templates for all to authenticated
  using (kq.is_admin() or (family_id is not null and kq.is_parent(family_id)))
  with check (kq.is_admin() or (family_id is not null and kq.is_parent(family_id) and not is_public));

-- entries: parents anything; a child only adds own pending logs/proposals and removes own pending ones
create policy ent_read on public.entries for select to authenticated using (family_id = kq.my_family());
create policy ent_parent on public.entries for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id));
create policy ent_child_add on public.entries for insert to authenticated with check (
  child_id = kq.my_child() and status = 'pending' and source in ('child','proposal') and auto_key is null and payday_id is null);
create policy ent_child_del on public.entries for delete to authenticated using (child_id = kq.my_child() and status = 'pending');

-- money: parents anything; a child only asks to spend
create policy tx_read on public.money_tx for select to authenticated using (family_id = kq.my_family());
create policy tx_parent on public.money_tx for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id));
create policy tx_child_add on public.money_tx for insert to authenticated with check (
  child_id = kq.my_child() and status = 'pending' and source = 'child' and cents < 0 and auto_key is null and payday_id is null);
create policy tx_child_del on public.money_tx for delete to authenticated using (child_id = kq.my_child() and status = 'pending');

-- screen sessions: read by family, written by parents; children go through the RPCs below
create policy scr_read on public.screen_sessions for select to authenticated using (family_id = kq.my_family());
create policy scr_parent on public.screen_sessions for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id));

-- ---------- guard triggers ----------
-- A child's entry gets its points from the rules, never from the client.
create or replace function kq.guard_entry() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.activities; o jsonb;
begin
  if exists (select 1 from public.paydays p where p.child_id = new.child_id and p.status = 'paid' and p.period_end >= new.date)
     and new.source not in ('sedekah') then
    raise exception 'period_paid' using hint = 'This date is in a paid period. Use a money correction.';
  end if;
  if kq.my_child() is not null then
    new.created_by := auth.uid();
    if new.source = 'proposal' then
      new.activity_id := null;
      new.points := coalesce(new.requested_points, 0);
    else
      select * into a from public.activities where id = new.activity_id and child_id = new.child_id and active;
      if a.id is null then raise exception 'unknown activity'; end if;
      new.title := a.name; new.emoji := a.emoji; new.category_id := a.category_id;
      if a.kind = 'weekly' then new.points := 0;
      elsif a.kind = 'outcome' then
        select x into o from jsonb_array_elements(a.outcomes) x where x->>'key' = new.outcome_key;
        if o is null then raise exception 'unknown outcome'; end if;
        new.points := (o->>'points')::int;
      else new.points := round(a.points * coalesce(new.qty, 1));
      end if;
    end if;
    if new.date > (now() at time zone (select timezone from public.families where id = new.family_id))::date then
      raise exception 'future date';
    end if;
  end if;
  return new;
end $$;
create trigger zz_guard_entry before insert on public.entries for each row execute function kq.guard_entry();

-- Approved charity spending earns points back.
create or replace function kq.charity_points() returns trigger language plpgsql security definer set search_path = '' as $$
declare r numeric; cpp int; pts int;
begin
  if new.status <> 'approved' or new.cents >= 0 or new.category_id is null then return new; end if;
  select points_ratio into r from public.categories where id = new.category_id;
  if r is null or r = 0 then return new; end if;
  select cents_per_point into cpp from public.families where id = new.family_id;
  pts := ceil(abs(new.cents)::numeric / cpp * r - 0.000000001);
  insert into public.entries (child_id, category_id, title, emoji, date, points, status, source, auto_key, note, decided_at)
  values (new.child_id, new.category_id, 'Sedekah', '🤲', new.date, pts, 'approved', 'sedekah', 'sedekah:' || new.id, new.note, now())
  on conflict (child_id, auto_key) do nothing;
  return new;
end $$;
create trigger charity_points after insert or update of status on public.money_tx for each row execute function kq.charity_points();

-- ---------- RPCs ----------
create or replace function public.screen_start(p_device uuid) returns public.screen_sessions
language plpgsql security definer set search_path = '' as $$
declare c uuid := kq.my_child(); s public.screen_sessions; lbl text;
begin
  if c is null then raise exception 'children only'; end if;
  select * into s from public.screen_sessions where child_id = c and ended_at is null;
  if s.id is not null then return s; end if;
  select coalesce(emoji || ' ', '') || name into lbl from public.categories
   where id = p_device and kind = 'screen' and family_id = kq.my_family();
  if lbl is null then raise exception 'unknown device'; end if;
  insert into public.screen_sessions (child_id, device_id, device_label) values (c, p_device, lbl) returning * into s;
  return s;
end $$;

create or replace function public.screen_stop() returns public.screen_sessions
language plpgsql security definer set search_path = '' as $$
declare c uuid := kq.my_child(); s public.screen_sessions;
begin
  if c is null then raise exception 'children only'; end if;
  update public.screen_sessions set ended_at = now() where child_id = c and ended_at is null returning * into s;
  return s;
end $$;

create or replace function kq.can_pay(f uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select kq.is_parent(f)
      or coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and session_user <> 'authenticator')
$$;

-- Pay every approved, unpaid entry up to p_upto. Parents of the family or the service role.
create or replace function public.pay_child(p_child uuid, p_upto date) returns public.paydays
language plpgsql security definer set search_path = '' as $$
declare ch public.children; f public.families; pd public.paydays; v_pts int; v_cents int; who uuid := auth.uid();
begin
  select * into ch from public.children where id = p_child;
  if ch.id is null then raise exception 'unknown child'; end if;
  if not kq.can_pay(ch.family_id) then
    raise exception 'parents only';
  end if;
  select * into f from public.families where id = ch.family_id;
  select * into pd from public.paydays where child_id = p_child and period_end = p_upto for update;
  if pd.status = 'paid' then raise exception 'already_paid'; end if;

  select coalesce(sum(e.points), 0) into v_pts from public.entries e
   where e.child_id = p_child and e.status = 'approved' and e.payday_id is null and e.date <= p_upto;
  v_cents := v_pts * f.cents_per_point;

  if pd.id is null then
    insert into public.paydays (child_id, period_start, period_end, points, cents, status, paid_at, paid_by)
    values (p_child, p_upto - (f.period_days - 1), p_upto, v_pts, v_cents, 'paid', now(), who) returning * into pd;
  else
    update public.paydays set points = v_pts, cents = v_cents, status = 'paid', paid_at = now(), paid_by = who
     where id = pd.id returning * into pd;
  end if;

  update public.entries set payday_id = pd.id
   where child_id = p_child and status = 'approved' and payday_id is null and date <= p_upto;

  if v_cents <> 0 then
    insert into public.money_tx (child_id, cents, note, date, status, source, auto_key, payday_id, created_by, decided_by, decided_at)
    values (p_child, v_cents, 'Gajian ' || to_char(pd.period_start, 'DD/MM') || '–' || to_char(p_upto, 'DD/MM') || ' (' || v_pts || ' poin)',
            (now() at time zone f.timezone)::date, 'approved', 'payday', 'payday:' || p_upto, pd.id, who, who, now());
  end if;
  return pd;
end $$;

revoke execute on function public.screen_start(uuid), public.screen_stop(), public.pay_child(uuid, date) from public, anon;
grant execute on function public.screen_start(uuid), public.screen_stop(), public.pay_child(uuid, date) to authenticated;
