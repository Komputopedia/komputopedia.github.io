-- How a signed-in child may move to a sibling's page: open (no PIN), pin (sibling's PIN), off (sign out first).
alter table public.families add column sibling_switch text not null default 'off' check (sibling_switch in ('open', 'pin', 'off'));
