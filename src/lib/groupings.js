// Helpers for worship_groupings + theme_options + theme_votes.
//
// A grouping is a bucket that ties multiple service_dates together for
// shared theming. Two kinds:
//
//   * 'season' — auto-grouping for a liturgical season. Created on
//                demand the first time someone wants to suggest a theme
//                for that season. Members are every upcoming service
//                in that season. The 'season' column holds the season
//                name ('advent', 'lent', etc.).
//
//   * 'custom' — pastor-defined arbitrary grouping. Pastor adds and
//                removes dates manually. Use for sermon arcs, special
//                series, multi-week emphases. 'season' is null.
//
// Themes follow the same suggest/vote/select model as scripture options
// for a single Sunday — open thumbs-up votes, pastor decides.

import { supabase, withTimeout } from './supabase';

export const SEASON_LABELS = {
  advent: 'Advent',
  christmas: 'Christmas',
  epiphany: 'Epiphany',
  lent: 'Lent',
  easter: 'Easter',
  pentecost: 'Pentecost',
  ordinary: 'Ordinary Time',
  special: 'Special',
};

// ---------- LOAD ----------

// Pull every grouping the app needs — paired with the dates each contains.
// Returns:
//   {
//     groupings:           [grouping rows...],
//     datesByGrouping:     { grouping_id → [service_date, ...] },
//     groupingsByDate:     { service_date → [grouping rows in name order] },
//     themesByGrouping:    { grouping_id → [theme_option rows...] },
//     votesByTheme:        { theme_option_id → [vote rows] },
//     myVotedThemes:       Set<theme_option_id>,
//   }
export async function loadGroupingState(userId) {
  const [groupingsRes, datesRes, themesRes] = await Promise.all([
    withTimeout(
      supabase
        .from('worship_groupings')
        .select('*')
        .order('grouping_kind', { ascending: true })
        .order('name', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('worship_grouping_dates')
        .select('grouping_id, service_date')
    ),
    withTimeout(
      supabase
        .from('theme_options')
        .select('*')
        .order('created_at', { ascending: true })
    ),
  ]);
  if (groupingsRes.error) throw groupingsRes.error;
  if (datesRes.error) throw datesRes.error;
  if (themesRes.error) throw themesRes.error;

  const groupings = groupingsRes.data ?? [];
  const dates = datesRes.data ?? [];
  const themes = themesRes.data ?? [];

  const datesByGrouping = {};
  for (const g of groupings) datesByGrouping[g.id] = [];
  for (const d of dates) {
    if (!datesByGrouping[d.grouping_id]) datesByGrouping[d.grouping_id] = [];
    datesByGrouping[d.grouping_id].push(d.service_date);
  }

  const groupingsById = Object.fromEntries(groupings.map((g) => [g.id, g]));
  const groupingsByDate = {};
  for (const d of dates) {
    if (!groupingsByDate[d.service_date]) groupingsByDate[d.service_date] = [];
    const g = groupingsById[d.grouping_id];
    if (g) groupingsByDate[d.service_date].push(g);
  }

  const themesByGrouping = {};
  for (const g of groupings) themesByGrouping[g.id] = [];
  for (const t of themes) {
    if (!themesByGrouping[t.grouping_id]) themesByGrouping[t.grouping_id] = [];
    themesByGrouping[t.grouping_id].push(t);
  }

  // Pull votes for all themes in one shot.
  let votes = [];
  if (themes.length > 0) {
    const votesRes = await withTimeout(
      supabase
        .from('theme_votes')
        .select('id, theme_option_id, user_id')
        .in('theme_option_id', themes.map((t) => t.id))
    );
    if (votesRes.error) throw votesRes.error;
    votes = votesRes.data ?? [];
  }

  const votesByTheme = {};
  for (const v of votes) {
    if (!votesByTheme[v.theme_option_id]) votesByTheme[v.theme_option_id] = [];
    votesByTheme[v.theme_option_id].push(v);
  }

  const myVotedThemes = new Set(
    votes.filter((v) => v.user_id === userId).map((v) => v.theme_option_id)
  );

  return {
    groupings,
    datesByGrouping,
    groupingsByDate,
    themesByGrouping,
    votesByTheme,
    myVotedThemes,
  };
}

// ---------- GROUPINGS ----------

export async function createGrouping({
  name,
  description,
  groupingKind,
  season,
  createdBy,
}) {
  if (!name?.trim()) throw new Error('Grouping name is required.');
  if (!['season', 'custom'].includes(groupingKind)) {
    throw new Error("groupingKind must be 'season' or 'custom'.");
  }
  const payload = {
    name: name.trim(),
    description: description?.trim() || null,
    grouping_kind: groupingKind,
    season: groupingKind === 'season' ? season : null,
    created_by: createdBy ?? null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('worship_groupings')
      .insert(payload)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateGrouping(id, fields) {
  const payload = {};
  if ('name' in fields) payload.name = fields.name?.trim();
  if ('description' in fields)
    payload.description = fields.description?.trim() || null;
  if ('selected_theme_option_id' in fields)
    payload.selected_theme_option_id = fields.selected_theme_option_id;
  const { data, error } = await withTimeout(
    supabase
      .from('worship_groupings')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteGrouping(id) {
  const { error } = await withTimeout(
    supabase.from('worship_groupings').delete().eq('id', id)
  );
  if (error) throw error;
}

// Idempotent: lookup-or-create the season grouping for a (season, year)
// pair. Name format: 'Season 2026' so we get one per liturgical year.
export async function ensureSeasonGrouping(season, year, createdBy) {
  if (!season || !year) throw new Error('season and year required.');
  const seasonLabel = SEASON_LABELS[season] || season;
  const name = `${seasonLabel} ${year}`;

  const { data: existing, error: lookupErr } = await withTimeout(
    supabase
      .from('worship_groupings')
      .select('*')
      .eq('grouping_kind', 'season')
      .eq('season', season)
      .ilike('name', name)
      .limit(1)
      .maybeSingle()
  );
  if (lookupErr) throw lookupErr;
  if (existing) return existing;

  return createGrouping({
    name,
    description: null,
    groupingKind: 'season',
    season,
    createdBy,
  });
}

// ---------- GROUPING DATES ----------

export async function addDateToGrouping(groupingId, serviceDate) {
  const { error } = await withTimeout(
    supabase
      .from('worship_grouping_dates')
      .upsert(
        { grouping_id: groupingId, service_date: serviceDate },
        { onConflict: 'grouping_id,service_date', ignoreDuplicates: true }
      )
  );
  if (error) throw error;
}

export async function removeDateFromGrouping(groupingId, serviceDate) {
  const { error } = await withTimeout(
    supabase
      .from('worship_grouping_dates')
      .delete()
      .eq('grouping_id', groupingId)
      .eq('service_date', serviceDate)
  );
  if (error) throw error;
}

// Bulk-replace the dates on a grouping. Passes through addDateToGrouping
// for each new entry; removes any not present in `dates`.
export async function setGroupingDates(groupingId, dates) {
  const { data: existing, error: lookupErr } = await withTimeout(
    supabase
      .from('worship_grouping_dates')
      .select('service_date')
      .eq('grouping_id', groupingId)
  );
  if (lookupErr) throw lookupErr;
  const have = new Set((existing ?? []).map((r) => r.service_date));
  const want = new Set(dates);
  const toAdd = [...want].filter((d) => !have.has(d));
  const toRemove = [...have].filter((d) => !want.has(d));

  if (toAdd.length > 0) {
    const { error } = await withTimeout(
      supabase
        .from('worship_grouping_dates')
        .insert(toAdd.map((d) => ({ grouping_id: groupingId, service_date: d })))
    );
    if (error) throw error;
  }
  if (toRemove.length > 0) {
    const { error } = await withTimeout(
      supabase
        .from('worship_grouping_dates')
        .delete()
        .eq('grouping_id', groupingId)
        .in('service_date', toRemove)
    );
    if (error) throw error;
  }
}

// ---------- THEMES ----------

export async function suggestTheme({
  groupingId,
  title,
  description,
  scriptureAnchor,
  createdBy,
}) {
  if (!groupingId) throw new Error('groupingId is required.');
  if (!title?.trim()) throw new Error('Theme title is required.');
  const payload = {
    grouping_id: groupingId,
    title: title.trim(),
    description: description?.trim() || null,
    scripture_anchor: scriptureAnchor?.trim() || null,
    created_by: createdBy ?? null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('theme_options')
      .insert(payload)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteTheme(id) {
  const { error } = await withTimeout(
    supabase.from('theme_options').delete().eq('id', id)
  );
  if (error) throw error;
}

// Toggle the current user's vote on a theme option (mirror of the
// scripture toggleVote flow in planning.js).
export async function toggleThemeVote(themeOptionId, userId, currentlyVoted) {
  if (currentlyVoted) {
    const { error } = await withTimeout(
      supabase
        .from('theme_votes')
        .delete()
        .eq('theme_option_id', themeOptionId)
        .eq('user_id', userId)
    );
    if (error) throw error;
  } else {
    const { error } = await withTimeout(
      supabase
        .from('theme_votes')
        .insert({ theme_option_id: themeOptionId, user_id: userId })
    );
    if (error) throw error;
  }
}

// Pastor selects a theme as the winner. Sets selected_theme_option_id
// on the grouping. Pass `null` to re-open.
export async function selectThemeForGrouping(groupingId, themeOptionId) {
  return updateGrouping(groupingId, {
    selected_theme_option_id: themeOptionId,
  });
}

// Derive a theme's status given the loaded state.
//   undecided — no themes proposed
//   suggesting — themes exist, no votes yet
//   voting    — themes exist, ≥1 vote
//   selected  — grouping.selected_theme_option_id is set
export function deriveThemeStatus(grouping, state) {
  if (grouping.selected_theme_option_id) return 'selected';
  const themes = state.themesByGrouping[grouping.id] ?? [];
  if (themes.length === 0) return 'undecided';
  const hasVotes = themes.some(
    (t) => (state.votesByTheme[t.id]?.length ?? 0) > 0
  );
  return hasVotes ? 'voting' : 'suggesting';
}
