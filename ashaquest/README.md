# Asha Quest v0.x (trial run of KidsQuest)

Family habit, points and savings app. Children log prayers, Quran reading, chores and screen time; parents approve; points are paid into savings every two weeks.

- Live: https://komputopedia.github.io/ashaquest/
- Spec: `docs/SPEC.md` · Glossary: `GLOSSARY.md` · Roadmap: `docs/ROADMAP.md`
- This is the AO Family trial run. After December 2026 it becomes **KidsQuest by KomputopediaKids**, open source in a `kidsquest` folder.
- Front end: plain ES modules (Preact + htm from esm.sh), no build step. `app/main.js` (UI), `app/api.js` (Supabase calls), `app/engine.js` (rules engine, shared with the hourly job), `app/i18n.js` (text).
- Back end: Supabase project `kids-quest` (eu-central-1). Schema and policies in `supabase/migrations/`, Edge Functions in `supabase/functions/` (`accounts`, `tick`), AO Family seed in `supabase/seed/`.
- The publishable key in `app/api.js` is meant to be public; all access is enforced by Row Level Security.

## Tests

- Rules engine: `node --test ashaquest/app/engine.test.mjs`
- Database security: run `supabase/tests/rls_test.sql` in the SQL editor. It rolls back and reports PASS/FAIL lines in the error message.

## Deploying

- Front end: push to `main`; GitHub Pages serves it.
- Edge Functions: `tick` bundles a copy of `app/engine.js`; copy it into `supabase/functions/tick/` before deploying.
