import { Link } from 'react-router-dom';
import { canDecide, canVote, canSeePastorOnlyPanels } from '../lib/permissions';
import {
  loadPlanningStateOnly,
  seedRclOptions,
  upsertWorshipPlan,
  toggleVote,
  addManualOption,
  READING_LABELS,
  deriveStatus,
} from '../lib/planning';
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
      const matched = (fresh.optionsByDate[week.service_date] ?? []).find(
        (o) =>
          o.reading_kind === kind &&
          o.reference.toLowerCase() === reference.toLowerCase()
      );
      if (!matched) {
        throw new Error(
          `Couldn't find the seeded option for ${kind} ${reference}.`
        );
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
        </div>
      )}

      {/* RCL readings — always show as a reference */}
      <div className="mt-3 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          {options.length > 0 ? 'Voting options' : 'RCL readings'}
        </p>
        {options.length === 0 ? (
          <ul className="space-y-1">
            {Object.entries(week.readings || {}).map(([kind, ref]) => (
              <li
                key={kind}
                className="flex items-center justify-between gap-2 py-1"
              >
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 w-12 shrink-0">
                    {READING_LABELS[kind] || kind}
                  </span>
                  <span className="text-sm text-umc-900 truncate">{ref}</span>
                </div>
                {decide && status !== 'selected' && (
                  <button
                    type="button"
                    onClick={() => pickRclDirect(kind, ref)}
                    disabled={busy}
                    className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 whitespace-nowrap"
                  >
                    Pick this
                  </button>
                )}
              </li>
            ))}
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
        />
      )}
    </li>
  );
}
