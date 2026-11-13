-- Entries dated before the child's start date (trial days) are never paid.
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
   where e.child_id = p_child and e.status = 'approved' and e.payday_id is null and e.date <= p_upto and e.date >= ch.start_date;
  v_cents := v_pts * f.cents_per_point;

  if pd.id is null then
    insert into public.paydays (child_id, period_start, period_end, points, cents, status, paid_at, paid_by)
    values (p_child, p_upto - (f.period_days - 1), p_upto, v_pts, v_cents, 'paid', now(), who) returning * into pd;
  else
    update public.paydays set points = v_pts, cents = v_cents, status = 'paid', paid_at = now(), paid_by = who
     where id = pd.id returning * into pd;
  end if;

  update public.entries set payday_id = pd.id
   where child_id = p_child and status = 'approved' and payday_id is null and date <= p_upto and date >= ch.start_date;

  if v_cents <> 0 then
    insert into public.money_tx (child_id, cents, note, date, status, source, auto_key, payday_id, created_by, decided_by, decided_at)
    values (p_child, v_cents, 'Gajian ' || to_char(pd.period_start, 'DD/MM') || '–' || to_char(p_upto, 'DD/MM') || ' (' || v_pts || ' poin)',
            (now() at time zone f.timezone)::date, 'approved', 'payday', 'payday:' || p_upto, pd.id, who, who, now());
  end if;
  return pd;
end $$;

