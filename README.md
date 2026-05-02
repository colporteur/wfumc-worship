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

## Phase 2 — what's here

- **Special services** (Ash Wed, Christmas Eve, funerals, weddings, etc.)
  inline with Sundays in the forecast. Two flavors:
  - *Planning* services share the Sunday workflow (voting, themes, etc.)
  - *Lightweight* services are calendar-only records (funerals, weddings)
- **Themes** at `/themes`:
  - Season groupings (one per liturgical season) with suggest/vote/select
  - Custom groupings — pastor names a sermon arc / series and adds dates
  - Same thumbs-up voting model as scripture options
- **Library** at `/library`:
  - Reusable liturgy text (call to worship, prayers, responsive readings)
  - Reusable hymn picks (hymnal + number + notes)
  - Tagged by season, free-form tags, and scripture refs
  - One-click attach to any upcoming service date
- **Suggestions** at `/suggestions`:
  - Phase-4 preview queue. Anyone on the team can suggest a hymn or
    liturgy element; pastor reviews and accepts / declines.

## Phase 3-4 (planned)

- Pastor-only intelligence panel (matching sermons + library resources
  for the selected text)
- Auto-flow: selected text + theme populate upcoming bulletins; surface
  on the Social app dashboard
- Tighter integration of Suggestions queue with the bulletin admin

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

Phase 2 adds migration `0030_worship_planning_phase2.sql` (in the same
bulletin app `supabase/migrations/` directory) for `special_services`,
`worship_groupings`, `worship_grouping_dates`, `theme_options`,
`theme_votes`, `worship_elements`, `week_elements`, and
`element_suggestions`. Run that migration before deploying the Phase 2
build.

## Updating RCL data

Edit `src/data/rcl.json` directly. Keep entries sorted by
`service_date`. Each entry needs `service_date`, `lectionary_year`,
`liturgical_season`, `designation`, `kind`, and a `readings` object
with `ot` / `psalm` / `epistle` / `gospel` references.

The starter file covers May 3, 2026 → August 9, 2026 (15 Sundays).
Extend forward as planning horizon requires.
