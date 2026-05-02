// Helpers for ad-hoc, non-Sunday special services.
//
// Two flavors of special service (workflow_kind on the row):
//   * 'planning'    — full workflow. Plays nicely with worship_plans /
//                     planning_options / planning_votes — same machinery
//                     as a Sunday. Use for Ash Wednesday, Maundy
//                     Thursday, Christmas Eve, etc.
//   * 'lightweight' — just a calendar record (date, title, time, location,
//                     scripture, notes). Use for funerals, weddings,
//                     memorials, prayer services. No voting, no theme.
//
// The Forecast view interleaves these with Sundays by date.

import { supabase, withTimeout } from './supabase';

// Suggested service_kind values for the picker. UI uses these labels
// but stores whatever string is selected.
export const SERVICE_KIND_OPTIONS = [
  // Planning-workflow specials
  { value: 'ash_wednesday', label: 'Ash Wednesday', defaultWorkflow: 'planning' },
  { value: 'maundy_thursday', label: 'Maundy Thursday', defaultWorkflow: 'planning' },
  { value: 'good_friday', label: 'Good Friday', defaultWorkflow: 'planning' },
  { value: 'easter_vigil', label: 'Easter Vigil', defaultWorkflow: 'planning' },
  { value: 'christmas_eve', label: 'Christmas Eve', defaultWorkflow: 'planning' },
  { value: 'christmas_day', label: 'Christmas Day', defaultWorkflow: 'planning' },
  { value: 'watchnight', label: 'Watchnight / New Year\'s Eve', defaultWorkflow: 'planning' },
  { value: 'all_saints', label: 'All Saints', defaultWorkflow: 'planning' },
  { value: 'baptism', label: 'Baptism Service', defaultWorkflow: 'planning' },
  { value: 'community_service', label: 'Community / Joint Service', defaultWorkflow: 'planning' },
  // Lightweight-workflow defaults
  { value: 'funeral', label: 'Funeral', defaultWorkflow: 'lightweight' },
  { value: 'wedding', label: 'Wedding', defaultWorkflow: 'lightweight' },
  { value: 'memorial', label: 'Memorial Service', defaultWorkflow: 'lightweight' },
  { value: 'prayer_service', label: 'Prayer Service', defaultWorkflow: 'lightweight' },
  { value: 'other', label: 'Other', defaultWorkflow: 'lightweight' },
];

export const SERVICE_KIND_LABELS = Object.fromEntries(
  SERVICE_KIND_OPTIONS.map((o) => [o.value, o.label])
);

// Pull every special service whose date is in [fromDate, toDate].
export async function loadSpecialServicesInRange(fromDate, toDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('special_services')
      .select('*')
      .gte('service_date', fromDate)
      .lte('service_date', toDate)
      .order('service_date', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

// Convenience: load every special service from `fromDate` forward (no
// upper bound). Useful when the forecast horizon is a count, not a date.
export async function loadSpecialServicesFrom(fromDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('special_services')
      .select('*')
      .gte('service_date', fromDate)
      .order('service_date', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createSpecialService(fields, createdBy) {
  const payload = {
    service_date: fields.service_date,
    workflow_kind: fields.workflow_kind || 'lightweight',
    service_kind: fields.service_kind || 'other',
    title: fields.title?.trim(),
    time_of_day: fields.time_of_day?.trim() || null,
    location: fields.location?.trim() || null,
    notes: fields.notes?.trim() || null,
    created_by: createdBy ?? null,
  };
  if (!payload.service_date) throw new Error('Service date is required.');
  if (!payload.title) throw new Error('Title is required.');

  const { data, error } = await withTimeout(
    supabase
      .from('special_services')
      .insert(payload)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateSpecialService(id, fields) {
  const payload = {};
  for (const k of [
    'workflow_kind',
    'service_kind',
    'title',
    'time_of_day',
    'location',
    'notes',
  ]) {
    if (k in fields) {
      const v = typeof fields[k] === 'string' ? fields[k].trim() : fields[k];
      payload[k] = v === '' ? null : v;
    }
  }
  if ('service_date' in fields) payload.service_date = fields.service_date;

  const { data, error } = await withTimeout(
    supabase
      .from('special_services')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteSpecialService(id) {
  const { error } = await withTimeout(
    supabase.from('special_services').delete().eq('id', id)
  );
  if (error) throw error;
}

// Friendly date format used in the inline forecast card.
export function fmtServiceDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
