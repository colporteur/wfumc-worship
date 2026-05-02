// Element suggestion queue (Phase 4 preview).
//
// Anyone with worship-app access can suggest a worship element ("let's
// sing X this Sunday", "could we try a candle-lighting moment?"). The
// pastor reviews the queue and either accepts (optionally saving the
// suggestion as a reusable worship_element) or declines.

import { supabase, withTimeout } from './supabase';

export const SUGGESTION_KIND_LABELS = {
  hymn: 'Hymn',
  liturgy: 'Liturgy',
  special_music: 'Special Music',
  other: 'Other',
};

export const SUGGESTION_STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  archived: 'Archived',
};

export async function loadSuggestions({ status = null } = {}) {
  let q = supabase
    .from('element_suggestions')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data ?? [];
}

export async function createSuggestion(fields, suggestedBy) {
  if (!fields.title?.trim()) throw new Error('Title is required.');
  if (!['hymn', 'liturgy', 'special_music', 'other'].includes(fields.suggestion_kind)) {
    throw new Error('Invalid suggestion kind.');
  }
  const payload = {
    service_date: fields.service_date || null,
    suggestion_kind: fields.suggestion_kind,
    title: fields.title.trim(),
    body: fields.body?.trim() || null,
    hymnal: fields.hymnal?.trim() || null,
    hymn_number: fields.hymn_number?.toString().trim() || null,
    suggested_by: suggestedBy ?? null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('element_suggestions')
      .insert(payload)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function reviewSuggestion(id, { status, reviewedBy, notes, acceptedElementId }) {
  if (!['accepted', 'declined', 'archived', 'pending'].includes(status)) {
    throw new Error('Invalid suggestion status.');
  }
  const payload = {
    status,
    reviewed_by: reviewedBy ?? null,
    reviewed_at: status === 'pending' ? null : new Date().toISOString(),
    review_notes: notes?.trim() || null,
  };
  if (acceptedElementId !== undefined) {
    payload.accepted_element_id = acceptedElementId;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('element_suggestions')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteSuggestion(id) {
  const { error } = await withTimeout(
    supabase.from('element_suggestions').delete().eq('id', id)
  );
  if (error) throw error;
}
