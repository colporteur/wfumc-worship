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
