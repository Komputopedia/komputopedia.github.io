-- AO Family and the first "Template Asha". Accounts are created through the accounts function, not here.
insert into public.families (name, code, timezone, cents_per_point, period_anchor, period_days, payday_mode)
values ('AO Family', 'aofamily', 'Europe/Amsterdam', 10, '2026-11-16', 14, 'approval')
on conflict (code) do nothing;

with f as (select id from public.families where code = 'aofamily')
insert into public.categories (family_id, kind, name, emoji, points_ratio, sort)
select f.id, c.kind, c.name, c.emoji, c.ratio, c.sort from f, (values
  ('activity','Ibadah','🕌',null::numeric,1), ('activity','Rumah','🏠',null,2), ('activity','Akademis','🎓',null,3), ('activity','Lainnya','⭐',null,4),
  ('spend','Jajan','🍬',null,10), ('spend','Mainan','🧸',null,11), ('spend','Buku & alat tulis','📚',null,12),
  ('spend','Hadiah untuk orang lain','🎁',null,13), ('spend','Sedekah','🤲',0.5,14), ('spend','Lainnya','🛍️',null,15),
  ('income','Uang saku','💶',null,20), ('income','Hadiah','🎉',null,21), ('income','Honor video AO Family','🎬',null,22),
  ('income','Koreksi','✏️',null,23), ('income','Lainnya','💰',null,24),
  ('screen','iPad','📱',null,30), ('screen','YouTube','▶️',null,31), ('screen','Switch','🎮',null,32), ('screen','Laptop','💻',null,33), ('screen','HP','📞',null,34)
) as c(kind, name, emoji, ratio, sort)
where not exists (select 1 from public.categories x where x.family_id = f.id);

with f as (select id from public.families where code = 'aofamily')
insert into public.templates (family_id, name, description, data)
select f.id, 'Template Asha', 'Sholat 5 waktu (sendiri 0, jamaah +1, tidak −1), mengaji wajib 1 halaman/minggu (−2 jika kurang, +2 per halaman ekstra), contoh kegiatan rumah dan belajar.',
$json${
  "screen": {"enabled":true,"weekdayLimitMin":60,"weekendLimitMin":120,"overBlockMin":15,"overPenalty":-1,"leftoverBlockMin":30,"leftoverPointsPerBlock":1,"warnMin":5},
  "activities": [
    {"kind":"outcome","name":"Sholat Subuh","emoji":"🌅","category":"Ibadah","daily_required":true,"missed_key":"tidak","sort":1,"active":true,"points":0,"partial":false,
     "outcomes":[{"key":"sendiri","label":"Sendiri","points":0},{"key":"jamaah","label":"Berjamaah","points":1},{"key":"tidak","label":"Tidak sholat","points":-1}]},
    {"kind":"outcome","name":"Sholat Dzuhur","emoji":"☀️","category":"Ibadah","daily_required":true,"missed_key":"tidak","sort":2,"active":true,"points":0,"partial":false,
     "outcomes":[{"key":"sendiri","label":"Sendiri","points":0},{"key":"jamaah","label":"Berjamaah","points":1},{"key":"tidak","label":"Tidak sholat","points":-1}]},
    {"kind":"outcome","name":"Sholat Ashar","emoji":"🌤️","category":"Ibadah","daily_required":true,"missed_key":"tidak","sort":3,"active":true,"points":0,"partial":false,
     "outcomes":[{"key":"sendiri","label":"Sendiri","points":0},{"key":"jamaah","label":"Berjamaah","points":1},{"key":"tidak","label":"Tidak sholat","points":-1}]},
    {"kind":"outcome","name":"Sholat Maghrib","emoji":"🌇","category":"Ibadah","daily_required":true,"missed_key":"tidak","sort":4,"active":true,"points":0,"partial":false,
     "outcomes":[{"key":"sendiri","label":"Sendiri","points":0},{"key":"jamaah","label":"Berjamaah","points":1},{"key":"tidak","label":"Tidak sholat","points":-1}]},
    {"kind":"outcome","name":"Sholat Isya","emoji":"🌙","category":"Ibadah","daily_required":true,"missed_key":"tidak","sort":5,"active":true,"points":0,"partial":false,
     "outcomes":[{"key":"sendiri","label":"Sendiri","points":0},{"key":"jamaah","label":"Berjamaah","points":1},{"key":"tidak","label":"Tidak sholat","points":-1}]},
    {"kind":"weekly","name":"Mengaji","emoji":"📖","category":"Ibadah","unit":"halaman","quota":1,"penalty":-2,"bonus_per_unit":2,"partial":false,"sort":6,"active":true,"points":0,"outcomes":[],"daily_required":false},
    {"kind":"simple","name":"Hafalan","emoji":"🌟","category":"Ibadah","unit":"ayat","points":1,"sort":7,"active":true,"outcomes":[],"daily_required":false,"partial":false},
    {"kind":"simple","name":"Rapikan kamar","emoji":"🧹","category":"Rumah","points":1,"sort":10,"active":true,"outcomes":[],"daily_required":false,"partial":false},
    {"kind":"simple","name":"Bantu di rumah","emoji":"🏠","category":"Rumah","points":1,"sort":11,"active":true,"outcomes":[],"daily_required":false,"partial":false},
    {"kind":"simple","name":"Belajar / PR","emoji":"✏️","category":"Akademis","points":1,"sort":20,"active":true,"outcomes":[],"daily_required":false,"partial":false},
    {"kind":"simple","name":"Baca buku","emoji":"📚","category":"Akademis","unit":"halaman","points":0,"sort":21,"active":false,"outcomes":[],"daily_required":false,"partial":false}
  ]
}$json$::jsonb
from f where not exists (select 1 from public.templates t where t.family_id = f.id and t.name = 'Template Asha');

select f.code, (select count(*) from public.categories c where c.family_id = f.id) as categories,
       (select count(*) from public.templates t where t.family_id = f.id) as templates
from public.families f where f.code = 'aofamily';
