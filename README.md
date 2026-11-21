# SikaBook

Church and organization finance — offerings, tithe, Day Born, dues, welfare, expenses with approval and
recipient confirmation, budgets, fundraising/pledges and reports. Built first for MDCC Teshie No. 1 Station.

- `app/` — the web app (plain HTML/CSS/JS + supabase-js). Deployed to GitHub Pages by `.github/workflows/pages.yml`.
- `supabase/schema.sql` — database tables, Row Level Security, triggers and functions. Safe to re-run.
- `prototype/` — the clickable design prototype (example data only).

Security model: every table uses Row Level Security. An admin or Financial Secretary sees all units; a
society treasurer sees only their society; nobody can delete money records (they are voided with a reason);
an approved expense cannot be edited; every change is written to the audit log.
`app/config.js` holds only the Supabase URL and the *publishable* key, which are safe to be public.
