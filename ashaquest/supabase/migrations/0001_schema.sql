-- Kids Quest schema. Every row belongs to a family; RLS keeps families apart.
create extension if not exists pgcrypto;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code ~ '^[a-z0-9]{3,24}$'),
  timezone text not null default 'Europe/Amsterdam',
  cents_per_point int not null default 10 check (cents_per_point > 0),
  period_anchor date not null default date '2026-11-16',
  period_days int not null default 14 check (period_days between 7 and 31),
  payday_mode text not null default 'approval' check (payday_mode in ('auto','approval','manual')),
  created_at timestamptz not null default now()
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  username text not null check (username ~ '^[a-z0-9]{2,20}$'),
  start_date date not null default current_date,
  excused_enabled boolean not null default false,
  screen jsonb not null default '{"enabled":true,"weekdayLimitMin":60,"weekendLimitMin":120,"overBlockMin":15,"overPenalty":-1,"leftoverBlockMin":30,"leftoverPointsPerBlock":1,"warnMin":5}',
  allowance jsonb not null default '{"enabled":false,"cents":0,"freq":"weekly","weekday":1,"monthday":1}',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (family_id, username)
);

create table public.members (
  user_id uuid primary key references auth.users on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  role text not null check (role in ('parent','child')),
  child_id uuid references public.children on delete cascade,
  display_name text not null,
  lang text not null default 'id',
  created_at timestamptz not null default now(),
  check ((role = 'child') = (child_id is not null))
);
create index on public.members (family_id);

create table public.platform_admins (user_id uuid primary key references auth.users on delete cascade);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  kind text not null check (kind in ('activity','spend','income','screen')),
  name text not null,
  emoji text,
  points_ratio numeric check (points_ratio is null or points_ratio >= 0),
  sort int not null default 0,
  active boolean not null default true
);
create index on public.categories (family_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  category_id uuid references public.categories on delete set null,
  kind text not null check (kind in ('simple','outcome','weekly')),
  name text not null,
  emoji text,
  unit text,
  points int not null default 0,
  outcomes jsonb not null default '[]',
  missed_key text,
  daily_required boolean not null default false,
  quota int,
  penalty int,
  bonus_per_unit int,
  partial boolean not null default false,
  start_date date not null default current_date,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.activities (child_id);

create table public.paydays (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  period_start date not null,
  period_end date not null,
  points int not null default 0,
  cents int not null default 0,
  status text not null default 'draft' check (status in ('draft','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid,
  unique (child_id, period_end)
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  activity_id uuid references public.activities on delete set null,
  category_id uuid references public.categories on delete set null,
  title text not null,
  emoji text,
  date date not null,
  qty numeric,
  outcome_key text,
  points int not null default 0,
  requested_points int,
  status text not null default 'pending' check (status in ('pending','approved','rejected','waived')),
  source text not null check (source in ('child','parent','auto','proposal','sedekah')),
  auto_key text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  payday_id uuid references public.paydays on delete set null,
  unique (child_id, auto_key)
);
create index on public.entries (child_id, date);

create table public.money_tx (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  category_id uuid references public.categories on delete set null,
  cents int not null check (cents <> 0),
  note text not null,
  date date not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  source text not null check (source in ('child','parent','payday','allowance')),
  auto_key text,
  payday_id uuid references public.paydays on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (child_id, auto_key)
);
create index on public.money_tx (child_id, date);

create table public.screen_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  child_id uuid not null references public.children on delete cascade,
  device_id uuid references public.categories on delete set null,
  device_label text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  auto_stopped boolean not null default false,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index screen_one_open on public.screen_sessions (child_id) where ended_at is null;
create index on public.screen_sessions (child_id, started_at);

create table public.excused_days (
  child_id uuid not null references public.children on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  date date not null,
  primary key (child_id, date)
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families on delete cascade,
  name text not null,
  description text,
  data jsonb not null,
  is_public boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- helpers (private schema, not exposed by the Data API) ----------
create schema if not exists kq;

create or replace function kq.my_family() returns uuid language sql stable security definer set search_path = '' as
$$ select family_id from public.members where user_id = auth.uid() $$;

create or replace function kq.my_child() returns uuid language sql stable security definer set search_path = '' as
$$ select child_id from public.members where user_id = auth.uid() and role = 'child' $$;

create or replace function kq.is_parent(f uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.members where user_id = auth.uid() and family_id = f and role = 'parent') $$;

create or replace function kq.is_admin() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;

grant usage on schema kq to authenticated;
grant execute on all functions in schema kq to authenticated;

-- family_id always comes from the child, never from the client
create or replace function kq.set_family_from_child() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select family_id into new.family_id from public.children where id = new.child_id;
  if new.family_id is null then raise exception 'unknown child'; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['activities','paydays','entries','money_tx','screen_sessions','excused_days'] loop
    execute format('create trigger set_family before insert or update of child_id on public.%I for each row execute function kq.set_family_from_child()', t);
  end loop;
end $$;
