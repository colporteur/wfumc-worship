import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { canDecide } from '../lib/permissions';
import { upcomingSundays } from '../lib/planning';
import { loadSpecialServicesFrom } from '../lib/specialServices';
import {
  loadAllElements,
  createElement,
  updateElement,
  deleteElement,
  attachElementToWeek,
  detachElementFromWeek,
  loadWeekElementsInRange,
  ELEMENT_KIND_LABELS,
  LITURGY_SUBTYPES,
  HYMN_PLACEMENTS,
  SUBTYPE_LABELS,
} from '../lib/elements';
import { SEASON_LABELS } from '../lib/groupings';

// Library — Phase 2.
//
// Reusable worship elements. Two kinds:
//   * Liturgy — saved text blocks (call to worship, prayers, etc.)
//   * Hymn    — hymnal + number, with optional notes
//
// Both can be tagged with seasons, free-form tags, and scripture refs.
// Filterable by kind / season / tag / search. Pastor can attach an
// element to any upcoming service date with one click.
export default function Library() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [elements, setElements] = useState([]);
  const [weekElements, setWeekElements] = useState([]);
  const [allDates, setAllDates] = useState([]);
  const [editing, setEditing] = useState(null); // element being edited or new {kind}
  const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'liturgy' | 'hymn'
  const [seasonFilter, setSeasonFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const reload = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const sundays = upcomingSundays(today, 12);
      const horizonEnd =
        sundays.length > 0 ? sundays[sundays.length - 1].service_date : today;
      const [els, wes, specials] = await Promise.all([
        loadAllElements(),
        loadWeekElementsInRange(today, horizonEnd),
        loadSpecialServicesFrom(today),
      ]);
      setElements(els);
      setWeekElements(wes);
      const merged = [
        ...sundays.map((s) => ({
          date: s.service_date,
          label: s.designation,
        })),
        ...(specials || [])
          .filter((s) => s.service_date <= horizonEnd)
          .map((s) => ({ date: s.service_date, label: s.title })),
      ];
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

  // Filter (memo must run before any conditional return)
  const filtered = useMemo(() => {
    return elements.filter((el) => {
      if (kindFilter !== 'all' && el.element_kind !== kindFilter) return false;
      if (seasonFilter !== 'all' && !(el.seasons || []).includes(seasonFilter))
        return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hay = [
          el.title,
          el.body,
          el.subtype,
          el.hymnal,
          el.hymn_number,
          ...(el.tags || []),
          ...(el.scripture_refs || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [elements, kindFilter, seasonFilter, searchTerm]);

  // Group week_elements by element_id so each card shows where it's used.
  const usageByElement = useMemo(() => {
    const m = {};
    for (const we of weekElements) {
      if (!m[we.element_id]) m[we.element_id] = [];
      m[we.element_id].push(we);
    }
    return m;
  }, [weekElements]);

  if (!profile) return <LoadingSpinner label="Loading…" />;
  if (loading) return <LoadingSpinner label="Loading library…" />;

  const decide = canDecide(profile.role);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">Worship element library</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Reusable liturgy and hymn picks. Tag by season / theme; drop into any upcoming service.
          </p>
        </div>
        {decide && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing({ element_kind: 'liturgy' })}
              className="btn-secondary text-sm"
            >
              + Liturgy
            </button>
            <button
              type="button"
              onClick={() => setEditing({ element_kind: 'hymn' })}
              className="btn-secondary text-sm"
            >
              + Hymn
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-3">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="input w-auto text-sm"
        >
          <option value="all">All kinds</option>
          <option value="liturgy">Liturgy</option>
          <option value="hymn">Hymn</option>
        </select>
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="input w-auto text-sm"
        >
          <option value="all">All seasons</option>
          {Object.entries(SEASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search title / body / tags…"
          className="input flex-1 min-w-[180px] text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          {elements.length === 0
            ? 'No elements yet. Create one with the buttons above.'
            : 'No elements match those filters.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((el) => (
            <ElementCard
              key={el.id}
              element={el}
              usage={usageByElement[el.id] || []}
              allDates={allDates}
              role={profile.role}
              userId={user.id}
              setEditing={setEditing}
              setError={setError}
              reload={reload}
            />
          ))}
        </ul>
      )}

      {editing && (
        <ElementEditModal
          element={editing}
          userId={user.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

// ---------- One element card ----------

function ElementCard({
  element,
  usage,
  allDates,
  role,
  userId,
  setEditing,
  setError,
  reload,
}) {
  const decide = canDecide(role);
  const [busy, setBusy] = useState(false);
  const [showAttach, setShowAttach] = useState(false);

  const handleAttach = async (date) => {
    setBusy(true);
    setError(null);
    try {
      await attachElementToWeek(date, element.id, userId);
      setShowAttach(false);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async (weekElementId) => {
    setBusy(true);
    setError(null);
    try {
      await detachElementFromWeek(weekElementId);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Delete "${element.title}"? This removes it from the library AND any week it's attached to (cascade).`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteElement(element.id);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const usedDates = new Set(usage.map((u) => u.service_date));
  const availableDates = allDates.filter((d) => !usedDates.has(d.date));

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-base text-umc-900">{element.title}</h2>
            <span className="px-2 py-0.5 text-[10px] uppercase tracking-wide rounded bg-umc-100 text-umc-800">
              {ELEMENT_KIND_LABELS[element.element_kind]}
            </span>
            {element.subtype && (
              <span className="text-[11px] text-gray-500">
                · {SUBTYPE_LABELS[element.subtype] || element.subtype}
              </span>
            )}
            {element.element_kind === 'hymn' && element.hymnal && element.hymn_number && (
              <span className="text-[11px] text-gray-500">
                · {element.hymnal} {element.hymn_number}
              </span>
            )}
          </div>
          {(element.seasons?.length > 0 ||
            element.tags?.length > 0 ||
            element.scripture_refs?.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(element.seasons || []).map((s) => (
                <span key={`s-${s}`} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800">
                  {SEASON_LABELS[s] || s}
                </span>
              ))}
              {(element.tags || []).map((t) => (
                <span key={`t-${t}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                  #{t}
                </span>
              ))}
              {(element.scripture_refs || []).map((r) => (
                <span key={`r-${r}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
        {decide && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(element)}
              disabled={busy}
              className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-red-600 hover:text-red-700 underline disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {element.body && (
        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">
          {element.body}
        </p>
      )}

      {/* Used on … */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">
            Used on ({usage.length})
          </p>
          {decide && (
            <button
              type="button"
              onClick={() => setShowAttach((v) => !v)}
              disabled={busy}
              className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
            >
              {showAttach ? 'Done' : '+ Attach to date'}
            </button>
          )}
        </div>
        {usage.length === 0 ? (
          <p className="text-xs text-gray-500 italic mt-1">Not yet attached to any week.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {usage.map((we) => {
              const meta = allDates.find((d) => d.date === we.service_date);
              return (
                <li
                  key={we.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700"
                >
                  <span>{we.service_date}</span>
                  {meta?.label && <span className="text-gray-500">· {meta.label}</span>}
                  {decide && (
                    <button
                      type="button"
                      onClick={() => handleDetach(we.id)}
                      disabled={busy}
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      title="Detach"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {showAttach && (
          <div className="mt-2 border-t pt-2">
            {availableDates.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                Already attached to every upcoming date.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableDates.slice(0, 30).map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => handleAttach(d.date)}
                    disabled={busy}
                    className="text-xs px-2 py-1 rounded border bg-white border-gray-300 hover:border-umc-700 disabled:opacity-50"
                  >
                    {d.date} {d.label && <span className="text-gray-500">· {d.label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------- Element edit modal ----------

function ElementEditModal({ element, userId, onClose, onSaved }) {
  const isEdit = Boolean(element.id);
  const [kind, setKind] = useState(element.element_kind || 'liturgy');
  const [subtype, setSubtype] = useState(element.subtype || '');
  const [title, setTitle] = useState(element.title || '');
  const [body, setBody] = useState(element.body || '');
  const [hymnal, setHymnal] = useState(element.hymnal || '');
  const [hymnNumber, setHymnNumber] = useState(element.hymn_number || '');
  const [seasonsCsv, setSeasonsCsv] = useState((element.seasons || []).join(', '));
  const [tagsCsv, setTagsCsv] = useState((element.tags || []).join(', '));
  const [scripturesCsv, setScripturesCsv] = useState(
    (element.scripture_refs || []).join(', ')
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const subtypeOptions = kind === 'liturgy' ? LITURGY_SUBTYPES : HYMN_PLACEMENTS;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        element_kind: kind,
        subtype: subtype || null,
        title,
        body,
        hymnal: kind === 'hymn' ? hymnal : null,
        hymn_number: kind === 'hymn' ? hymnNumber : null,
        seasons: seasonsCsv,
        tags: tagsCsv,
        scripture_refs: scripturesCsv,
      };
      if (isEdit) {
        await updateElement(element.id, payload);
      } else {
        await createElement(payload, userId);
      }
      await onSaved?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-lg sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-umc-900">
              {isEdit ? 'Edit element' : `New ${ELEMENT_KIND_LABELS[kind] || kind}`}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-sm"
            >
              Close
            </button>
          </div>

          {error && (
            <div className="rounded bg-red-50 border border-red-200 p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              Kind
            </label>
            <div className="flex gap-3">
              {['liturgy', 'hymn'].map((k) => (
                <label key={k} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setSubtype(''); // reset since options change
                    }}
                  />
                  {ELEMENT_KIND_LABELS[k]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              {kind === 'liturgy' ? 'Type' : 'Placement (optional)'}
            </label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="input"
            >
              <option value="">{kind === 'liturgy' ? 'Pick a type' : '(no specific placement)'}</option>
              {subtypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder={kind === 'hymn' ? 'Christ the Lord Is Risen Today' : 'Call to Worship for Easter'}
              className="input"
            />
          </div>

          {kind === 'hymn' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
                  Hymnal
                </label>
                <input
                  type="text"
                  value={hymnal}
                  onChange={(e) => setHymnal(e.target.value)}
                  placeholder="UMH"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
                  Number
                </label>
                <input
                  type="text"
                  value={hymnNumber}
                  onChange={(e) => setHymnNumber(e.target.value)}
                  placeholder="302"
                  className="input"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              {kind === 'liturgy' ? 'Body (the actual text)' : 'Notes (optional)'}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={kind === 'liturgy' ? 8 : 3}
              className="input font-serif"
              placeholder={
                kind === 'liturgy'
                  ? 'L: The Lord be with you.\nP: And also with you.\n…'
                  : 'Why this hymn fits, suggested key, accompaniment notes, etc.'
              }
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              Seasons (comma-separated)
            </label>
            <input
              type="text"
              value={seasonsCsv}
              onChange={(e) => setSeasonsCsv(e.target.value)}
              placeholder="advent, christmas"
              className="input"
            />
            <p className="text-[11px] text-gray-500 mt-0.5">
              Use: advent, christmas, epiphany, lent, easter, pentecost, ordinary, special
            </p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsCsv}
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="communion, confession, stewardship"
              className="input"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
              Scripture refs (comma-separated)
            </label>
            <input
              type="text"
              value={scripturesCsv}
              onChange={(e) => setScripturesCsv(e.target.value)}
              placeholder="John 14:1-6, Psalm 23"
              className="input"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-sm"
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary text-sm" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
