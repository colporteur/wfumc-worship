import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { canDecide } from '../lib/permissions';
import { upcomingSundays } from '../lib/planning';
import { loadSpecialServicesFrom } from '../lib/specialServices';
import {
  loadSuggestions,
  createSuggestion,
  reviewSuggestion,
  deleteSuggestion,
  SUGGESTION_KIND_LABELS,
  SUGGESTION_STATUS_LABELS,
} from '../lib/suggestions';

// Suggestions — Phase 4 preview.
//
// Anyone with worship-app access can suggest a worship element ("let's
// sing X", "could we try a candle moment?"). Pastor reviews and either
// accepts or declines. Suggestions are filterable by status (default:
// pending). When the pastor accepts, they can attach a saved element id
// to the suggestion as a record of what came of it. (Saving as an
// element directly is one click in the Library.)
export default function Suggestions() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [suggestions, setSuggestions] = useState([]);
  const [allDates, setAllDates] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const reload = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [list, sundays, specials] = await Promise.all([
        loadSuggestions({ status: statusFilter === 'all' ? null : statusFilter }),
        Promise.resolve(upcomingSundays(today, 12)),
        loadSpecialServicesFrom(today),
      ]);
      setSuggestions(list);
      const horizonEnd =
        sundays.length > 0 ? sundays[sundays.length - 1].service_date : today;
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
  }, [user?.id, statusFilter]);

  if (!profile) return <LoadingSpinner label="Loading…" />;
  if (loading) return <LoadingSpinner label="Loading suggestions…" />;

  const decide = canDecide(profile.role);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">Suggestions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {decide
              ? 'Worship element suggestions from the team. Accept or decline; accepted suggestions can be saved into the library.'
              : 'Suggest hymns, liturgies, or special music. The pastor reviews each one.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="btn-secondary text-sm shrink-0"
        >
          {showNew ? 'Cancel' : '+ New suggestion'}
        </button>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {showNew && (
        <NewSuggestionForm
          allDates={allDates}
          userId={user.id}
          onCreated={async () => {
            setShowNew(false);
            await reload();
          }}
          setError={setError}
        />
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['pending', 'accepted', 'declined', 'archived', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              statusFilter === s
                ? 'bg-umc-700 text-white border-umc-700'
                : 'bg-white text-gray-700 border-gray-300 hover:border-umc-700'
            }`}
          >
            {s === 'all' ? 'All' : SUGGESTION_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {suggestions.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          No {statusFilter === 'all' ? '' : statusFilter} suggestions.
        </p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              role={profile.role}
              userId={user.id}
              allDates={allDates}
              setError={setError}
              reload={reload}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- New suggestion form ----------

function NewSuggestionForm({ allDates, userId, onCreated, setError }) {
  const [kind, setKind] = useState('hymn');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hymnal, setHymnal] = useState('');
  const [hymnNumber, setHymnNumber] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createSuggestion(
        {
          suggestion_kind: kind,
          title,
          body,
          hymnal,
          hymn_number: hymnNumber,
          service_date: serviceDate || null,
        },
        userId
      );
      setTitle('');
      setBody('');
      setHymnal('');
      setHymnNumber('');
      setServiceDate('');
      await onCreated?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
            Kind
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="input"
          >
            {Object.entries(SUGGESTION_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
            For service date (optional)
          </label>
          <select
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            className="input"
          >
            <option value="">— any —</option>
            {allDates.map((d) => (
              <option key={d.date} value={d.date}>
                {d.date}{d.label ? ` · ${d.label}` : ''}
              </option>
            ))}
          </select>
        </div>
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
          placeholder="Christ the Lord Is Risen Today"
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
          Why / details
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="input"
          placeholder="A sentence on why this fits the week."
        />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary text-sm" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit suggestion'}
        </button>
      </div>
    </form>
  );
}

// ---------- One suggestion card ----------

const STATUS_BADGE = {
  pending: { cls: 'bg-amber-100 text-amber-800' },
  accepted: { cls: 'bg-green-100 text-green-800' },
  declined: { cls: 'bg-gray-200 text-gray-700' },
  archived: { cls: 'bg-gray-100 text-gray-500' },
};

function SuggestionCard({ suggestion, role, userId, allDates, setError, reload }) {
  const decide = canDecide(role);
  const isMine = suggestion.suggested_by === userId;
  const [busy, setBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState(suggestion.review_notes || '');

  const meta = allDates.find((d) => d.date === suggestion.service_date);

  const review = async (status) => {
    setBusy(true);
    setError(null);
    try {
      await reviewSuggestion(suggestion.id, {
        status,
        reviewedBy: userId,
        notes: reviewNotes,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this suggestion?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSuggestion(suggestion.id);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const badge = STATUS_BADGE[suggestion.status] || STATUS_BADGE.pending;

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-base text-umc-900">{suggestion.title}</h2>
            <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}>
              {SUGGESTION_STATUS_LABELS[suggestion.status]}
            </span>
            <span className="text-[11px] text-gray-500">
              · {SUGGESTION_KIND_LABELS[suggestion.suggestion_kind]}
            </span>
            {suggestion.suggestion_kind === 'hymn' &&
              suggestion.hymnal &&
              suggestion.hymn_number && (
                <span className="text-[11px] text-gray-500">
                  · {suggestion.hymnal} {suggestion.hymn_number}
                </span>
              )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {suggestion.service_date
              ? `For ${suggestion.service_date}${meta?.label ? ` · ${meta.label}` : ''}`
              : 'For any service'}
            {' · '}
            Suggested {new Date(suggestion.created_at).toLocaleDateString()}
          </p>
        </div>
        {(decide || isMine) && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="text-xs text-red-600 hover:text-red-700 underline disabled:opacity-50 shrink-0"
          >
            Delete
          </button>
        )}
      </div>

      {suggestion.body && (
        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{suggestion.body}</p>
      )}

      {suggestion.added_to_bulletin_id && (
        <p className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
          ✓ Added to bulletin
          {suggestion.added_at && (
            <span className="text-gray-500 ml-1">
              on {new Date(suggestion.added_at).toLocaleDateString()}
            </span>
          )}
        </p>
      )}

      {suggestion.review_notes && suggestion.status !== 'pending' && (
        <p className="mt-2 text-xs text-gray-600 italic">
          Review note: {suggestion.review_notes}
        </p>
      )}

      {/* Pastor review controls */}
      {decide && suggestion.status === 'pending' && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <input
            type="text"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Review notes (optional) — visible to all"
            className="input text-sm"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => review('accepted')}
              disabled={busy}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => review('declined')}
              disabled={busy}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => review('archived')}
              disabled={busy}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </div>
      )}

      {decide && suggestion.status !== 'pending' && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => review('pending')}
            disabled={busy}
            className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
          >
            Re-open for review
          </button>
        </div>
      )}
    </li>
  );
}
