# WFUMC Worship Planning

Future-oriented planning app for Wedowee First UMC. Sister to the
Bulletin, Sermons, and Social apps; shares the same Supabase backend.

## Phase 1 — what's here

- 12-week forecast view at `/`
- RCL data hand-curated in `src/data/rcl.json` (starts May 3, 2026)
- Per-week workflow:
  - Pastor / office_admin can: pick a text directly, open the four RCL
    readings for voting, or write in an off-lectionary text.
  - Worship-team eligible roles see thumbs-up vote buttons + live tally
    on every option once a vote is open.
  - Once a text is selected, it's pinned at the top of the card; pastor
    can re-open if plans change.

## Phase 2-4 (planned)

- Seasonal themes + custom week grouping (suggest / vote / select)
- Pastor-only intelligence panel (matching sermons + library resources)
- Auto-flow: selected text + theme populate upcoming bulletins, surface
  on the Social app dashboard
- Worship-element suggestions queue routing into the bulletin admin

## Setup (one time)

1. **GitHub repo**: `wfumc-worship` (already created).
2. **Secrets**: Settings → Secrets → Actions → add the same two values
   as the other apps:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. **Pages**: Settings → Pages → Source = "GitHub Actions".
4. Push `main` → deploys to `https://<user>.github.io/wfumc-worship/`.

## Local dev

```bash
cp .env.example .env.local
# Fill in the same values used by the other apps.
npm install
npm run dev
```

## Backend

`worship_plans`, `planning_options`, and `planning_votes` come from
migration `0029_worship_planning.sql` in the bulletin app's
`supabase/migrations/`. The existing `staff_profiles.role` enum picks
up the new `worship_team` role from the same migration.

## Updating RCL data

Edit `src/data/rcl.json` directly. Keep entries sorted by
`service_date`. Each entry needs `service_date`, `lectionary_year`,
`liturgical_season`, `designation`, `kind`, and a `readings` object
with `ot` / `psalm` / `epistle` / `gospel` references.

The starter file covers May 3, 2026 → August 9, 2026 (15 Sundays).
Extend forward as planning horizon requires.
