import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  canDecide,
  canVote,
  ROLE_LABELS,
} from '../lib/permissions';
import {
  upcomingSundays,
  loadPlanningState,
  loadPlanningStateOnly,
  deriveStatus,
  seedRclOptions,
  upsertWorshipPlan,
  toggleVote,
  addManualOption,
  READING_LABELS,
} from '../lib/planning';

// Phase 1: 12-week forecast.
//
// Each upcoming Sunday is a card showing its RCL readings + workflow
// status. Pastor (and office_admin) see action buttons:
//   - Pick text  — selects a text right now (no vote)
//   - Open vote  — seeds the RCL options into planning_options so team
//                  members can thumbs-up
//   - Off-lectionary — write in any reference and select it
//
// Voting-eligible team members see thumbs-up buttons on each option
// once a vote is open, with a live tally.
export default function Forecast() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyDate, setBusyDate] = useState(null);
  const [state, setState] = useState({
    plansByDate: {},
    optionsByDate: {},
    votesByOption: {},
    myVotedOptions: new Set(),
  });

  const today = new Date().toISOString().slice(0, 10);
  const weeks = useMemo(() => upcomingSundays(today, 12), [today]);

  const reload = async () => {
    if (!user?.id || weeks.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadPlanningState(
        weeks.map((w) => w.service_date),
        user.id
      );
      setState(next);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!profile) return <LoadingSpinner label="Loading…" />;
  if (loading) return <LoadingSpinner label="Loading the next 12 weeks…" />;

  const decide = canDecide(profile.role);
  const vote = canVote(profile.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-umc-900">
          Worship planning · next 12 weeks
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {decide
            ? "Pick a text directly, open it for vote, or write in an off-lectionary text."
            : vote
              ? 'Cast thumbs-up votes on any week the pastor has opened for voting.'
              : 'Read-only view of the upcoming worship schedule.'}
        </p>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {weeks.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          No upcoming RCL data found. Add weeks to{' '}
          <code className="text-xs">src/data/rcl.json</code>.
        </p>
      ) : (
        <ul className="space-y-3">
          {weeks.map((w) => (
            <WeekCard
              key={w.service_date}
              week={w}
              state={state}
              userId={user.id}
              role={profile.role}
              busyDate={busyDate}
              setBusyDate={setBusyDate}
              setError={setError}
              reload={reload}
            />
          ))}
        </ul>
      )}

      {!decide && !vote && (
        <p className="text-xs text-gray-400 italic">
          Signed in as {profile.full_name}{' '}
          (<span>{ROLE_LABELS[profile.role] || profile.role}</span>) — read-only.
        </p>
      )}
    </div>
  );
}

function fmtServiceDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_BADGE = {
  undecided: { label: 'No plan yet', cls: 'bg-gray-200 text-gray-700' },
  options: { label: 'Options seeded', cls: 'bg-blue-100 text-blue-800' },
  voting: { label: 'Voting open', cls: 'bg-amber-100 text-amber-800' },
  selected: { label: 'Selected', cls: 'bg-green-100 text-green-800' },
};

function WeekCard({
  week,
  state,
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

  // Find the selected option, if any.
  const selectedOption = plan?.selected_text_option_id
    ? options.find((o) => o.id === plan.selected_text_option_id)
    : null;

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

  // "Pick this" on the inline RCL readings (when no options exist yet):
  // seed the four RCL options first so we have an option_id to point
  // selected_text_option_id at, then immediately select the chosen one.
  // This keeps the data model consistent (every selected text has a
  // matching planning_options row).
  const pickRclDirect = async (kind, reference) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await seedRclOptions(week.service_date);
      // Re-fetch to find the option we want to point at.
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
      // Also create the worship_plans row so we can track lectionary_year etc.
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

  // ----- Voter actions -----

  const handleVoteToggle = async (option) => {
    setBusyDate(week.service_date);
    setError(null);
    try {
      await toggleVote(
        option.id,
        userId,
        state.myVotedOptions.has(option.id)
      );
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
        <div>
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
            {week.liturgical_season &&
              ` · ${week.liturgical_season} season`}
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
          // No voting started yet — show RCL readings inline (and let
          // pastor "Pick text" directly on each).
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
                  <span className="text-sm text-umc-900 truncate">
                    {ref}
                  </span>
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
          // Options exist — show with vote buttons + tally.
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
    </li>
  );
}
