// Helpers for the worship_elements library and per-week placement.
//
// Two element kinds:
//   * 'liturgy' — text block (call to worship, prayer, responsive
//                 reading, benediction, etc.). Body is the actual text.
//   * 'hymn'    — hymn pick. Body is optional notes; hymnal + hymn_number
//                 carry the lookup info.
//
// Tagging is multi-valued: seasons[], tags[], scripture_refs[]. The
// library page filters on these. Phase 3 will surface relevant elements
// in the pastor intelligence panel based on the selected text + season.

import { supabase, withTimeout } from './supabase';

export const ELEMENT_KIND_LABELS = {
  liturgy: 'Liturgy',
  hymn: 'Hymn',
};

export const LITURGY_SUBTYPES = [
  { value: 'call_to_worship', label: 'Call to Worship' },
  { value: 'opening_prayer', label: 'Opening Prayer' },
  { value: 'pastoral_prayer', label: 'Pastoral Prayer' },
  { value: 'confession', label: 'Confession' },
  { value: 'assurance', label: 'Assurance / Pardon' },
  { value: 'responsive_reading', label: 'Responsive Reading' },
  { value: 'offering_prayer', label: 'Offering Prayer' },
  { value: 'communion', label: 'Communion Liturgy' },
  { value: 'benediction', label: 'Benediction' },
  { value: 'other', label: 'Other' },
];

export const HYMN_PLACEMENTS = [
  { value: 'opening', label: 'Opening Hymn' },
  { value: 'sermon_response', label: 'Sermon Response' },
  { value: 'closing', label: 'Closing Hymn' },
  { value: 'communion', label: 'Communion Hymn' },
  { value: 'offering', label: 'Offering Hymn' },
];

export const SUBTYPE_LABELS = Object.fromEntries(
  [...LITURGY_SUBTYPES, ...HYMN_PLACEMENTS].map((s) => [s.value, s.label])
);

// Pull every element. Phase 2 fits in memory comfortably (< a few hundred);
// pagination can come later if the library grows.
export async function loadAllElements() {
  const { data, error } = await withTimeout(
    supabase
      .from('worship_elements')
      .select('*')
      .order('updated_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

// Pull every week_elements row in a date range, joined to its element.
export async function loadWeekElementsInRange(fromDate, toDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('week_elements')
      .select('*, element:worship_elements(*)')
      .gte('service_date', fromDate)
      .lte('service_date', toDate)
      .order('position', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createElement(fields, createdBy) {
  if (!fields.title?.trim()) throw new Error('Title is required.');
  if (!['liturgy', 'hymn'].includes(fields.element_kind)) {
    throw new Error("element_kind must be 'liturgy' or 'hymn'.");
  }
  const payload = {
    element_kind: fields.element_kind,
    subtype: fields.subtype?.trim() || null,
    title: fields.title.trim(),
    body: fields.body?.trim() || null,
    hymnal: fields.element_kind === 'hymn' ? fields.hymnal?.trim() || null : null,
    hymn_number:
      fields.element_kind === 'hymn'
        ? fields.hymn_number?.toString().trim() || null
        : null,
    seasons: cleanArray(fields.seasons),
    tags: cleanArray(fields.tags),
    scripture_refs: cleanArray(fields.scripture_refs),
    created_by: createdBy ?? null,
  };
  const { data, error } = await withTimeout(
    supabase.from('worship_elements').insert(payload).select().single()
  );
  if (error) throw error;
  return data;
}

export async function updateElement(id, fields) {
  const payload = {};
  for (const k of ['element_kind', 'subtype', 'title', 'body', 'hymnal', 'hymn_number']) {
    if (k in fields) {
      const v = typeof fields[k] === 'string' ? fields[k].trim() : fields[k];
      payload[k] = v === '' ? null : v;
    }
  }
  for (const k of ['seasons', 'tags', 'scripture_refs']) {
    if (k in fields) payload[k] = cleanArray(fields[k]);
  }
  const { data, error } = await withTimeout(
    supabase
      .from('worship_elements')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteElement(id) {
  const { error } = await withTimeout(
    supabase.from('worship_elements').delete().eq('id', id)
  );
  if (error) throw error;
}

// Drop a saved element onto a service date. Position is appended.
export async function attachElementToWeek(serviceDate, elementId, addedBy) {
  // Compute next position for this date.
  const { data: existing, error: lookupErr } = await withTimeout(
    supabase
      .from('week_elements')
      .select('position')
      .eq('service_date', serviceDate)
      .order('position', { ascending: false })
      .limit(1)
  );
  if (lookupErr) throw lookupErr;
  const nextPos = existing && existing.length > 0 ? (existing[0].position ?? 0) + 1 : 0;

  const { data, error } = await withTimeout(
    supabase
      .from('week_elements')
      .insert({
        service_date: serviceDate,
        element_id: elementId,
        position: nextPos,
        added_by: addedBy ?? null,
      })
      .select('*, element:worship_elements(*)')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function detachElementFromWeek(weekElementId) {
  const { error } = await withTimeout(
    supabase.from('week_elements').delete().eq('id', weekElementId)
  );
  if (error) throw error;
}

export async function updateWeekElementOverride(weekElementId, overrides) {
  const payload = {};
  if ('override_title' in overrides)
    payload.override_title = overrides.override_title?.trim() || null;
  if ('override_body' in overrides)
    payload.override_body = overrides.override_body?.trim() || null;
  if ('position' in overrides) payload.position = overrides.position;
  const { data, error } = await withTimeout(
    supabase
      .from('week_elements')
      .update(payload)
      .eq('id', weekElementId)
      .select('*, element:worship_elements(*)')
      .single()
  );
  if (error) throw error;
  return data;
}

// ---------- helpers ----------

function cleanArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((s) => (typeof s === 'string' ? s.trim() : s))
      .filter((s) => s !== null && s !== undefined && s !== '');
  }
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
