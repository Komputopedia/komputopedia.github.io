# Kids Quest v1 (Asha Quest) spec

Status: agreed in grilling, 2026-11-12. Target: in use Monday 2026-11-16.

## Problem Statement

Parents want a child to build good habits (prayer, Quran reading, chores, study) and learn to manage money, with honest self-reporting. Tracking by hand is inconsistent, rules change often, and screen time is hard to keep within agreed limits. The family also wants the same system to serve other families later as a paid Komputopedia service.

## Solution

A web app (GitHub Pages + Supabase) where the child logs activities and screen time on her own iPad, parents approve and adjust, points are paid into savings every two weeks, and savings track every euro in and out. Rules are fully editable by parents and can start from a template (the Asha template first).

## User Stories

1. As a child, I want to log a prayer as alone or in congregation, so that I earn the right points.
2. As a child, I want an unlogged prayer to count as missed after the day ends, so that the rule is clear.
3. As a parent, I want to override an automatic missed-prayer entry until payday, so that I can correct mistakes.
4. As a parent, I want to enable an excused-days toggle per child, so that prayer penalties can be paused on excused days.
5. As a child, I want to log Quran pages with a quantity, so that bonus pages count.
6. As a parent, I want a weekly obligation (quota, penalty if missed, bonus per extra unit, optional partial penalty), so that minimum habits are required without paying for the minimum.
7. As a child, I want to see my reported points and my approved points, so that I stay motivated while waiting for approval.
8. As a parent, I want to approve or reject entries one by one or a whole day at once, so that reviewing is quick.
9. As a child, I want to propose a new activity and the points I ask for, so that good things outside the list count.
10. As a parent, I want to approve a proposal once or as a permanent activity, with different points if I choose.
11. As a parent, I want categories (Ibadah, Rumah, Akademis, …) that I can edit, so that activities are organised.
12. As a parent, I want to set the money value of one point, so that the economy fits our family.
13. As a parent, I want payday every two weeks in automatic, approval or manual mode, plus a manual pay button, so that payday fits our routine.
14. As a parent, I want payday to pay every approved, unpaid point, so that late approvals are paid next time and nothing is paid twice.
15. As a parent, I want negative points to reduce savings, even below zero, so that penalties must be paid back.
16. As a child, I want to ask to spend money on something with a category, so that I learn to plan purchases.
17. As a parent, I want to record money in or out with a category and a note (gift, Eid money, video fee, correction), so that savings are complete.
18. As a parent, I want a weekly or monthly allowance paid automatically, so that I do not forget.
19. As a child, I want charity (sedekah) to give back points (default half the value), so that I learn giving is not a loss.
20. As a child, I want to start and stop a screen-time timer and say what I use (iPad, YouTube, Switch, laptop, phone), so that my screen time is recorded.
21. As a child, I want to see how much screen time is left today and be warned at 5 minutes left.
22. As a parent, I want different weekday and weekend limits, a penalty per block of overtime, and a weekly reward for unused time.
23. As a parent, I want a forgotten timer to stop at 23:59 and be flagged, so that I can fix the duration.
24. As a parent, I want to edit or delete screen-time sessions.
25. As a parent, I want to save our rules as a private template and start a child from a template.
26. As a parent, I want my own login, and my spouse their own, so that approvals are attributed.
27. As a child, I want to log in once on my iPad with a username and PIN.
28. As a parent, I want to create the child's account and reset the PIN.
29. As a platform admin, I want to create a family and its first parent account.
30. As any family, I want to be sure no other family can see our data.
31. As a child, I must never be able to approve my own entries or set my own points.

## Implementation Decisions

- Static front end (no build step) at `/ashaquest/` on GitHub Pages; Supabase (eu-central-1) for auth, data and scheduled jobs.
- Multi-family, multi-child from day one. Every table carries `family_id`; Row Level Security limits each user to their family. A child reads the family's data but writes only through guarded paths.
- Accounts: parents use email and password; children use a family code, username and 6-digit PIN, stored as a synthetic email in Supabase Auth. Accounts are created by an Edge Function using the service role.
- One **rules engine** module (pure JavaScript, no dependencies) shared by the browser and the scheduled Edge Function. It derives automatic entries (missed prayer, weekly obligation result, screen-time overtime and weekly unused-time reward) and summaries (reported vs approved points, balance). Automatic entries have a stable key, so creating them is idempotent; a parent overrides one by waiving it, never by deleting it.
- Entry points are fixed when the entry is created (snapshot), so rule changes never rewrite history. A database trigger recomputes points for entries a child creates.
- Weekly-obligation entries carry 0 points; the week's result entry carries the penalty or bonus. Approved and pending entries count toward the quota.
- Payday pays all approved entries with no payday yet and a date up to the period end, creates the payday record and one money transaction, and marks the entries paid. Entries dated in a paid period can no longer be added; corrections go through money transactions.
- Charity: approving a spending transaction in a category with a point ratio creates an approved points entry.
- Screen time is started and stopped through database functions, so the child cannot edit durations.
- An hourly scheduled job runs the tick Edge Function: auto-stop, automatic entries, allowance, payday by mode. All steps are idempotent.
- Interface text lives in a translation dictionary; v1 ships Indonesian. English and Dutch follow.
- Mascot: an original faceless cloud.

## Testing Decisions

- Seam 1, rules engine: behaviour tests on its public functions with worked examples (dates, weeks, quotas, screen-time days, payday totals). Tests use `node:test`.
- Seam 2, database security: SQL checks run as a child, a parent and another family's parent: a child cannot approve, set points, read another family, or edit sessions; a parent of family A cannot read family B.
- The interface is checked by hand.

## Out of Scope (v1)

Weekly parent report and parent targets; self-service family sign-up and payment; English and Dutch text; public template gallery; push notifications; automatic tracking of device use.

## Further Notes

Data from the claude.ai prototype is not migrated; Asha starts fresh on Monday 2026-11-16, first payday Monday 2026-11-30. GDPR work (privacy policy, parental consent, processor terms) is required before paid customers.
