// Worship admin items — the "third bucket" from the Daily Capture
// pipeline (alongside pastoral records and sermon resources). Church
// operations, scheduling, program planning, staff coordination — stuff
// that surfaces in a Plaud recording but doesn't belong on a
// parishioner's file or in the sermon resource library.
//
// Two tables (see supabase migration 0066):
//   worship_admin_items          — the item itself
//   worship_admin_item_weeks     — join to worship_plans (multi-attach)
//
// Everything here is owner-scoped by RLS; helpers pass owner_user_id
// on insert but reads rely on the policy.

import { supabase, withTimeout } from './supabase';

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

/**
 * List admin items with lightweight filtering. `status` is one of
 * 'open' | 'resolved' | 'dismissed' | 'all'. Newest first.
 */
export async function listAdminItems({ status = 'open', limit = 200 } = {}) {
  let q = supabase
    .from('worship_admin_items')
    .select(
      'id, description, body, notes, source_capture_id, source_segment_id, ' +
        'captured_at, suggested_sunday_hint, status, status_at, ' +
        'created_at, updated_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status && status !== 'all') {
    q = q.eq('status', status);
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data || [];
}

/**
 * Load the join rows for a set of admin items so the UI can render
 * per-item "attached to" chips. Returns a Map<adminItemId, [{plan_id,
 * service_date, designation, theme}]>.
 *
 * We join through worship_plans to get service_date. The `designation`
 * and `theme` columns are optional — worship_plans doesn't have a
 * `designation` column (that lives on rcl.json entries), so we surface
 * just service_date + theme here and let the UI decorate with anything
 * else it wants.
 */
export async function loadAttachmentsForItems(itemIds) {
  const map = new Map();
  if (!itemIds || itemIds.length === 0) return map;
  const { data, error } = await withTimeout(
    supabase
      .from('worship_admin_item_weeks')
      .select(
        'id, admin_item_id, worship_plan_id, worship_plans!inner(id, service_date, theme)'
      )
      .in('admin_item_id', itemIds)
  );
  if (error) throw error;
  for (const row of data || []) {
    if (!map.has(row.admin_item_id)) map.set(row.admin_item_id, []);
    map.get(row.admin_item_id).push({
      join_id: row.id,
      plan_id: row.worship_plan_id,
      service_date: row.worship_plans?.service_date || null,
      theme: row.worship_plans?.theme || null,
    });
  }
  // Sort each item's attachments by service_date ascending.
  for (const arr of map.values()) {
    arr.sort((a, b) =>
      (a.service_date || '').localeCompare(b.service_date || '')
    );
  }
  return map;
}

/**
 * For the WeekCard panel: fetch every admin item attached to any of the
 * given worship_plan_ids, grouped by plan_id. Only 'open' items are
 * returned by default so resolved/dismissed items don't clutter the
 * forecast (they're still visible on /admin-items).
 */
export async function loadItemsAttachedToPlans(planIds, { status = 'open' } = {}) {
  const empty = new Map();
  if (!planIds || planIds.length === 0) return empty;
  let q = supabase
    .from('worship_admin_item_weeks')
    .select(
      'id, admin_item_id, worship_plan_id, ' +
        'worship_admin_items!inner(' +
        'id, description, body, status, captured_at, source_capture_id' +
        ')'
    )
    .in('worship_plan_id', planIds);
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    const item = row.worship_admin_items;
    if (!item) continue;
    if (status !== 'all' && item.status !== status) continue;
    if (!map.has(row.worship_plan_id)) map.set(row.worship_plan_id, []);
    map.get(row.worship_plan_id).push({
      join_id: row.id,
      admin_item_id: row.admin_item_id,
      description: item.description,
      body: item.body,
      status: item.status,
      captured_at: item.captured_at,
      source_capture_id: item.source_capture_id,
    });
  }
  return map;
}

// ---------------------------------------------------------------------
// Writes — items
// ---------------------------------------------------------------------

/**
 * Manual create — from the Worship Planning app's "+ New admin item"
 * form. Description optional; body required (that's what the pastor
 * will read on the review card).
 */
export async function createManualAdminItem({
  ownerUserId,
  description,
  body,
  capturedAt,
  notes,
}) {
  if (!ownerUserId) throw new Error('Missing user.');
  const trimmedBody = (body || '').trim();
  if (!trimmedBody) throw new Error('Body is required.');
  const payload = {
    owner_user_id: ownerUserId,
    description: (description || '').trim() || null,
    body: trimmedBody,
    captured_at: capturedAt || null,
    notes: (notes || '').trim() || null,
    // Manual entry — no source_* fields set.
  };
  const { data, error } = await withTimeout(
    supabase
      .from('worship_admin_items')
      .insert(payload)
      .select('id')
      .single()
  );
  if (error) throw error;
  return data.id;
}

/**
 * Patch — anything the pastor edits on the detail row (description,
 * body, notes). Pass an object with only the fields you want to change.
 */
export async function updateAdminItem(id, patch) {
  const payload = {};
  if (patch.description !== undefined) {
    const t = (patch.description || '').trim();
    payload.description = t || null;
  }
  if (patch.body !== undefined) {
    const t = (patch.body || '').trim();
    if (!t) throw new Error('Body cannot be empty.');
    payload.body = t;
  }
  if (patch.notes !== undefined) {
    const t = (patch.notes || '').trim();
    payload.notes = t || null;
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await withTimeout(
    supabase.from('worship_admin_items').update(payload).eq('id', id)
  );
  if (error) throw error;
}

/** Set status — flip to 'resolved' or 'dismissed' (or back to 'open'). */
export async function setAdminItemStatus(id, status) {
  if (!['open', 'resolved', 'dismissed'].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const { error } = await withTimeout(
    supabase
      .from('worship_admin_items')
      .update({ status, status_at: new Date().toISOString() })
      .eq('id', id)
  );
  if (error) throw error;
}

/** Hard delete — used when the pastor confirms they want it gone. */
export async function deleteAdminItem(id) {
  const { error } = await withTimeout(
    supabase.from('worship_admin_items').delete().eq('id', id)
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Writes — attachments to worship_plans
// ---------------------------------------------------------------------

/**
 * Attach an admin item to one or more worship_plans. The unique
 * constraint on (admin_item_id, worship_plan_id) means re-attaching the
 * same pair is a no-op — we swallow duplicate-key errors so the caller
 * can idempotently "make sure these attachments exist".
 */
export async function attachToPlans({ ownerUserId, adminItemId, planIds }) {
  if (!ownerUserId) throw new Error('Missing user.');
  if (!adminItemId) throw new Error('Missing admin item.');
  const ids = Array.from(new Set((planIds || []).filter(Boolean)));
  if (ids.length === 0) return;
  const rows = ids.map((planId) => ({
    owner_user_id: ownerUserId,
    admin_item_id: adminItemId,
    worship_plan_id: planId,
  }));
  const { error } = await withTimeout(
    supabase.from('worship_admin_item_weeks').insert(rows)
  );
  if (error) {
    // 23505 = unique_violation — one or more pairs already existed.
    // We treat that as success (idempotent attach).
    if (error.code !== '23505') throw error;
  }
}

/** Detach by join-row id. Used from both the admin-item detail and the
 *  WeekCard panel. */
export async function detachAttachment(joinRowId) {
  const { error } = await withTimeout(
    supabase.from('worship_admin_item_weeks').delete().eq('id', joinRowId)
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// worship_plans lookup for the picker
// ---------------------------------------------------------------------

/**
 * Return upcoming worship_plans rows (today onward) for the attach
 * picker. worship_plans is staff-shared so anyone can read them; we
 * just filter to service_date >= today and limit to a reasonable
 * horizon.
 */
export async function listUpcomingPlansForPicker({ horizonWeeks = 16 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + horizonWeeks * 7);
  const horizonIso = horizon.toISOString().slice(0, 10);
  const { data, error } = await withTimeout(
    supabase
      .from('worship_plans')
      .select('id, service_date, theme, scripture_reference')
      .gte('service_date', today)
      .lte('service_date', horizonIso)
      .order('service_date', { ascending: true })
  );
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------
// Sunday-hint matcher — Phase 3
// ---------------------------------------------------------------------

// Common liturgical / seasonal aliases the hint might reference. Keys
// are lowercased needles; values are keyword sets we look for on a
// worship_plans row's theme/reference/service_date. Coarse-grained on
// purpose — the goal is "highlight this Sunday because Claude thinks
// this admin item belongs there," not perfect classification.
const LITURGICAL_ALIASES = {
  'palm sunday': ['palm'],
  'good friday': ['good friday'],
  'easter': ['easter', 'resurrection'],
  'pentecost': ['pentecost'],
  'ash wednesday': ['ash wednesday'],
  'christ the king': ['christ the king', 'reign of christ'],
  'all saints': ['all saints'],
  'thanksgiving': ['thanksgiving'],
  'reformation': ['reformation'],
  'trinity': ['trinity'],
  'transfiguration': ['transfiguration'],
  'baptism of the lord': ['baptism of the lord', 'baptism of jesus'],
  'christmas eve': ['christmas eve'],
  'christmas': ['christmas'],
  'advent': ['advent'],
  'lent': ['lent'],
  'epiphany': ['epiphany'],
};

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Given a free-text hint like "Palm Sunday" or "December 15" or
 * "VBS closing (mid-July)", return the subset of plans that seem to
 * match. Match kinds:
 *   - liturgical: hint mentions Palm Sunday / Advent / Easter / etc.
 *     → match plans whose theme matches that alias set
 *   - date: hint mentions a Month + day (or year), or an ISO date
 *     → match plans within ±7 days of that date
 *   - keyword: hint mentions a distinctive word (VBS, potluck)
 *     → match plans whose theme contains that word
 *
 * Returns { matchIds: Set<planId>, reason: string } so the picker can
 * both filter and explain WHY those plans were highlighted. Empty Set
 * when no hint or no matches; caller renders without special treatment.
 */
export function matchPlansToHint(hint, plans) {
  const empty = { matchIds: new Set(), reason: '' };
  const h = (hint || '').trim();
  if (!h || !Array.isArray(plans) || plans.length === 0) return empty;
  const lower = h.toLowerCase();
  const matchIds = new Set();

  // 1) Liturgical alias hits — themes are what worship_plans actually
  //    hold at planning time.
  for (const [needle, aliases] of Object.entries(LITURGICAL_ALIASES)) {
    if (lower.includes(needle)) {
      for (const p of plans) {
        const theme = (p.theme || '').toLowerCase();
        if (aliases.some((a) => theme.includes(a))) {
          matchIds.add(p.id);
        }
      }
    }
  }

  // 2) Date parse — try to pluck month+day (with optional year) or a
  //    bare ISO date out of the hint.
  const dateHits = extractDatesFromHint(h);
  for (const target of dateHits) {
    for (const p of plans) {
      if (!p.service_date) continue;
      if (daysBetween(p.service_date, target) <= 7) {
        matchIds.add(p.id);
      }
    }
  }

  // 3) Keyword fallback — for hints that don't hit the alias list or
  //    parse as a date. Take words 4+ chars long and look for them in
  //    theme / scripture_reference. Skip generic stop-words.
  if (matchIds.size === 0) {
    const stop = new Set([
      'sunday', 'church', 'service', 'worship', 'week', 'weekend',
      'morning', 'evening', 'about', 'after', 'before', 'during',
      'next', 'this', 'that', 'from', 'with',
    ]);
    const words = lower
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !stop.has(w));
    for (const p of plans) {
      const hay = `${p.theme || ''} ${p.scripture_reference || ''}`.toLowerCase();
      if (words.some((w) => hay.includes(w))) {
        matchIds.add(p.id);
      }
    }
  }

  if (matchIds.size === 0) return empty;
  return {
    matchIds,
    reason:
      matchIds.size === 1
        ? '1 upcoming Sunday matches this hint'
        : `${matchIds.size} upcoming Sundays match this hint`,
  };
}

// Extract candidate ISO dates from a free-text hint. Handles:
//   "December 15" (assumes nearest future occurrence)
//   "Dec 15, 2026"
//   "2026-07-14"
//   "7/14" or "7/14/26" (US-style, month first)
function extractDatesFromHint(hint) {
  const out = [];
  const now = new Date();

  // ISO YYYY-MM-DD
  for (const m of hint.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push(`${m[1]}-${m[2]}-${m[3]}`);
  }

  // "Month D[,] [YYYY]" or "D Month [YYYY]"
  const monthRe =
    /\b(?:(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})|(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december))(?:\s*,?\s*(\d{4}))?\b/gi;
  for (const m of hint.matchAll(monthRe)) {
    const monthWord = (m[1] || m[4] || '').toLowerCase();
    const day = parseInt(m[2] || m[3] || '', 10);
    const yr = m[5] ? parseInt(m[5], 10) : null;
    const month = MONTHS[monthWord];
    if (month === undefined || !day) continue;
    out.push(nearestFutureIso(month, day, yr, now));
  }

  // "M/D" or "M/D/YY"
  for (const m of hint.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    let yr = null;
    if (m[3]) {
      yr = parseInt(m[3], 10);
      if (yr < 100) yr += 2000;
    }
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      out.push(nearestFutureIso(month, day, yr, now));
    }
  }

  return out;
}

function nearestFutureIso(month, day, yr, now) {
  // If a year is provided, honor it. Otherwise pick this year if the
  // date is in the future, else next year.
  const year =
    yr ??
    (new Date(now.getFullYear(), month, day) >= startOfToday(now)
      ? now.getFullYear()
      : now.getFullYear() + 1);
  const iso =
    `${year.toString().padStart(4, '0')}-` +
    `${(month + 1).toString().padStart(2, '0')}-` +
    `${day.toString().padStart(2, '0')}`;
  return iso;
}

function startOfToday(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

/**
 * Convenience: also fold in the plan_id → future-attachments count so
 * the picker can nudge the pastor "this Sunday already has 3 items."
 */
export async function countItemsPerPlan(planIds) {
  const map = new Map();
  if (!planIds || planIds.length === 0) return map;
  const { data, error } = await withTimeout(
    supabase
      .from('worship_admin_item_weeks')
      .select('worship_plan_id')
      .in('worship_plan_id', planIds)
  );
  if (error) throw error;
  for (const r of data || []) {
    map.set(r.worship_plan_id, (map.get(r.worship_plan_id) || 0) + 1);
  }
  return map;
}
