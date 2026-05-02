// Pastor intelligence helpers — query sermons + resources, score them
// against a target text + theme, return tiered results.
//
// Used by IntelligencePanel on each WeekCard. Pastor-only (the panel
// gates rendering; these helpers are RLS-scoped — staff can read all
// sermons + resources via the existing policies).
//
// Sermons are bucketed by whether they've been preached at WFUMC (i.e.,
// linked to a bulletin in this app via a preaching row with non-null
// bulletin_id). Sermons may also link out to the Sermon Archive app
// when a manuscript is attached (URL controlled by VITE_SERMON_ARCHIVE_URL).
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

// Sermon Archive base URL — set via env var. If unset, sermon links are
// hidden (no broken URLs). Trailing slash stripped for clean concatenation.
const SERMON_ARCHIVE_URL = (
  import.meta.env.VITE_SERMON_ARCHIVE_URL || ''
).replace(/\/$/, '');

export function sermonArchiveUrl(sermonId) {
  if (!SERMON_ARCHIVE_URL) return null;
  return `${SERMON_ARCHIVE_URL}/sermons/${sermonId}`;
}

// Pull sermons that might match `targetRefs` (parsed scripture). Coarse
// server-side ILIKE on book name, score client-side.
async function querySermonsByRef(targetRefs) {
  if (!targetRefs || targetRefs.length === 0) return [];

  const books = [...new Set(targetRefs.map((r) => r.book))];
  const orParts = books.map(
    (b) => `scripture_reference.ilike.%${b.replace(/[%_]/g, '')}%`
  );
  const orClause = orParts.join(',');

  const { data, error } = await withTimeout(
    supabase
      .from('sermons')
      .select(
        // Pull the manuscript columns (just to know if they're set — we
        // don't render the body) so we can show a "has manuscript" hint
        // and conditionally link.
        'id, title, scripture_reference, theme, preached_at, owner_user_id, manuscript_text, manuscript_url'
      )
      .or(orClause)
      .order('preached_at', { ascending: false, nullsFirst: false })
      .limit(200)
  );
  if (error) {
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
      sermon: {
        ...s,
        // Strip the actual manuscript text from the result — we only
        // need a boolean. Keeps the in-memory footprint small for big
        // result sets.
        manuscript_text: undefined,
        hasManuscript: Boolean(s.manuscript_text || s.manuscript_url),
      },
      tier,
    });
  }
  out.sort((a, b) => {
    const tr = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tr !== 0) return tr;
    const ad = a.sermon.preached_at || '';
    const bd = b.sermon.preached_at || '';
    return bd.localeCompare(ad);
  });
  return out;
}

// Pull preachings for a list of sermon ids. Returns:
//   { sermonId → { wfumcDates: [date,...], allDates: [date,...] } }
// where wfumcDates are preachings with non-null bulletin_id (i.e. used
// in a bulletin in this app). allDates is every preaching including
// historical imports without a bulletin link.
async function queryPreachingsBySermonIds(sermonIds) {
  if (!sermonIds || sermonIds.length === 0) return {};
  const { data, error } = await withTimeout(
    supabase
      .from('preachings')
      .select('sermon_id, bulletin_id, preached_at')
      .in('sermon_id', sermonIds)
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('queryPreachingsBySermonIds:', error.message);
    return {};
  }
  const out = {};
  for (const p of data ?? []) {
    if (!out[p.sermon_id]) out[p.sermon_id] = { wfumcDates: [], allDates: [] };
    if (p.preached_at) out[p.sermon_id].allDates.push(p.preached_at);
    if (p.bulletin_id && p.preached_at)
      out[p.sermon_id].wfumcDates.push(p.preached_at);
  }
  // Sort each list descending so [0] is most recent
  for (const id of Object.keys(out)) {
    out[id].wfumcDates.sort().reverse();
    out[id].allDates.sort().reverse();
  }
  return out;
}

// Resources by scripture: same coarse filter approach.
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

// Resources by theme overlap — exact array overlap on themes[].
async function queryResourcesByTheme(themeTerms) {
  if (!themeTerms || themeTerms.length === 0) return [];

  const cleanTerms = themeTerms
    .map((t) => t?.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  if (cleanTerms.length === 0) return [];

  const { data, error } = await withTimeout(
    supabase
      .from('resources')
      .select('id, title, content, resource_type, themes, scripture_refs, tone')
      .overlaps('themes', cleanTerms)
      .limit(100)
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('queryResourcesByTheme:', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({ resource: r, tier: 'theme_match' }));
}

function themeTermsFromSelections(selectedThemes) {
  const terms = new Set();
  for (const t of selectedThemes ?? []) {
    if (t.title) {
      terms.add(t.title.toLowerCase());
      for (const w of t.title.toLowerCase().split(/\s+/)) {
        if (w.length > 3) terms.add(w);
      }
    }
  }
  return [...terms];
}

// Main entry. Returns:
//   {
//     wfumcSermons: [{ sermon, tier, wfumcDates, allDates }],
//     otherSermons: [{ sermon, tier, wfumcDates, allDates }],
//     resourcesByText: [{resource, tier}],
//     resourcesByTheme: [{resource, tier}],
//     targetRefs, themeTerms,
//   }
//
// `pastorUserId` is no longer used for bucketing — kept in the signature
// for future panels that want to highlight pastor-owned items.
export async function loadIntelligence({
  scriptureReference,
  themes,
  // eslint-disable-next-line no-unused-vars
  pastorUserId,
}) {
  const targetRefs = parseRefs(scriptureReference);
  const themeTerms = themeTermsFromSelections(themes);

  const [matchedSermons, resourcesByText, resourcesByTheme] = await Promise.all(
    [
      targetRefs.length > 0 ? querySermonsByRef(targetRefs) : Promise.resolve([]),
      targetRefs.length > 0
        ? queryResourcesByRef(targetRefs)
        : Promise.resolve([]),
      themeTerms.length > 0
        ? queryResourcesByTheme(themeTerms)
        : Promise.resolve([]),
    ]
  );

  // Pull preachings for the matched sermons (one round-trip).
  const sermonIds = matchedSermons.map((m) => m.sermon.id);
  const preachings = await queryPreachingsBySermonIds(sermonIds);

  // Bucket sermons by WFUMC preaching presence
  const wfumcSermons = [];
  const otherSermons = [];
  for (const m of matchedSermons) {
    const p = preachings[m.sermon.id] || { wfumcDates: [], allDates: [] };
    const enriched = { ...m, wfumcDates: p.wfumcDates, allDates: p.allDates };
    if (p.wfumcDates.length > 0) {
      wfumcSermons.push(enriched);
    } else {
      otherSermons.push(enriched);
    }
  }

  // De-dupe resources between text and theme matches.
  const textIds = new Set(resourcesByText.map((r) => r.resource.id));
  const themesDedup = resourcesByTheme.filter(
    (r) => !textIds.has(r.resource.id)
  );

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

// Resolve the pastor's user_id (cached). Kept for potential future use
// even though current bucketing no longer needs it.
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
