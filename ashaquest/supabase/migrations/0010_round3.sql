-- Round 3: themes (children may set their own), Quran position on entries, screen adjustments per quota.

alter table public.children add column theme jsonb not null default '{}';

-- A child may change only her own theme.
create or replace function public.set_my_theme(p_theme jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid := kq.my_child();
begin
  if c is null then raise exception 'children only'; end if;
  if jsonb_typeof(p_theme) <> 'object' or length(p_theme::text) > 2000 then raise exception 'bad_theme'; end if;
  update public.children set theme = p_theme where id = c;
end $$;
revoke execute on function public.set_my_theme(jsonb) from public, anon;
grant execute on function public.set_my_theme(jsonb) to authenticated;

-- Which activities record a Quran position, and the position itself.
alter table public.activities add column track_quran boolean not null default false;
alter table public.entries add column quran jsonb;
alter table public.entries add constraint entries_quran_shape check (
  quran is null or (
    (quran->>'surah')::int between 1 and 114
    and (quran->>'from')::int >= 1 and (quran->>'to')::int >= (quran->>'from')::int and (quran->>'to')::int <= 286));

-- Screen adjustments belong to one quota; the original single quota is 'main'.
alter table public.screen_adjust add column quota_id text not null default 'main';
alter table public.screen_adjust drop constraint screen_adjust_pkey;
alter table public.screen_adjust add primary key (child_id, date, quota_id);

-- Asha: Mengaji and Murajaah record surah and ayat; her single Switch quota becomes a named quota.
update public.activities a set track_quran = true
  from public.children c where c.id = a.child_id and c.username = 'asha' and a.name in ('Mengaji','Murajaah');
update public.children c set screen = (c.screen - 'mode' - 'weeklyLimitMin') || jsonb_build_object('quotas', jsonb_build_array(jsonb_build_object(
    'id','main','name','Switch','mode','weekly','weeklyLimitMin',60,'weekdayLimitMin',60,'weekendLimitMin',60,
    'deviceIds', (select jsonb_agg(k.id) from public.categories k where k.family_id = c.family_id and k.kind = 'screen' and k.name = 'Switch'))))
  where c.username = 'asha';
