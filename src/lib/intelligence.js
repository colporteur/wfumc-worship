// Pastor intelligence helpers — query sermons + resources, score them
// against a target text + theme, return tiered results.
//
// Used by IntelligencePanel on each WeekCard. Pastor-only (the panel
// gates rendering; these helpers are RLS-scoped — staff can read all
// sermons + resources via the existing policies).
//
// Each lookup is best-effort: we cap result counts and degrade gracefully
// if a query fails (the panel still shows the other sections).

import { supabase, withTimeout } from './supabase';
import {
  parseRefs,
  bestOverlapTier,
  TIER_RANK,
  TIER_LABELS,
} from './scripture';

// Pull sermons that might match `targetRef` (parsed scripture).
//
// We do an initial coarse server-side filter on book name (cheaper than
// pulling every sermon ever), then score client-side against the parsed
// ref. The set of returned books is small (1 per parsed ref), so the
// query is bounded.
//
// Returns: [{ sermon, tier, ownerIsCurrentUser }]
async function querySermonsByRef(targetRefs, currentUserId) {
  if (!targetRefs || targetRefs.length === 0) return [];

  // Build OR pattern: book name match. We use ILIKE for fuzzy match
  // so "John" finds "John 3:16", "John 4", etc. Using PostgREST's
  // OR syntax: scripture_reference.ilike.%John%,...
  const books = [...new Set(targetRefs.map((r) => r.book))];
  const orParts = books.map(
    (b) => `scripture_reference.ilike.%${b.replace(/[%_]/g, '')}%`
  );
  const orClause = orParts.join(',');

  const { data, error } = await withTimeout(
    supabase
      .from('sermons')
      .select(
        'id, title, scripture_reference, theme, preached_at, owner_user_id'
      )
      .or(orClause)
      .order('preached_at', { ascending: false, nullsFirst: false })
      .limit(200)
  );
  if (error) {
    // Don't blow up the whole panel — log and return empty.
    // eslint-disable-next-line no-console
    console.warn('querySermonsByRef:', error.message);
    return [];
  }

  const out = [];
  for (const s of data ?? []) {
    if (!s.scripture_reference) continue;
    const candidateRefs = parseRefs(s.scripture_reference);
    if (candidateRefs.length === 0) continue;
    const tier = bestOverlapTier(targetRefs, candidateRefs);
    if (tier === 'none') continue;
    out.push({
      sermon: s,
      tier,
      ownerIsCurrentUser: s.owner_user_id === currentUserId,
    });
  }
  // Strongest tier first, then most recent
  out.sort((a, b) => {
    const tr = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tr !== 0) return tr;
    const ad = a.sermon.preached_at || '';
    const bd = b.sermon.preached_at || '';
    return bd.localeCompare(ad);
  });
  return out;
}

// Pull resources whose scripture_refs string overlaps `targetRefs`.
// Same coarse-filter approach as sermons — server-side ILIKE on book
// name(s), score client-side.
async function queryResourcesByRef(targetRefs) {
  if (!targetRefs || targetRefs.length === 0) return [];

  const books = [...new Set(targetRefs.map((r) => r.book))];
  const orParts = books.map(
    (b) => `scripture_refs.ilike.%${b.replace(/[%_]/g, '')}%`
  );
  const orClause = orParts.join(',');

  const { data, error } = await withTimeout(
    supabase
      .from('resources')
      .select('id, title, content, resource_type, themes, scripture_refs, tone')
      .or(orClause)
      .limit(200)
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('queryResourcesByRef:', error.message);
    return [];
  }

  const out = [];
  for (const r of data ?? []) {
    if (!r.scripture_refs) continue;
    const candidateRefs = parseRefs(r.scripture_refs);
    if (candidateRefs.length === 0) continue;
    const tier = bestOverlapTier(targetRefs, candidateRefs);
    if (tier === 'none') continue;
    out.push({ resource: r, tier });
  }
  out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  return out;
}

// Pull resources whose `themes` array overlaps any of the given theme
// strings. Postgres array overlap (ILIKE for fuzzy, since themes are
// free-form strings).
async function queryResourcesByTheme(themeTerms) {
  if (!themeTerms || themeTerms.length === 0) return [];

  // Each term: themes.cs.{term}  (contains array element exactly).
  // We also try a fallback fuzzy search via title/content ILIKE for
  // theme strings that don't have exact matches. Keep it simple:
  // exact theme tag match using the .ov.{...} contains-overlap operator.
  const cleanTerms = themeTerms
    .map((t) => t?.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  if (cleanTerms.length === 0) return [];

  // PostgREST: themes=ov.{a,b,c} → array overlap
  const ovList = `{${cleanTerms.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`;

  const { data, error } = await withTimeout(
    supabase
      .from('resources')
      .select('id, title, content, resource_type, themes, scripture_refs, tone')
      .overlaps('themes', cleanTerms)
      .limit(100)
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('queryResourcesByTheme:', error.message, 'tried', ovList);
    return [];
  }
  return (data ?? []).map((r) => ({ resource: r, tier: 'theme_match' }));
}

// Build the theme search terms from a worship_plan's grouping themes.
// `selectedThemes` is an array of theme_option rows.
function themeTermsFromSelections(selectedThemes) {
  const terms = new Set();
  for (const t of selectedThemes ?? []) {
    if (t.title) {
      // Add the title itself, plus each significant word (>3 chars).
      terms.add(t.title.toLowerCase());
      for (const w of t.title.toLowerCase().split(/\s+/)) {
        if (w.length > 3) terms.add(w);
      }
    }
  }
  return [...terms];
}

// Main entry point. Returns:
//   {
//     wfumcSermons: [{sermon, tier}],
//     otherSermons: [{sermon, tier}],
//     resourcesByText: [{resource, tier}],
//     resourcesByTheme: [{resource, tier}],
//   }
//
// `pastorUserId` is used to decide which sermons count as "WFUMC". If
// you don't pass it, every sermon falls into otherSermons.
export async function loadIntelligence({
  scriptureReference,
  themes,
  pastorUserId,
}) {
  const targetRefs = parseRefs(scriptureReference);
  const themeTerms = themeTermsFromSelections(themes);

  const [sermons, resourcesByText, resourcesByTheme] = await Promise.all([
    targetRefs.length > 0
      ? querySermonsByRef(targetRefs, pastorUserId)
      : Promise.resolve([]),
    targetRefs.length > 0
      ? queryResourcesByRef(targetRefs)
      : Promise.resolve([]),
    themeTerms.length > 0
      ? queryResourcesByTheme(themeTerms)
      : Promise.resolve([]),
  ]);

  // Split sermons by ownership
  const wfumcSermons = [];
  const otherSermons = [];
  for (const s of sermons) {
    if (pastorUserId && s.sermon.owner_user_id === pastorUserId) {
      wfumcSermons.push(s);
    } else {
      otherSermons.push(s);
    }
  }

  // De-duplicate resources between text and theme matches.
  const textIds = new Set(resourcesByText.map((r) => r.resource.id));
  const themesDedup = resourcesByTheme.filter((r) => !textIds.has(r.resource.id));

  return {
    wfumcSermons,
    otherSermons,
    resourcesByText,
    resourcesByTheme: themesDedup,
    targetRefs,
    themeTerms,
  };
}

// Re-export tier constants for the panel UI.
export { TIER_RANK, TIER_LABELS };

// Resolve the pastor's user_id by reading the staff_profiles table.
// Cached for the session (the panel calls this once per page load).
let _pastorIdCache = null;
let _pastorIdInflight = null;
export async function getPastorUserId() {
  if (_pastorIdCache !== null) return _pastorIdCache;
  if (_pastorIdInflight) return _pastorIdInflight;
  _pastorIdInflight = (async () => {
    const { data, error } = await withTimeout(
      supabase
        .from('staff_profiles')
        .select('user_id')
        .eq('role', 'pastor')
        .limit(1)
        .maybeSingle()
    );
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('getPastorUserId:', error.message);
      return null;
    }
    _pastorIdCache = data?.user_id ?? null;
    return _pastorIdCache;
  })();
  return _pastorIdInflight;
}
