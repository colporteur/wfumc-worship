// Worship Planning → Bulletin sync.
//
// Mirrors the bulletin app's syncBulletinFromWorshipPlan helper but
// adds a "create the bulletin first if it doesn't exist yet" path so
// the Worship app can push a worship_plan's scripture/theme/sermon-topic
// to its corresponding bulletin in one click — even when the bulletin
// hasn't been created yet.
//
// What syncs (matches the bulletin-side helper exactly):
//   * worship_plan.scripture_reference  → scripture liturgy_item.scripture_reference
//   * worship_plan.theme                → sermon.theme (lazy-creates sermon row if needed)
//   * worship_plan.sermon_topic         → sermon.title (only if title is blank, or overwrite=true)

import { supabase, withTimeout } from './supabase';

// Find the existing bulletin for a service_date, if any.
async function findBulletinByDate(serviceDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('bulletins')
      .select('id, service_date, status')
      .eq('service_date', serviceDate)
      .maybeSingle()
  );
  if (error) throw error;
  return data ?? null;
}

// Create a new draft bulletin for the given service_date. The bulletin's
// liturgy_items aren't seeded here — the bulletin app's "copy previous
// liturgy" flow handles that on its end. We just create the row so the
// pastor can click the resulting link and find it in the bulletin app's
// list.
async function createDraftBulletin(serviceDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('bulletins')
      .insert({ service_date: serviceDate, status: 'draft' })
      .select('id, service_date, status')
      .single()
  );
  if (error) throw error;
  return data;
}

// Apply a worship_plan's data to the bulletin's scripture liturgy_item
// and sermon row. Mirrors the bulletin app's helper. Returns a list of
// human-readable change descriptions.
async function applyPlanToBulletin(plan, bulletinId, { overwrite, userId }) {
  const changes = [];

  // ---- Scripture: update the bulletin's scripture liturgy_item ----
  if (plan.scripture_reference) {
    const { data: items, error: itemsErr } = await withTimeout(
      supabase
        .from('liturgy_items')
        .select('id, scripture_reference, position')
        .eq('bulletin_id', bulletinId)
        .eq('item_type', 'scripture')
        .order('position', { ascending: true })
    );
    if (itemsErr) throw itemsErr;

    if (items && items.length > 0) {
      const target = items[0];
      const shouldUpdate = overwrite || !target.scripture_reference?.trim();
      if (shouldUpdate && target.scripture_reference !== plan.scripture_reference) {
        const { error: updErr } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update({ scripture_reference: plan.scripture_reference })
            .eq('id', target.id)
        );
        if (updErr) throw updErr;
        changes.push(`Scripture → ${plan.scripture_reference}`);
      }
    }
    // No scripture liturgy_item yet — pastor decides where it goes.
  }

  // ---- Sermon: lazy-create if needed; set theme + title ----
  if (plan.theme || plan.sermon_topic || plan.scripture_reference) {
    const { data: sermonItems, error: sErr } = await withTimeout(
      supabase
        .from('liturgy_items')
        .select('id, sermon_id')
        .eq('bulletin_id', bulletinId)
        .eq('item_type', 'sermon')
        .order('position', { ascending: true })
    );
    if (sErr) throw sErr;

    if (sermonItems && sermonItems.length > 0) {
      const sermonItem = sermonItems[0];
      let sermonId = sermonItem.sermon_id;

      if (!sermonId) {
        const { data: newSermon, error: insErr } = await withTimeout(
          supabase
            .from('sermons')
            .insert({
              title: plan.sermon_topic || null,
              theme: plan.theme || null,
              scripture_reference: plan.scripture_reference || null,
              preached_at: plan.service_date,
              owner_user_id: userId,
            })
            .select()
            .single()
        );
        if (insErr) throw insErr;
        sermonId = newSermon.id;
        const { error: linkErr } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update({ sermon_id: sermonId })
            .eq('id', sermonItem.id)
        );
        if (linkErr) throw linkErr;
        if (plan.sermon_topic) changes.push(`Sermon title → ${plan.sermon_topic}`);
        if (plan.theme) changes.push(`Sermon theme → ${plan.theme}`);
        if (plan.scripture_reference)
          changes.push(`Sermon scripture → ${plan.scripture_reference}`);
      } else {
        const { data: existing, error: exErr } = await withTimeout(
          supabase
            .from('sermons')
            .select('title, theme, scripture_reference')
            .eq('id', sermonId)
            .single()
        );
        if (exErr) throw exErr;
        const updates = {};
        if (
          plan.theme &&
          (overwrite || !existing.theme?.trim()) &&
          existing.theme !== plan.theme
        ) {
          updates.theme = plan.theme;
          changes.push(`Sermon theme → ${plan.theme}`);
        }
        if (
          plan.sermon_topic &&
          (overwrite || !existing.title?.trim()) &&
          existing.title !== plan.sermon_topic
        ) {
          updates.title = plan.sermon_topic;
          changes.push(`Sermon title → ${plan.sermon_topic}`);
        }
        if (
          plan.scripture_reference &&
          (overwrite || !existing.scripture_reference?.trim()) &&
          existing.scripture_reference !== plan.scripture_reference
        ) {
          updates.scripture_reference = plan.scripture_reference;
          changes.push(`Sermon scripture → ${plan.scripture_reference}`);
        }
        if (Object.keys(updates).length > 0) {
          const { error: updErr } = await withTimeout(
            supabase.from('sermons').update(updates).eq('id', sermonId)
          );
          if (updErr) throw updErr;
        }
      }
    }
  }

  return changes;
}

// Public entry: ensure a bulletin exists for the worship_plan's
// service_date, then sync the plan's data into it.
//
// Returns:
//   { bulletin: <row>, created: bool, changes: string[] }
//
// `userId` is used for sermons.owner_user_id when lazy-creating
// the sermon row.
export async function syncWorshipPlanToBulletin(plan, { userId } = {}) {
  if (!plan?.service_date) throw new Error('Worship plan has no service_date.');

  let bulletin = await findBulletinByDate(plan.service_date);
  let created = false;
  if (!bulletin) {
    bulletin = await createDraftBulletin(plan.service_date);
    created = true;
  }

  const changes = await applyPlanToBulletin(plan, bulletin.id, {
    overwrite: true, // explicit sync — pastor wants the plan to win
    userId,
  });

  return { bulletin, created, changes };
}

// Lightweight check used by the WeekCard button to decide whether a
// bulletin already exists for this date (so the button label can read
// "Sync to bulletin" vs. "Create + sync to bulletin").
export async function bulletinExistsForDate(serviceDate) {
  if (!serviceDate) return false;
  const { count, error } = await withTimeout(
    supabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .eq('service_date', serviceDate)
  );
  if (error) return false;
  return (count ?? 0) > 0;
}
