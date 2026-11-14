-- Round 2: payday cycle per child, allowance with payday, daily limits, proposal limits,
-- kindness stars, per-day screen adjustments, family photos (gallery and backgrounds).

-- ---------- per-child payday cycle ----------
alter table public.children
  add column period_anchor date,
  add column period_days int,
  add column payday_hour int not null default 6 check (payday_hour between 0 and 23),
  add column payday_mode text,
  add column proposals jsonb not null default '{"enabled":true,"perWeek":2}',
  add column background_path text;
update public.children c set period_anchor = f.period_anchor, period_days = f.period_days, payday_mode = f.payday_mode
  from public.families f where f.id = c.family_id;
alter table public.children
  alter column period_anchor set not null, alter column period_anchor set default current_date,
  alter column period_days set not null, alter column period_days set default 7,
  alter column payday_mode set not null, alter column payday_mode set default 'approval',
  add constraint children_period_days check (period_days in (7, 14, 21)),
  add constraint children_payday_mode check (payday_mode in ('auto','approval','manual'));

-- ---------- daily limit per activity ----------
alter table public.activities add column max_per_day int check (max_per_day is null or max_per_day > 0);

-- ---------- kindness stars (no money value) ----------
create table public.stars (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  date date not null,
  note text not null,
  emoji text not null default '⭐',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stars (child_id, date);

-- ---------- per-day screen limit adjustment (minutes, may be negative) ----------
create table public.screen_adjust (
  child_id uuid not null references public.children on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  date date not null,
  minutes int not null,
  primary key (child_id, date)
);

-- ---------- photos ----------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid references public.children on delete cascade,
  kind text not null check (kind in ('gallery','background')),
  path text not null unique,
  caption text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.media (family_id, created_at);

create trigger set_family before insert or update of child_id on public.stars for each row execute function kq.set_family_from_child();
create trigger set_family before insert or update of child_id on public.screen_adjust for each row execute function kq.set_family_from_child();

alter table public.stars enable row level security;
alter table public.screen_adjust enable row level security;
alter table public.media enable row level security;
grant select, insert, update, delete on public.stars, public.screen_adjust, public.media to authenticated, service_role;

create policy stars_read on public.stars for select to authenticated using (family_id = kq.my_family());
create policy stars_write on public.stars for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id));
create policy sadj_read on public.screen_adjust for select to authenticated using (family_id = kq.my_family());
create policy sadj_write on public.screen_adjust for all to authenticated using (kq.is_parent(family_id)) with check (kq.is_parent(family_id));
create policy media_read on public.media for select to authenticated using (family_id = kq.my_family());
create policy media_add on public.media for insert to authenticated with check (
  family_id = kq.my_family() and created_by = auth.uid() and split_part(path, '/', 1) = family_id::text
  and (kind = 'gallery' or kq.is_parent(family_id)));
create policy media_del on public.media for delete to authenticated using (
  family_id = kq.my_family() and (kq.is_parent(family_id) or created_by = auth.uid()));

-- Storage: private bucket, one folder per family.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-media', 'family-media', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy kq_media_read on storage.objects for select to authenticated
  using (bucket_id = 'family-media' and (storage.foldername(name))[1] = kq.my_family()::text);
create policy kq_media_add on storage.objects for insert to authenticated
  with check (bucket_id = 'family-media' and (storage.foldername(name))[1] = kq.my_family()::text);
create policy kq_media_del on storage.objects for delete to authenticated
  using (bucket_id = 'family-media' and (storage.foldername(name))[1] = kq.my_family()::text
         and (owner_id = auth.uid()::text or kq.is_parent(kq.my_family())));

-- ---------- guard: daily limits and proposal limits for children ----------
create or replace function kq.guard_entry() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.activities; o jsonb; ch public.children; wk date; n int;
begin
  if exists (select 1 from public.paydays p where p.child_id = new.child_id and p.status = 'paid' and p.period_end >= new.date)
     and new.source not in ('sedekah') then
    raise exception 'period_paid' using hint = 'This date is in a paid period. Use a money correction.';
  end if;
  if kq.my_child() is not null then
    new.created_by := auth.uid();
    select * into ch from public.children where id = new.child_id;
    if new.date > (now() at time zone (select timezone from public.families where id = new.family_id))::date then
      raise exception 'future date';
    end if;
    if new.source = 'proposal' then
      if coalesce((ch.proposals->>'enabled')::boolean, true) = false then raise exception 'proposals_off'; end if;
      wk := new.date - ((((new.date - ch.period_anchor) % 7) + 7) % 7);
      select count(*) into n from public.entries
       where child_id = new.child_id and source = 'proposal' and date between wk and wk + 6;
      if n >= coalesce((ch.proposals->>'perWeek')::int, 2) then raise exception 'limit_week'; end if;
      new.activity_id := null;
      new.points := coalesce(new.requested_points, 0);
    else
      select * into a from public.activities where id = new.activity_id and child_id = new.child_id and active;
      if a.id is null then raise exception 'unknown activity'; end if;
      if a.max_per_day is not null then
        select count(*) into n from public.entries
         where child_id = new.child_id and activity_id = a.id and date = new.date and auto_key is null and status in ('pending','approved');
        if n >= a.max_per_day then raise exception 'limit_day'; end if;
      end if;
      new.title := a.name; new.emoji := a.emoji; new.category_id := a.category_id;
      if a.kind = 'weekly' then new.points := 0;
      elsif a.kind = 'outcome' then
        select x into o from jsonb_array_elements(a.outcomes) x where x->>'key' = new.outcome_key;
        if o is null then raise exception 'unknown outcome'; end if;
        new.points := (o->>'points')::int;
      else new.points := round(a.points * coalesce(new.qty, 1));
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------- payday: per-child cycle, allowance paid with payday ----------
create or replace function public.pay_child(p_child uuid, p_upto date) returns public.paydays
language plpgsql security definer set search_path = '' as $$
declare ch public.children; f public.families; pd public.paydays; v_pts int; v_cents int; who uuid := auth.uid();
        today date; weeks int; al_cents int;
begin
  select * into ch from public.children where id = p_child;
  if ch.id is null then raise exception 'unknown child'; end if;
  if not kq.can_pay(ch.family_id) then raise exception 'parents only'; end if;
  select * into f from public.families where id = ch.family_id;
  today := (now() at time zone f.timezone)::date;
  select * into pd from public.paydays where child_id = p_child and period_end = p_upto for update;
  if pd.status = 'paid' then raise exception 'already_paid'; end if;

  select coalesce(sum(e.points), 0) into v_pts from public.entries e
   where e.child_id = p_child and e.status = 'approved' and e.payday_id is null and e.date <= p_upto and e.date >= ch.start_date;
  v_cents := v_pts * f.cents_per_point;

  if pd.id is null then
    insert into public.paydays (child_id, period_start, period_end, points, cents, status, paid_at, paid_by)
    values (p_child, greatest(p_upto - (ch.period_days - 1), ch.start_date), p_upto, v_pts, v_cents, 'paid', now(), who) returning * into pd;
  else
    update public.paydays set points = v_pts, cents = v_cents, status = 'paid', paid_at = now(), paid_by = who
     where id = pd.id returning * into pd;
  end if;

  update public.entries set payday_id = pd.id
   where child_id = p_child and status = 'approved' and payday_id is null and date <= p_upto and date >= ch.start_date;

  if v_cents <> 0 then
    insert into public.money_tx (child_id, cents, note, date, status, source, auto_key, payday_id, created_by, decided_by, decided_at)
    values (p_child, v_cents, 'Gajian ' || to_char(pd.period_start, 'DD/MM') || '–' || to_char(p_upto, 'DD/MM') || ' (' || v_pts || ' poin)',
            today, 'approved', 'payday', 'payday:' || p_upto, pd.id, who, who, now());
  end if;

  al_cents := coalesce((ch.allowance->>'cents')::int, 0);
  if coalesce((ch.allowance->>'enabled')::boolean, false) and coalesce(ch.allowance->>'mode', 'schedule') = 'payday' and al_cents > 0 then
    weeks := greatest(1, ch.period_days / 7);
    insert into public.money_tx (child_id, category_id, cents, note, date, status, source, auto_key, payday_id, created_by, decided_by, decided_at)
    values (p_child, (select id from public.categories where family_id = ch.family_id and kind = 'income' and name = 'Uang saku' limit 1),
            al_cents * weeks, 'Uang saku ' || weeks || ' minggu', today, 'approved', 'allowance', 'allow-pay:' || p_upto, pd.id, who, who, now())
    on conflict (child_id, auto_key) do nothing;
  end if;
  return pd;
end $$;
