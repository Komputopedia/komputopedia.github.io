-- Half units (e.g. half a page of Quran): per-activity toggle, enforced for children's logs.
alter table public.activities add column allow_half boolean not null default false;

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
      if new.qty is not null then
        if new.qty <= 0 or new.qty > 1000 then raise exception 'bad_qty'; end if;
        if a.allow_half then
          if new.qty * 2 <> trunc(new.qty * 2) then raise exception 'bad_qty'; end if;
        elsif new.qty <> trunc(new.qty) then raise exception 'bad_qty';
        end if;
      end if;
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
      else new.points := trunc(a.points * coalesce(new.qty, 1));
      end if;
    end if;
  end if;
  return new;
end $$;

-- Asha may report half a page of Mengaji.
update public.activities a set allow_half = true
  from public.children c where c.id = a.child_id and c.username = 'asha' and a.name = 'Mengaji';
