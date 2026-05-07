import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { canDecide, canVote, canSeePastorOnlyPanels } from '../lib/permissions';
import {
  syncWorshipPlanToBulletin,
  bulletinExistsForDate,
} from '../lib/bulletinSync';
import {
  loadPlanningStateOnly,
  seedRclOptions,
  upsertWorshipPlan,
  toggleVote,
  addManualOption,
  addRclPartOption,
  splitOption,
  splitCompoundReading,
  isCompoundReading,
  setUpcomingSermon,
  setSermonFromScratch,
  clearSermonPlan,
  READING_LABELS,
  deriveStatus,
} from '../lib/planning';
import { sermonArchiveUrl } from '../lib/intelligence';
import IntelligencePanel from './IntelligencePanel.jsx';

// Renders one Sunday (or RCL-listed special service) in the forecast.
// Extracted from Forecast.jsx so the page itself stays focused on
// orchestration. Same workflow as Phase 1, with two Phase-2 additions:
//
//   * Grouping badge — shows which season / custom grouping the week
//     belongs to, plus the chosen theme if one is selected.
//   * Linked-in elements teaser — count of worship_elements attached
//     to this date, with a link into the Library page.

const STATUS_BADGE = {
  undecided: { label: 'No plan yet', cls: 'bg-gray-200 text-gray-700' },
  options: { label: 'Options seeded', cls: 'bg-blue-100 text-blue-800' },
  voting: { label: 'Voting open', cls: 'bg-amber-100 text-amber-800' },
  selected: { label: 'Selected', cls: 'bg-green-100 text-green-800' },
};

function fmtServiceDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function WeekCard({
  week,
  state,
  groupingState,
  weekElementsByDate,
  // Map of sermon_id → small sermon projection, populated by Forecast
  // for any worship_plans that have a selected_sermon_id.
  sermonsById = {},
  userId,
  role,
  busyDate,
  setBusyDate,
  setError,
  reload,
}) {
  const decide = canDecide(role);
  const voteEligible = canVote(role);
  const plan = state.plansByDate[week.service_date];
  const options = state.optionsByDate[week.service_date] ?? [];
  const status = deriveStatus(week.service_date, state);
  const badge = STATUS_BADGE[status];
  const busy = busyDate === week.service_date;

  const selectedOption = plan?.selected_text_option_id
    ? options.find((o) => o.id === plan.selected_text_option_id)
    : null;

  // Phase 2: which groupings does this week belong to + their themes
  const dateGroupings = groupingState?.groupingsByDate?.[week.service_date] ?? [];
  const selectedThemes = dateGroupings
    .map((g) => {
      if (!g.selected_theme_option_id) return null;
      const themes = groupingState?.themesByGrouping?.[g.id] ?? [];
      const t = themes.find((x) => x.id === g.selected_theme_option_id);
      if (!t) return null;
      return { grouping: g, theme: t };
    })
    .filter(Boolean);

  // Phase 2: count of attached worship_elements on this date
  const attachedElements = weekElementsByDate?.[week.service_date] ?? [];

  // ----- Pastor / office_admin actions -----

  const pickText = async (option) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await upsertWorshipPlan(week.service_date, {
        scripture_reference: option.reference,
        selected_text_option_id: option.id,
        text_source: 'rcl',
        lectionary_year: week.lectionary_year,
        lectionary_designation: week.designation,
        liturgical_season: week.liturgical_season,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  const pickRclDirect = async (kind, reference) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await seedRclOptions(week.service_date);
      const fresh = await loadPlanningStateOnly([week.service_date], userId);
      let matched = (fresh.optionsByDate[week.service_date] ?? []).find(
        (o) =>
          o.reading_kind === kind &&
          o.reference.toLowerCase() === reference.toLowerCase()
      );
      // No match means the pastor picked just one part of a compound
      // reading (e.g., "Acts 2:1-21" out of "Acts 2:1-21 or Numbers 11:24-30").
      // Insert the partial pick as its own RCL option so it gets a real id.
      if (!matched) {
        matched = await addRclPartOption(week.service_date, kind, reference);
      }
      await upsertWorshipPlan(week.service_date, {
        scripture_reference: reference,
        selected_text_option_id: matched.id,
        text_source: 'rcl',
        lectionary_year: week.lectionary_year,
        lectionary_designation: week.designation,
        liturgical_season: week.liturgical_season,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  // After options are seeded for voting, pastor can split a compound
  // option into two separate vote-able options. This deletes the
  // compound row and inserts two new ones (same kind, source='rcl').
  // Any votes on the original compound are lost (cascade delete).
  const handleSplit = async (option) => {
    const parts = splitCompoundReading(option.reference);
    if (parts.length < 2) return;
    if (
      !window.confirm(
        `Split this option into ${parts.length} separate options?\n\n` +
          parts.map((p, i) => `${i + 1}. ${p}`).join('\n') +
          '\n\nAny existing votes on the combined option will be cleared.'
      )
    ) {
      return;
    }
    setBusyDate(week.service_date);
    setError(null);
    try {
      await splitOption(option);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  const openVote = async () => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await seedRclOptions(week.service_date);
      await upsertWorshipPlan(week.service_date, {
        lectionary_year: week.lectionary_year,
        lectionary_designation: week.designation,
        liturgical_season: week.liturgical_season,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  const addOffLectionary = async () => {
    const reference = window.prompt(
      `Off-lectionary text for ${week.designation}:\n` +
        `e.g., "Mark 12:28-34" or "Genesis 22:1-14"`
    );
    if (!reference?.trim()) return;
    setBusyDate(week.service_date);
    setError(null);
    try {
      const created = await addManualOption(week.service_date, reference);
      await upsertWorshipPlan(week.service_date, {
        scripture_reference: reference.trim(),
        selected_text_option_id: created.id,
        text_source: 'off_lectionary',
        lectionary_year: week.lectionary_year,
        lectionary_designation: week.designation,
        liturgical_season: week.liturgical_season,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  const reopen = async () => {
    if (
      !window.confirm(
        `Re-open ${week.designation}? Clears the selection so the team can vote again.`
      )
    ) {
      return;
    }
    setBusyDate(week.service_date);
    setError(null);
    try {
      await upsertWorshipPlan(week.service_date, {
        scripture_reference: null,
        selected_text_option_id: null,
        text_source: null,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  const handleVoteToggle = async (option) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await toggleVote(option.id, userId, state.myVotedOptions.has(option.id));
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  // Pastor-only sermon-plan handlers — write to worship_plans.
  const handlePickSermon = async (sermonId) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await setUpcomingSermon(week.service_date, sermonId);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };
  const handleWriteFromScratch = async () => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await setSermonFromScratch(week.service_date);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };
  const handleClearSermonPlan = async () => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await clearSermonPlan(week.service_date);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyDate(null);
    }
  };

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-lg text-umc-900">
              {week.designation}
            </h2>
            <span
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtServiceDate(week.service_date)} · Year{' '}
            {week.lectionary_year}
            {week.liturgical_season && ` · ${week.liturgical_season} season`}
          </p>
        </div>
        {decide && status !== 'selected' && (
          <div className="flex gap-2 flex-wrap shrink-0">
            {options.length === 0 && (
              <button
                type="button"
                onClick={openVote}
                disabled={busy}
                className="btn-secondary text-sm disabled:opacity-50"
                title="Seed the four RCL readings as voting options"
              >
                {busy ? 'Working…' : 'Open vote'}
              </button>
            )}
            <button
              type="button"
              onClick={addOffLectionary}
              disabled={busy}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              Off-lectionary
            </button>
          </div>
        )}
        {decide && status === 'selected' && (
          <button
            type="button"
            onClick={reopen}
            disabled={busy}
            className="btn-secondary text-sm disabled:opacity-50 shrink-0"
          >
            Re-open
          </button>
        )}
      </div>

      {/* Phase 2: grouping + theme badges */}
      {dateGroupings.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {dateGroupings.map((g) => {
            const winner = selectedThemes.find((s) => s.grouping.id === g.id);
            return (
              <Link
                key={g.id}
                to="/themes"
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-umc-50 text-umc-900 border border-umc-200 hover:bg-umc-100"
                title="Open Themes"
              >
                <span className="font-medium">{g.name}</span>
                {winner && (
                  <span className="text-umc-700">
                    · {winner.theme.title}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Selected text — pinned at top when chosen */}
      {status === 'selected' && (
        <div className="mt-3 p-3 rounded bg-green-50 border border-green-200">
          <p className="text-xs uppercase tracking-wide text-green-800 mb-1">
            Selected text
          </p>
          <p className="font-serif text-base text-umc-900">
            {plan?.scripture_reference}
            {selectedOption?.reading_kind &&
              selectedOption.reading_kind !== 'other' && (
                <span className="ml-2 text-xs text-gray-500">
                  ({READING_LABELS[selectedOption.reading_kind]})
                </span>
              )}
            {plan?.text_source === 'off_lectionary' && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700">
                off-lectionary
              </span>
            )}
          </p>
          {/* Pastor-only: push this plan to the matching bulletin. */}
          {canSeePastorOnlyPanels(role) && <BulletinSyncButton plan={plan} />}
        </div>
      )}

      {/* Upcoming sermon — pastor-only. Shows once a text is selected
          and the pastor has indicated either a base sermon or that
          they'll write from scratch. */}
      {canSeePastorOnlyPanels(role) && status === 'selected' && (
        <UpcomingSermonPin
          plan={plan}
          sermon={
            plan?.selected_sermon_id ? sermonsById[plan.selected_sermon_id] : null
          }
          onClear={handleClearSermonPlan}
          busy={busy}
        />
      )}

      {/* RCL readings — always show as a reference */}
      <div className="mt-3 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          {options.length > 0 ? 'Voting options' : 'RCL readings'}
        </p>
        {options.length === 0 ? (
          <ul className="space-y-1">
            {Object.entries(week.readings || {}).map(([kind, ref]) => {
              const parts = splitCompoundReading(ref);
              const compound = parts.length > 1;
              return (
                <li key={kind} className="py-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500 w-12 shrink-0">
                        {READING_LABELS[kind] || kind}
                      </span>
                      <span className="text-sm text-umc-900 truncate">{ref}</span>
                    </div>
                    {decide && status !== 'selected' && !compound && (
                      <button
                        type="button"
                        onClick={() => pickRclDirect(kind, ref)}
                        disabled={busy}
                        className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 whitespace-nowrap"
                      >
                        Pick this
                      </button>
                    )}
                  </div>
                  {compound && decide && status !== 'selected' && (
                    // Compound reading — let pastor pick one part instead of
                    // committing to the whole "A or B" string.
                    <ul className="mt-1 ml-14 space-y-0.5">
                      {parts.map((p) => (
                        <li
                          key={p}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-xs text-gray-700 truncate">
                            ↳ {p}
                          </span>
                          <button
                            type="button"
                            onClick={() => pickRclDirect(kind, p)}
                            disabled={busy}
                            className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 whitespace-nowrap"
                            title={`Pick just "${p}" as the chosen text`}
                          >
                            Pick this
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="space-y-1.5">
            {options.map((o) => {
              const votes = state.votesByOption[o.id] ?? [];
              const myVote = state.myVotedOptions.has(o.id);
              const isSelected = plan?.selected_text_option_id === o.id;
              return (
                <li
                  key={o.id}
                  className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded ${
                    isSelected ? 'bg-green-50' : ''
                  }`}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 w-12 shrink-0">
                      {READING_LABELS[o.reading_kind] || o.reading_kind}
                    </span>
                    <span className="text-sm text-umc-900 truncate">
                      {o.reference}
                    </span>
                    {o.source === 'manual' && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">
                        manual
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {voteEligible && status !== 'selected' && (
                      <button
                        type="button"
                        onClick={() => handleVoteToggle(o)}
                        disabled={busy}
                        className={`text-xs px-2 py-1 rounded border disabled:opacity-50 transition-colors ${
                          myVote
                            ? 'bg-umc-700 text-white border-umc-700'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-umc-700'
                        }`}
                        title={myVote ? 'Remove your vote' : 'Add your vote'}
                      >
                        {/* eslint-disable-next-line jsx-a11y/accessible-emoji */}
                        👍 {votes.length}
                      </button>
                    )}
                    {!voteEligible && (
                      <span className="text-xs text-gray-500">
                        👍 {votes.length}
                      </span>
                    )}
                    {decide && status !== 'selected' && isCompoundReading(o.reference) && (
                      <button
                        type="button"
                        onClick={() => handleSplit(o)}
                        disabled={busy}
                        className="text-xs text-amber-700 hover:text-amber-900 underline disabled:opacity-50 whitespace-nowrap"
                        title="Split this 'A or B' option into two separate vote-able options"
                      >
                        Split
                      </button>
                    )}
                    {decide && status !== 'selected' && (
                      <button
                        type="button"
                        onClick={() => pickText(o)}
                        disabled={busy}
                        className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 whitespace-nowrap"
                      >
                        Pick
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Phase 2: linked worship elements teaser */}
      {attachedElements.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">
            Worship elements ({attachedElements.length})
          </p>
          <ul className="space-y-1">
            {attachedElements.slice(0, 4).map((we) => (
              <li key={we.id} className="text-sm text-gray-700">
                <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-2">
                  {we.element?.element_kind === 'hymn' ? 'Hymn' : 'Liturgy'}
                </span>
                {we.override_title || we.element?.title}
                {we.element?.element_kind === 'hymn' &&
                  we.element?.hymnal &&
                  we.element?.hymn_number && (
                    <span className="ml-1 text-xs text-gray-500">
                      ({we.element.hymnal} {we.element.hymn_number})
                    </span>
                  )}
              </li>
            ))}
            {attachedElements.length > 4 && (
              <li className="text-xs text-gray-500 italic">
                + {attachedElements.length - 4} more — open Library
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Phase 3: pastor-only intelligence panel */}
      {canSeePastorOnlyPanels(role) && (
        <IntelligencePanel
          scriptureReference={
            // If text is selected, look up matches for it.
            // Otherwise, fold all four RCL options into a multi-ref
            // string so pastor sees matches across the whole candidate
            // set (parser handles ; as separator).
            plan?.scripture_reference ||
            (week.readings
              ? Object.values(week.readings).filter(Boolean).join('; ')
              : null)
          }
          themes={selectedThemes.map((s) => s.theme)}
          textIsSelected={status === 'selected'}
          selectedSermonId={plan?.selected_sermon_id || null}
          fromScratch={Boolean(plan?.sermon_from_scratch)}
          onPickSermon={handlePickSermon}
          onPickFromScratch={handleWriteFromScratch}
          onClearSermonPlan={handleClearSermonPlan}
        />
      )}
    </li>
  );
}

// Pinned upcoming-sermon section — pastor-only. Shown when the text
// is selected AND the pastor has indicated either a base sermon
// (selected_sermon_id) or that they'll write from scratch.
function UpcomingSermonPin({ plan, sermon, onClear, busy }) {
  const hasSermon = Boolean(plan?.selected_sermon_id);
  const fromScratch = Boolean(plan?.sermon_from_scratch);
  if (!hasSermon && !fromScratch) return null;

  if (fromScratch) {
    return (
      <div className="mt-3 p-3 rounded bg-purple-50 border border-purple-200 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide text-purple-800 mb-0.5">
            Upcoming sermon
          </p>
          <p className="text-sm text-umc-900">
            ✎ Writing from scratch
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-xs text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    );
  }
  // hasSermon
  const archiveUrl = sermonArchiveUrl(plan.selected_sermon_id);
  return (
    <div className="mt-3 p-3 rounded bg-blue-50 border border-blue-200 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-blue-800 mb-0.5">
          Upcoming sermon — based on
        </p>
        <p className="text-sm text-umc-900">
          {archiveUrl ? (
            <a
              href={archiveUrl}
              target="_blank"
              rel="noreferrer"
              className="text-umc-700 hover:text-umc-900 underline"
            >
              {sermon?.title || '(loading…)'}
            </a>
          ) : (
            sermon?.title || '(loading…)'
          )}
          {sermon?.scripture_reference && (
            <span className="ml-2 text-xs text-gray-500">
              {sermon.scripture_reference}
            </span>
          )}
          {sermon?.hasManuscript && (
            <span className="ml-1 text-[10px]" title="Has manuscript on file">
              📄
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="text-xs text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
      >
        Clear
      </button>
    </div>
  );
}

// One-click sync from a worship_plan to its corresponding bulletin.
// Creates the bulletin if it doesn't exist yet. Surfaces success /
// error inline so the pastor never has to leave the WeekCard. Only
// shows when the plan has at least a scripture or theme to push.
function BulletinSyncButton({ plan }) {
  const { user } = useAuth();
  const [exists, setExists] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  useEffect(() => {
    let cancelled = false;
    if (!plan?.service_date) return undefined;
    bulletinExistsForDate(plan.service_date)
      .then((v) => {
        if (!cancelled) setExists(v);
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plan?.service_date]);

  const hasSomethingToSync =
    plan &&
    (plan.scripture_reference?.trim() ||
      plan.theme?.trim() ||
      plan.sermon_topic?.trim());

  if (!hasSomethingToSync) return null;

  const handleSync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = await syncWorshipPlanToBulletin(plan, { userId: user?.id });
      if (out.created && out.changes.length === 0) {
        setResult({
          ok: true,
          message:
            'Created the bulletin. Open the Bulletin app to add a scripture and sermon liturgy item, then sync again to push the data in.',
        });
      } else if (out.changes.length === 0) {
        setResult({
          ok: true,
          message: 'Bulletin is already up to date with this plan.',
        });
      } else {
        setResult({
          ok: true,
          message:
            (out.created ? 'Created bulletin and synced: ' : 'Synced: ') +
            out.changes.join('; '),
        });
      }
      setExists(true);
    } catch (e) {
      setResult({ ok: false, message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={handleSync}
        disabled={busy}
        className="px-2 py-1 rounded bg-white border border-umc-200 text-umc-700 hover:bg-umc-50 disabled:opacity-50"
        title={
          exists
            ? "Push this plan's scripture / theme / sermon-topic into the bulletin for this date."
            : "Create the bulletin for this date and push this plan's scripture / theme / sermon-topic into it."
        }
      >
        {busy
          ? 'Syncing…'
          : exists === false
            ? '📋 Create + sync to bulletin'
            : '📋 Sync to bulletin'}
      </button>
      {result && (
        <span
          className={
            result.ok
              ? 'text-green-700'
              : 'text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5'
          }
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
