// Workflow helpers for the Worship Planning app.
//
// State per service_date is derived from the worship_plans row plus
// the planning_options + planning_votes for that date:
//
//   undecided  — no worship_plans row, OR row has no selected_text_option_id
//                AND no scripture_reference. No options have been opened
//                for voting (no planning_options rows yet).
//   options    — RCL options have been seeded (planning_options rows exist)
//                but nothing's selected yet AND no votes recorded.
//   voting     — same as 'options' but votes have been cast on at least
//                one option. (We don't have a separate 'open vote' flag —
//                opening the vote just means seeding the options and
//                letting people thumbs-up.)
//   selected   — worship_plans has either selected_text_option_id set
//                OR scripture_reference set (off-lectionary).

import { supabase, withTimeout } from './supabase';
import rclData from '../data/rcl.json';

// In-memory index by service_date (string YYYY-MM-DD → entry).
const RCL_BY_DATE = (() => {
  const m = new Map();
  for (const w of rclData.weeks ?? []) {
    m.set(w.service_date, w);
  }
  return m;
})();

export function rclForDate(serviceDate) {
  return RCL_BY_DATE.get(serviceDate) ?? null;
}

// Compute the next N upcoming Sundays (or special services) we have
// RCL data for, starting from `fromDate` (inclusive).
export function upcomingSundays(fromDate, count = 12) {
  const sorted = [...(rclData.weeks ?? [])].sort((a, b) =>
    a.service_date.localeCompare(b.service_date)
  );
  return sorted
    .filter((w) => w.service_date >= fromDate)
    .slice(0, count);
}

// Pull all worship_plans + planning_options + planning_votes for a
// list of service_dates in one shot. Returns:
//   {
//     plansByDate:    { date → row | null },
//     optionsByDate:  { date → option[] },
//     votesByOption:  { option_id → vote[] },
//     myVotedOptions: Set<option_id>     // current user's votes
//   }
export async function loadPlanningState(dates, userId) {
  if (!dates?.length) {
    return {
      plansByDate: {},
      optionsByDate: {},
      votesByOption: {},
      myVotedOptions: new Set(),
    };
  }
  const [plansRes, optsRes] = await Promise.all([
    withTimeout(
      supabase
        .from('worship_plans')
        .select('*')
        .in('service_date', dates)
    ),
    withTimeout(
      supabase
        .from('planning_options')
        .select('*')
        .in('service_date', dates)
    ),
  ]);
  if (plansRes.error) throw plansRes.error;
  if (optsRes.error) throw optsRes.error;

  const optionIds = (optsRes.data ?? []).map((o) => o.id);
  let votes = [];
  if (optionIds.length > 0) {
    const votesRes = await withTimeout(
      supabase
        .from('planning_votes')
        .select('id, option_id, user_id')
        .in('option_id', optionIds)
    );
    if (votesRes.error) throw votesRes.error;
    votes = votesRes.data ?? [];
  }

  const plansByDate = {};
  for (const d of dates) plansByDate[d] = null;
  for (const p of plansRes.data ?? []) plansByDate[p.service_date] = p;

  const optionsByDate = {};
  for (const d of dates) optionsByDate[d] = [];
  for (const o of optsRes.data ?? []) {
    if (!optionsByDate[o.service_date]) optionsByDate[o.service_date] = [];
    optionsByDate[o.service_date].push(o);
  }

  const votesByOption = {};
  for (const v of votes) {
    if (!votesByOption[v.option_id]) votesByOption[v.option_id] = [];
    votesByOption[v.option_id].push(v);
  }

  const myVotedOptions = new Set(
    votes.filter((v) => v.user_id === userId).map((v) => v.option_id)
  );

  return { plansByDate, optionsByDate, votesByOption, myVotedOptions };
}

// Given a service_date and the loaded state, derive the current status.
export function deriveStatus(serviceDate, state) {
  const plan = state.plansByDate[serviceDate];
  if (
    plan &&
    (plan.selected_text_option_id || plan.scripture_reference)
  ) {
    return 'selected';
  }
  const options = state.optionsByDate[serviceDate] ?? [];
  if (options.length === 0) return 'undecided';
  // Are there any votes? Check votesByOption for any of these option ids.
  const hasVotes = options.some(
    (o) => (state.votesByOption[o.id]?.length ?? 0) > 0
  );
  return hasVotes ? 'voting' : 'options';
}

// Seed planning_options for a service_date from the RCL data. Idempotent
// via the (service_date, lower(reference)) unique index — re-running
// won't duplicate.
export async function seedRclOptions(serviceDate) {
  const rcl = rclForDate(serviceDate);
  if (!rcl) {
    throw new Error(`No RCL data for ${serviceDate}.`);
  }
  const rows = [];
  const r = rcl.readings || {};
  if (r.ot) rows.push({ kind: 'ot', reference: r.ot });
  if (r.psalm) rows.push({ kind: 'psalm', reference: r.psalm });
  if (r.epistle) rows.push({ kind: 'epistle', reference: r.epistle });
  if (r.gospel) rows.push({ kind: 'gospel', reference: r.gospel });
  if (rows.length === 0) {
    throw new Error(`RCL entry for ${serviceDate} has no readings.`);
  }
  const { error } = await withTimeout(
    supabase
      .from('planning_options')
      .upsert(
        rows.map((row) => ({
          service_date: serviceDate,
          source: 'rcl',
          reading_kind: row.kind,
          reference: row.reference,
        })),
        {
          onConflict: 'service_date,reference',
          ignoreDuplicates: true,
        }
      )
  );
  if (error) {
    // Some Supabase versions don't accept the lowered onConflict —
    // fall back to per-row inserts that ignore duplicates.
    for (const row of rows) {
      const { error: insErr } = await withTimeout(
        supabase
          .from('planning_options')
          .insert({
            service_date: serviceDate,
            source: 'rcl',
            reading_kind: row.kind,
            reference: row.reference,
          })
      );
      // Swallow duplicate-key errors; rethrow others.
      if (
        insErr &&
        !String(insErr.message || '').toLowerCase().includes('duplicate')
      ) {
        throw insErr;
      }
    }
  }
}

// Upsert the worship_plans row for a date, setting only the provided
// fields. Caller passes the full set of metadata they want recorded.
export async function upsertWorshipPlan(serviceDate, fields) {
  const payload = { service_date: serviceDate, ...fields };
  // Upsert by service_date (unique).
  const { error } = await withTimeout(
    supabase
      .from('worship_plans')
      .upsert(payload, { onConflict: 'service_date' })
  );
  if (error) throw error;
}

// Toggle the current user's vote on an option.
export async function toggleVote(optionId, userId, currentlyVoted) {
  if (currentlyVoted) {
    const { error } = await withTimeout(
      supabase
        .from('planning_votes')
        .delete()
        .eq('option_id', optionId)
        .eq('user_id', userId)
    );
    if (error) throw error;
  } else {
    const { error } = await withTimeout(
      supabase
        .from('planning_votes')
        .insert({ option_id: optionId, user_id: userId })
    );
    if (error) throw error;
  }
}

// Add an off-lectionary candidate option. Returns the new row.
export async function addManualOption(serviceDate, reference, label) {
  const { data, error } = await withTimeout(
    supabase
      .from('planning_options')
      .insert({
        service_date: serviceDate,
        source: 'manual',
        reading_kind: 'other',
        reference: reference.trim(),
        label: label?.trim() || null,
      })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

// Convenience re-export so the forecast page can re-fetch state for a
// single date right after seeding (we need the new option ids).
export const loadPlanningStateOnly = loadPlanningState;

// Pretty labels for reading kinds (for UI badges).
export const READING_LABELS = {
  ot: 'OT',
  psalm: 'Psalm',
  epistle: 'Epistle',
  gospel: 'Gospel',
  other: 'Other',
};

// Compound-reading helpers.
//
// The lectionary often offers alternates separated by " or ", e.g.
//   "Acts 2:1-21 or Numbers 11:24-30"   (Pentecost OT)
//   "Romans 8:14-17 or Acts 2:1-21"     (Pentecost Epistle)
// These come into the app as a single reading string. The pastor may
// want to (a) pick just one part as the chosen text, or (b) split the
// option into two separate vote-able options after seeding.
//
// We split on a case-insensitive " or " surrounded by whitespace.
// Refuses to split if either side ends up trivially short (avoids
// false positives like "Mark 7:24-30 (or shorter: Mark 7:24-29)" —
// that one would still split, since there's no good way to tell, but
// the pastor can choose not to use the split affordance).
const COMPOUND_SPLIT_RE = /\s+or\s+/i;

export function splitCompoundReading(reference) {
  if (!reference || typeof reference !== 'string') return [reference].filter(Boolean);
  const parts = reference
    .split(COMPOUND_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p && p.length >= 3);
  if (parts.length < 2) return [reference];
  return parts;
}

export function isCompoundReading(reference) {
  return splitCompoundReading(reference).length > 1;
}

// Insert a partial RCL pick — used when pastor picks one half of a
// compound reading ("Acts 2:1-21" out of "Acts 2:1-21 or Numbers 11:24-30").
// The full compound is also seeded by the surrounding flow; this row
// captures the specific half the pastor chose. Returns the new row.
export async function addRclPartOption(serviceDate, readingKind, reference) {
  const { data, error } = await withTimeout(
    supabase
      .from('planning_options')
      .insert({
        service_date: serviceDate,
        source: 'rcl',
        reading_kind: readingKind,
        reference: reference.trim(),
      })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

// Replace one option with N split options (same kind, same source).
// Used when pastor clicks "Split" on a compound option that's already
// been seeded into planning_options. Deletes the original, then inserts
// the new ones.
export async function splitOption(option) {
  const parts = splitCompoundReading(option.reference);
  if (parts.length < 2) {
    throw new Error('This option is not a compound reading.');
  }
  const { error: delErr } = await withTimeout(
    supabase.from('planning_options').delete().eq('id', option.id)
  );
  if (delErr) throw delErr;
  const rows = parts.map((reference) => ({
    service_date: option.service_date,
    source: option.source,
    reading_kind: option.reading_kind,
    reference,
  }));
  const { error: insErr } = await withTimeout(
    supabase.from('planning_options').insert(rows)
  );
  if (insErr) throw insErr;
}

// ---------- Upcoming-sermon decisions ----------
//
// After the text is selected, the pastor decides whether to reuse an
// existing sermon (selected_sermon_id) or write from scratch
// (sermon_from_scratch = true). The two are mutually exclusive — these
// helpers always clear the other field when setting one.

// Pick an existing sermon as the "upcoming sermon" for this date.
// Clears the from-scratch flag.
export async function setUpcomingSermon(serviceDate, sermonId) {
  return upsertWorshipPlan(serviceDate, {
    selected_sermon_id: sermonId,
    sermon_from_scratch: false,
  });
}

// Mark this date as "writing from scratch". Clears any existing sermon link.
export async function setSermonFromScratch(serviceDate) {
  return upsertWorshipPlan(serviceDate, {
    selected_sermon_id: null,
    sermon_from_scratch: true,
  });
}

// Wipe the sermon decision — back to "undecided".
export async function clearSermonPlan(serviceDate) {
  return upsertWorshipPlan(serviceDate, {
    selected_sermon_id: null,
    sermon_from_scratch: false,
  });
}

// Derive the sermon-prep status for a worship_plan row. Used by the
// Forecast workload summary and WeekCard badges.
//   'reuse'      — pastor picked an existing sermon to base from
//   'from_scratch' — pastor committed to writing fresh
//   'undecided'  — neither (default)
export function deriveSermonPlan(plan) {
  if (plan?.selected_sermon_id) return 'reuse';
  if (plan?.sermon_from_scratch) return 'from_scratch';
  return 'undecided';
}

// Lookup helper — pull a small projection of a sermon by id, used by
// the WeekCard pinned section to show the picked sermon's title.
// Returns null if the sermon isn't readable (RLS).
export async function loadSermonsByIds(ids) {
  if (!ids || ids.length === 0) return {};
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return {};
  const { data, error } = await withTimeout(
    supabase
      .from('sermons')
      .select('id, title, scripture_reference, theme, manuscript_text, manuscript_url')
      .in('id', uniq)
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('loadSermonsByIds:', error.message);
    return {};
  }
  const out = {};
  for (const s of data ?? []) {
    out[s.id] = {
      ...s,
      hasManuscript: Boolean(s.manuscript_text || s.manuscript_url),
      // Drop the actual text from the in-memory cache.
      manuscript_text: undefined,
    };
  }
  return out;
}
