-- Gallery per child, at most 10 photos each.
-- Existing family-wide gallery photos go to the AO Family's first child (Asha), the only one using the gallery.

update public.media m set child_id = (select c.id from public.children c where c.family_id = m.family_id order by c.created_at limit 1)
where m.kind = 'gallery' and m.child_id is null;

alter table public.media add constraint media_gallery_has_child check (kind <> 'gallery' or child_id is not null);

-- A child adds photos only to their own gallery; parents to any child of the family.
alter policy media_add on public.media with check (
  family_id = kq.my_family() and created_by = auth.uid() and split_part(path, '/', 1) = family_id::text
  and (kq.is_parent(family_id) or (kind = 'gallery' and child_id = kq.my_child())));

create or replace function kq.guard_media() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.child_id is not null and not exists (select 1 from public.children c where c.id = new.child_id and c.family_id = new.family_id) then
    raise exception 'bad_child';
  end if;
  if new.kind = 'gallery' then
    perform pg_advisory_xact_lock(hashtext('kq-gallery:' || new.child_id::text));
    if (select count(*) from public.media m where m.child_id = new.child_id and m.kind = 'gallery') >= 10 then
      raise exception 'gallery_full';
    end if;
  end if;
  return new;
end $$;
revoke all on function kq.guard_media() from public;
create trigger guard_media before insert on public.media for each row execute function kq.guard_media();
