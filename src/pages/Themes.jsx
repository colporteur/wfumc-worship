import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { canDecide, canVote } from '../lib/permissions';
import { upcomingSundays } from '../lib/planning';
import { loadSpecialServicesFrom } from '../lib/specialServices';
import {
  loadGroupingState,
  ensureSeasonGrouping,
  createGrouping,
  deleteGrouping,
  addDateToGrouping,
  removeDateFromGrouping,
  suggestTheme,
  deleteTheme,
  toggleThemeVote,
  selectThemeForGrouping,
  deriveThemeStatus,
  SEASON_LABELS,
} from '../lib/groupings';

// Themes page — Phase 2.
//
// Two grouping flavors share this page:
//   * Season groupings — auto-created on demand for a (season, year)
//     pair. Members are every upcoming Sunday in that season (we offer
//     a "fill from forecast" button to add them in bulk).
//   * Custom groupings — pastor-named, free-form list of dates. Use
//     for sermon arcs (e.g., "Stewardship 2026", "Lenten preaching").
//
// Both get the same suggest / vote / select theme workflow.
export default function Themes() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({
    groupings: [],
    datesByGrouping: {},
    groupingsByDate: {},
    themesByGrouping: {},
    votesByTheme: {},
    myVotedThemes: new Set(),
  });
  const [allDates, setAllDates] = useState([]); // upcoming Sundays + specials
  const [showNewCustom, setShowNewCustom] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const reload = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [g, sundays, specials] = await Promise.all([
        loadGroupingState(user.id),
        Promise.resolve(upcomingSundays(today, 24)),
        loadSpecialServicesFrom(today),
      ]);
      setState(g);
      const merged = [
        ...sundays.map((s) => ({
          date: s.service_date,
          label: `${s.designation} (${s.liturgical_season})`,
          season: s.liturgical_season,
          year: s.lectionary_year,
        })),
        ...(specials || []).map((s) => ({
          date: s.service_date,
          label: s.title,
          season: 'special',
          year: null,
        })),
      ];
      // De-dupe / sort by date
      merged.sort((a, b) => a.date.localeCompare(b.date));
      setAllDates(merged);
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

  // Distinct seasons in the visible window — for the "Start a season
  // theme" picker. Memo must run before any conditional return.
  const visibleSeasons = useMemo(() => {
    const seen = new Map();
    for (const d of allDates) {
      if (!d.season || d.season === 'special') continue;
      const key = `${d.season}|${d.year || ''}`;
      if (!seen.has(key)) seen.set(key, { season: d.season, year: d.year });
    }
    return [...seen.values()];
  }, [allDates]);

  if (!profile) return <LoadingSpinner label="Loading…" />;
  if (loading) return <LoadingSpinner label="Loading themes…" />;

  const decide = canDecide(profile.role);
  const vote = canVote(profile.role);

  const handleStartSeason = async (season, year) => {
    setBusy(true);
    setError(null);
    try {
      await ensureSeasonGrouping(season, year, user.id);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-umc-900">Themes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {decide
            ? 'Group weeks (by season or custom arc) and run a suggest / vote / select cycle on themes.'
            : vote
              ? 'Suggest themes and cast thumbs-up votes on any open grouping.'
              : 'Read-only view of upcoming themes.'}
        </p>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Quick-start panel for seasons in the visible window that don't
          yet have a grouping. */}
      {decide && (
        <SeasonStartPanel
          visibleSeasons={visibleSeasons}
          existingGroupings={state.groupings}
          onStart={handleStartSeason}
          busy={busy}
        />
      )}

      {/* New custom grouping */}
      {decide && (
        <div className="card">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-serif text-base text-umc-900">
                Custom grouping
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Group any set of dates for a sermon arc, series, or campaign.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewCustom((v) => !v)}
              className="btn-secondary text-sm"
            >
              {showNewCustom ? 'Cancel' : '+ New custom grouping'}
            </button>
          </div>
          {showNewCustom && (
            <NewCustomGroupingForm
              onCreated={async () => {
                setShowNewCustom(false);
                await reload();
              }}
              userId={user.id}
              setError={setError}
            />
          )}
        </div>
      )}

      {/* Existing groupings */}
      {state.groupings.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          No groupings yet. {decide ? 'Start a season theme above, or create a custom grouping.' : 'Ask the pastor or office admin to start one.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {state.groupings.map((g) => (
            <GroupingCard
              key={g.id}
              grouping={g}
              state={state}
              allDates={allDates}
              userId={user.id}
              role={profile.role}
              setError={setError}
              reload={reload}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Quick-start: seasons in the visible window ----------

function SeasonStartPanel({ visibleSeasons, existingGroupings, onStart, busy }) {
  const have = new Set(
    existingGroupings
      .filter((g) => g.grouping_kind === 'season' && g.season)
      .map((g) => `${g.season}|${g.name.match(/\d{4}/)?.[0] || ''}`)
  );
  // We don't actually have a year in the season label — just compare on season name.
  const newSeasons = visibleSeasons.filter((s) => {
    // Simple guard: if any existing grouping with this season exists, hide.
    return !existingGroupings.some(
      (g) => g.grouping_kind === 'season' && g.season === s.season
    );
  });
  if (newSeasons.length === 0) return null;
  return (
    <div className="card bg-umc-50 border-umc-200">
      <p className="text-xs uppercase tracking-wide text-umc-700 mb-2">
        Start a season theme
      </p>
      <div className="flex flex-wrap gap-2">
        {newSeasons.map((s) => (
          <button
            key={`${s.season}|${s.year || ''}`}
            type="button"
            onClick={() => onStart(s.season, s.year || new Date().getFullYear())}
            disabled={busy}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            + {SEASON_LABELS[s.season] || s.season}
            {s.year ? ` ${s.year}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- New custom grouping form ----------

function NewCustomGroupingForm({ onCreated, userId, setError }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGrouping({
        name,
        description,
        groupingKind: 'custom',
        season: null,
        createdBy: userId,
      });
      setName('');
      setDescription('');
      await onCreated?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div>
        <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Stewardship 2026"
          className="input"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
          Description (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="input"
          placeholder="Three-week series on generosity in the gospels."
        />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary text-sm" disabled={busy}>
          {busy ? 'Creating…' : 'Create grouping'}
        </button>
      </div>
    </form>
  );
}

// ---------- One grouping card ----------

const THEME_BADGE = {
  undecided: { label: 'No themes yet', cls: 'bg-gray-200 text-gray-700' },
  suggesting: { label: 'Suggestions open', cls: 'bg-blue-100 text-blue-800' },
  voting: { label: 'Voting open', cls: 'bg-amber-100 text-amber-800' },
  selected: { label: 'Theme selected', cls: 'bg-green-100 text-green-800' },
};

function GroupingCard({ grouping, state, allDates, userId, role, setError, reload }) {
  const decide = canDecide(role);
  const vote = canVote(role);
  const dates = state.datesByGrouping[grouping.id] || [];
  const themes = state.themesByGrouping[grouping.id] || [];
  const status = deriveThemeStatus(grouping, state);
  const badge = THEME_BADGE[status];
  const winner = grouping.selected_theme_option_id
    ? themes.find((t) => t.id === grouping.selected_theme_option_id)
    : null;
  const [busy, setBusy] = useState(false);
  const [showAddDate, setShowAddDate] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  const handleAddDate = async (date) => {
    setBusy(true);
    setError(null);
    try {
      await addDateToGrouping(grouping.id, date);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveDate = async (date) => {
    setBusy(true);
    setError(null);
    try {
      await removeDateFromGrouping(grouping.id, date);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGrouping = async () => {
    if (!window.confirm(`Delete grouping "${grouping.name}"? Themes and votes are cascade-deleted.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteGrouping(grouping.id);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleVoteToggle = async (themeId) => {
    setBusy(true);
    setError(null);
    try {
      await toggleThemeVote(themeId, userId, state.myVotedThemes.has(themeId));
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSelect = async (themeId) => {
    setBusy(true);
    setError(null);
    try {
      await selectThemeForGrouping(grouping.id, themeId);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!window.confirm('Re-open theme voting? Clears the selected theme.')) return;
    setBusy(true);
    setError(null);
    try {
      await selectThemeForGrouping(grouping.id, null);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTheme = async (themeId) => {
    if (!window.confirm('Delete this theme suggestion?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTheme(themeId);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Dates available to add (not already in this grouping).
  const dateSet = new Set(dates);
  const availableDates = allDates.filter((d) => !dateSet.has(d.date));

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-lg text-umc-900">{grouping.name}</h2>
            <span
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}
            >
              {badge.label}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {grouping.grouping_kind}
            </span>
          </div>
          {grouping.description && (
            <p className="text-sm text-gray-600 mt-1">{grouping.description}</p>
          )}
        </div>
        {decide && (
          <div className="flex gap-2 shrink-0">
            {status === 'selected' ? (
              <button
                type="button"
                onClick={handleReopen}
                disabled={busy}
                className="btn-secondary text-sm disabled:opacity-50"
              >
                Re-open
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleDeleteGrouping}
              disabled={busy}
              className="text-xs text-red-600 hover:text-red-700 underline disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Selected theme */}
      {winner && (
        <div className="mt-3 p-3 rounded bg-green-50 border border-green-200">
          <p className="text-xs uppercase tracking-wide text-green-800 mb-1">
            Selected theme
          </p>
          <p className="font-serif text-base text-umc-900">{winner.title}</p>
          {winner.description && (
            <p className="text-sm text-gray-700 mt-1">{winner.description}</p>
          )}
          {winner.scripture_anchor && (
            <p className="text-xs text-umc-700 mt-1">
              Anchor: {winner.scripture_anchor}
            </p>
          )}
        </div>
      )}

      {/* Dates */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">
            Dates ({dates.length})
          </p>
          {decide && (
            <button
              type="button"
              onClick={() => setShowAddDate((v) => !v)}
              className="text-xs text-umc-700 hover:text-umc-900 underline"
            >
              {showAddDate ? 'Done' : '+ Add date'}
            </button>
          )}
        </div>
        {dates.length === 0 ? (
          <p className="text-xs text-gray-500 italic mt-1">
            No dates assigned yet.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {dates.map((d) => {
              const meta = allDates.find((x) => x.date === d);
              return (
                <li
                  key={d}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700"
                >
                  <span>{d}</span>
                  {meta?.label && (
                    <span className="text-gray-500">· {meta.label}</span>
                  )}
                  {decide && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDate(d)}
                      disabled={busy}
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      title="Remove from grouping"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {showAddDate && availableDates.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Pick a date to add
            </p>
            <div className="flex flex-wrap gap-1.5">
              {availableDates.slice(0, 30).map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => handleAddDate(d.date)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded border bg-white border-gray-300 hover:border-umc-700 disabled:opacity-50"
                >
                  {d.date} {d.label && <span className="text-gray-500">· {d.label}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Theme options */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">
            Themes ({themes.length})
          </p>
          {(decide || vote) && status !== 'selected' && (
            <button
              type="button"
              onClick={() => setShowSuggest((v) => !v)}
              className="text-xs text-umc-700 hover:text-umc-900 underline"
            >
              {showSuggest ? 'Cancel' : '+ Suggest theme'}
            </button>
          )}
        </div>
        {themes.length === 0 ? (
          <p className="text-xs text-gray-500 italic mt-1">
            No themes proposed yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {themes.map((t) => {
              const votes = state.votesByTheme[t.id] || [];
              const myVote = state.myVotedThemes.has(t.id);
              const isSelected = grouping.selected_theme_option_id === t.id;
              return (
                <li
                  key={t.id}
                  className={`p-2 rounded ${isSelected ? 'bg-green-50' : 'bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-sm text-umc-900">
                        {t.title}
                      </p>
                      {t.description && (
                        <p className="text-xs text-gray-600 mt-0.5">{t.description}</p>
                      )}
                      {t.scripture_anchor && (
                        <p className="text-[11px] text-umc-700 mt-0.5">
                          Anchor: {t.scripture_anchor}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {vote && status !== 'selected' && (
                        <button
                          type="button"
                          onClick={() => handleVoteToggle(t.id)}
                          disabled={busy}
                          className={`text-xs px-2 py-1 rounded border disabled:opacity-50 transition-colors ${
                            myVote
                              ? 'bg-umc-700 text-white border-umc-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-umc-700'
                          }`}
                        >
                          👍 {votes.length}
                        </button>
                      )}
                      {!vote && (
                        <span className="text-xs text-gray-500">👍 {votes.length}</span>
                      )}
                      {decide && status !== 'selected' && (
                        <button
                          type="button"
                          onClick={() => handleSelect(t.id)}
                          disabled={busy}
                          className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
                        >
                          Select
                        </button>
                      )}
                      {decide && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTheme(t.id)}
                          disabled={busy}
                          className="text-xs text-red-600 hover:text-red-700 underline disabled:opacity-50"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {showSuggest && (
          <SuggestThemeForm
            groupingId={grouping.id}
            userId={userId}
            setError={setError}
            onSuggested={async () => {
              setShowSuggest(false);
              await reload();
            }}
          />
        )}
      </div>
    </li>
  );
}

function SuggestThemeForm({ groupingId, userId, onSuggested, setError }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scriptureAnchor, setScriptureAnchor] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await suggestTheme({
        groupingId,
        title,
        description,
        scriptureAnchor,
        createdBy: userId,
      });
      setTitle('');
      setDescription('');
      setScriptureAnchor('');
      await onSuggested?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-2 p-2 rounded border border-gray-200 bg-white space-y-2"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Theme title — e.g., Living Hope"
        required
        className="input"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Optional: 1-2 sentence pitch."
        className="input"
      />
      <input
        type="text"
        value={scriptureAnchor}
        onChange={(e) => setScriptureAnchor(e.target.value)}
        placeholder="Optional anchor scripture (e.g., 1 Peter 1:3-9)"
        className="input"
      />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary text-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Suggest theme'}
        </button>
      </div>
    </form>
  );
}
