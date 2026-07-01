import { useEffect, useMemo, useState } from 'react';
// (matchPlansToHint import above brings in the hint-matcher helper.)
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import {
  attachToPlans,
  countItemsPerPlan,
  createManualAdminItem,
  deleteAdminItem,
  detachAttachment,
  listAdminItems,
  listUpcomingPlansForPicker,
  loadAttachmentsForItems,
  matchPlansToHint,
  setAdminItemStatus,
  updateAdminItem,
} from '../lib/adminItems';

// /admin-items — the inbox for the "third bucket" of Daily Capture:
// operational / scheduling / planning notes about church programs.
//
// Three tabs:
//   Inbox    — open items with no attachments yet (needs triage)
//   Upcoming — open items attached to at least one visible Sunday
//   All      — everything, including resolved / dismissed (with filter)
//
// Plus a "+ New admin item" button for manual entry (not everything
// starts as a Plaud recording).
//
// Each item card supports:
//   - Attach to Sunday(s)   (opens picker; multi-select)
//   - Detach from a Sunday  (per-attachment)
//   - Mark resolved / dismissed / re-open
//   - Edit description / body / notes inline
//   - Delete (with confirm)

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
];

export default function AdminItems() {
  const { user } = useAuth();
  const [tab, setTab] = useState('inbox');
  const [statusFilter, setStatusFilter] = useState('open'); // for All tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [attachments, setAttachments] = useState(new Map()); // itemId → [attach]
  const [showNewModal, setShowNewModal] = useState(false);

  const reload = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      // For Inbox and Upcoming, we only care about open items. For
      // All, we honor the statusFilter dropdown.
      const status = tab === 'all' ? statusFilter : 'open';
      const list = await listAdminItems({ status });
      setItems(list);
      const attMap = await loadAttachmentsForItems(list.map((i) => i.id));
      setAttachments(attMap);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tab, statusFilter]);

  // Client-side filter for Inbox / Upcoming (both start from open items
  // and split by whether they have any attachments).
  const shown = useMemo(() => {
    if (tab === 'all') return items;
    if (tab === 'inbox') {
      return items.filter((it) => (attachments.get(it.id) || []).length === 0);
    }
    // 'upcoming'
    return items.filter((it) => (attachments.get(it.id) || []).length > 0);
  }, [tab, items, attachments]);

  const inboxCount = useMemo(
    () => items.filter((it) => (attachments.get(it.id) || []).length === 0).length,
    [items, attachments]
  );
  const upcomingCount = useMemo(
    () => items.filter((it) => (attachments.get(it.id) || []).length > 0).length,
    [items, attachments]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">Admin items</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Operational and programmatic notes — captured via Plaud →
            Daily Capture, or added here manually. Attach to any Sunday
            (or Sundays) they belong to.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="btn-secondary text-sm shrink-0"
        >
          + New admin item
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-baseline gap-4 border-b border-gray-200">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          const count =
            t.key === 'inbox'
              ? inboxCount
              : t.key === 'upcoming'
                ? upcomingCount
                : null;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`pb-2 border-b-2 transition-colors text-sm ${
                isActive
                  ? 'border-umc-700 text-umc-900 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
              {count !== null && (
                <span className="ml-1.5 text-xs text-gray-500">({count})</span>
              )}
            </button>
          );
        })}
        {tab === 'all' && (
          <div className="ml-auto pb-2 flex items-center gap-2 text-xs">
            <label className="text-gray-500">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs border-gray-300 rounded"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <LoadingSpinner label="Loading admin items…" />
      ) : shown.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          {tab === 'inbox'
            ? 'Inbox is clear. Any Daily Capture segments the pastor tagged as an admin item — or added manually here — will show up until you attach them to a Sunday.'
            : tab === 'upcoming'
              ? 'No admin items attached to an upcoming Sunday yet.'
              : 'No admin items match the current status filter.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <AdminItemCard
              key={item.id}
              item={item}
              attachments={attachments.get(item.id) || []}
              userId={user.id}
              onChanged={reload}
              setError={setError}
            />
          ))}
        </ul>
      )}

      {showNewModal && (
        <NewAdminItemModal
          userId={user.id}
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ------------- Per-item card -------------

function AdminItemCard({ item, attachments, userId, onChanged, setError }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(item.description || '');
  const [bodyDraft, setBodyDraft] = useState(item.body || '');
  const [notesDraft, setNotesDraft] = useState(item.notes || '');
  const [showAttachPicker, setShowAttachPicker] = useState(false);

  const isOpen = item.status === 'open';
  const isResolved = item.status === 'resolved';
  const isDismissed = item.status === 'dismissed';

  const wrap = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdits = () =>
    wrap(async () => {
      await updateAdminItem(item.id, {
        description: descDraft,
        body: bodyDraft,
        notes: notesDraft,
      });
      setEditing(false);
    });

  const handleDelete = () => {
    if (
      !window.confirm(
        'Delete this admin item permanently? This can\'t be undone.'
      )
    ) {
      return;
    }
    wrap(() => deleteAdminItem(item.id));
  };

  return (
    <li className={`card ${isDismissed ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-base text-umc-900">
              {item.description || <span className="italic text-gray-500">(no description)</span>}
            </h2>
            <StatusBadge status={item.status} />
            {item.captured_at && (
              <span className="text-[11px] text-gray-500">
                captured {fmtDate(item.captured_at)}
              </span>
            )}
            {item.source_capture_id && (
              <span
                className="text-[10px] uppercase tracking-wide text-umc-700 bg-umc-50 px-1.5 rounded"
                title="Sourced from a Daily Capture segment"
              >
                from Plaud
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            added {fmtDateTime(item.created_at)}
          </p>
          {item.suggested_sunday_hint && (
            <p className="text-[11px] text-umc-700 mt-0.5">
              📅 Suggested Sunday:{' '}
              <span className="italic">{item.suggested_sunday_hint}</span>
              {attachments.length === 0 && (
                <span className="text-gray-400">
                  {' '}— click <b>Attach to Sunday…</b> to see matching weeks
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Body — inline editable */}
      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Description (one-line summary)
          </label>
          <input
            type="text"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            className="w-full text-sm rounded border-gray-300"
            placeholder="e.g., Move Advent hymn-sing to Dec 15"
            disabled={busy}
          />
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Body
          </label>
          <textarea
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            rows={4}
            className="w-full text-sm rounded border-gray-300"
            disabled={busy}
          />
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Notes (context, follow-ups, decisions)
          </label>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={2}
            className="w-full text-sm rounded border-gray-300"
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveEdits}
              disabled={busy}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDescDraft(item.description || '');
                setBodyDraft(item.body || '');
                setNotesDraft(item.notes || '');
              }}
              disabled={busy}
              className="btn-secondary text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap font-serif">
            {item.body}
          </p>
          {item.notes && (
            <p className="mt-2 text-xs text-gray-600 italic whitespace-pre-wrap">
              {item.notes}
            </p>
          )}
        </>
      )}

      {/* Attachments row */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">
          Attached to
        </p>
        {attachments.length === 0 ? (
          <p className="text-xs text-gray-500 italic">
            Not attached to any Sunday yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <li key={a.join_id}>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-umc-50 border border-umc-200 text-umc-900">
                  {fmtDate(a.service_date)}
                  {a.theme && (
                    <span className="text-umc-700">· {a.theme}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => wrap(() => detachAttachment(a.join_id))}
                    disabled={busy}
                    className="text-[11px] text-gray-500 hover:text-red-700 disabled:opacity-50"
                    title="Detach from this Sunday"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      {!editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowAttachPicker(true)}
            disabled={busy}
            className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
          >
            Attach to Sunday…
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
          >
            Edit
          </button>
          {isOpen && (
            <>
              <button
                type="button"
                onClick={() => wrap(() => setAdminItemStatus(item.id, 'resolved'))}
                disabled={busy}
                className="text-green-700 hover:text-green-900 underline disabled:opacity-50"
              >
                Mark resolved
              </button>
              <button
                type="button"
                onClick={() => wrap(() => setAdminItemStatus(item.id, 'dismissed'))}
                disabled={busy}
                className="text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
              >
                Dismiss
              </button>
            </>
          )}
          {(isResolved || isDismissed) && (
            <button
              type="button"
              onClick={() => wrap(() => setAdminItemStatus(item.id, 'open'))}
              disabled={busy}
              className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
            >
              Re-open
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="ml-auto text-red-700 hover:text-red-900 underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}

      {showAttachPicker && (
        <AttachToPlansModal
          userId={userId}
          adminItemId={item.id}
          alreadyAttachedPlanIds={new Set(attachments.map((a) => a.plan_id))}
          suggestedHint={item.suggested_sunday_hint || null}
          onClose={() => setShowAttachPicker(false)}
          onAttached={() => {
            setShowAttachPicker(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function StatusBadge({ status }) {
  const map = {
    open: { label: 'Open', cls: 'bg-amber-100 text-amber-800' },
    resolved: { label: 'Resolved', cls: 'bg-green-100 text-green-800' },
    dismissed: { label: 'Dismissed', cls: 'bg-gray-200 text-gray-700' },
  };
  const info = map[status] || map.open;
  return (
    <span
      className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

// ------------- Attach-to-Sundays picker -------------

function AttachToPlansModal({
  userId,
  adminItemId,
  alreadyAttachedPlanIds,
  suggestedHint = null,
  onClose,
  onAttached,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plans, setPlans] = useState([]);
  const [countsByPlan, setCountsByPlan] = useState(new Map());
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Claude's hint match — computed after plans load. matchIds is a
  // Set<planId>; empty when there's no hint or nothing matched. We
  // highlight matches and offer a one-click "Select suggested" button;
  // we never auto-attach (pastor-in-the-loop is deliberate).
  const hintMatch = useMemo(
    () => matchPlansToHint(suggestedHint, plans),
    [suggestedHint, plans]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listUpcomingPlansForPicker({ horizonWeeks: 16 });
        if (cancelled) return;
        setPlans(list);
        const counts = await countItemsPerPlan(list.map((p) => p.id));
        if (cancelled) return;
        setCountsByPlan(counts);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (planId) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const handleAttach = async () => {
    setSaving(true);
    setError(null);
    try {
      await attachToPlans({
        ownerUserId: userId,
        adminItemId,
        planIds: Array.from(picked),
      });
      onAttached();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-lg text-umc-900">
            Attach to Sunday(s)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Close
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        {loading ? (
          <LoadingSpinner label="Loading upcoming Sundays…" />
        ) : plans.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No upcoming worship plans in the next 16 weeks. Create the
            worship plan first on the Forecast page — pick a text or
            open a vote — then come back here to attach.
          </p>
        ) : (
          <>
            {suggestedHint && (
              <div className="rounded border border-umc-200 bg-umc-50 p-2 text-xs">
                <p className="text-umc-900">
                  📅 Claude suggested this item might belong to{' '}
                  <span className="italic">&ldquo;{suggestedHint}&rdquo;</span>.
                </p>
                {hintMatch.matchIds.size > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-umc-700">{hintMatch.reason}.</span>
                    <button
                      type="button"
                      onClick={() => {
                        // Only pre-fill checkboxes — pastor still has
                        // to click "Attach" to commit. Skip any that
                        // are already attached.
                        setPicked((prev) => {
                          const next = new Set(prev);
                          for (const id of hintMatch.matchIds) {
                            if (!alreadyAttachedPlanIds.has(id)) next.add(id);
                          }
                          return next;
                        });
                      }}
                      className="text-umc-700 hover:text-umc-900 underline"
                    >
                      Select suggested Sunday{hintMatch.matchIds.size === 1 ? '' : 's'}
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500 mt-1">
                    No upcoming Sundays matched — pick manually below.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-gray-500">
              Multi-select — this item will attach to each Sunday you pick.
              Sundays you&apos;ve already attached are grayed out.
              {hintMatch.matchIds.size > 0 && ' Suggested matches are marked ✨.'}
            </p>
            <ul className="max-h-80 overflow-y-auto space-y-1 border border-gray-200 rounded p-2">
              {[...plans]
                .sort((a, b) => {
                  const aMatch = hintMatch.matchIds.has(a.id) ? 0 : 1;
                  const bMatch = hintMatch.matchIds.has(b.id) ? 0 : 1;
                  if (aMatch !== bMatch) return aMatch - bMatch;
                  return (a.service_date || '').localeCompare(b.service_date || '');
                })
                .map((p) => {
                const already = alreadyAttachedPlanIds.has(p.id);
                const checked = picked.has(p.id);
                const count = countsByPlan.get(p.id) || 0;
                const matched = hintMatch.matchIds.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-start gap-2 p-1.5 rounded ${
                        already
                          ? 'opacity-50'
                          : matched
                            ? 'bg-umc-50 hover:bg-umc-100 cursor-pointer'
                            : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.id)}
                        disabled={already || saving}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm text-umc-900">
                          {matched && (
                            <span
                              className="mr-1"
                              title="Matches Claude's suggested Sunday"
                            >
                              ✨
                            </span>
                          )}
                          {fmtDate(p.service_date)}
                        </span>
                        {p.theme && (
                          <span className="ml-2 text-xs text-umc-700">
                            · {p.theme}
                          </span>
                        )}
                        {p.scripture_reference && (
                          <span className="ml-2 text-xs text-gray-500">
                            · {p.scripture_reference}
                          </span>
                        )}
                        {already && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500">
                            already attached
                          </span>
                        )}
                        {!already && count > 0 && (
                          <span className="ml-2 text-[10px] text-gray-400">
                            {count} other item{count === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn-secondary text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAttach}
                disabled={saving || picked.size === 0}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {saving
                  ? 'Attaching…'
                  : `Attach to ${picked.size || 0} Sunday${
                      picked.size === 1 ? '' : 's'
                    }`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------- New-item modal -------------

function NewAdminItemModal({ userId, onClose, onCreated }) {
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await createManualAdminItem({
        ownerUserId: userId,
        description,
        body,
        capturedAt: capturedAt || null,
        notes,
      });
      onCreated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-lg text-umc-900">
            New admin item
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Close
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        <label className="block text-[10px] uppercase tracking-wide text-gray-500">
          Description (one-line summary)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full text-sm rounded border-gray-300"
          placeholder="e.g., Confirm choir loft mic before Christmas Eve"
          disabled={busy}
        />
        <label className="block text-[10px] uppercase tracking-wide text-gray-500">
          Body <span className="text-red-600">*</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full text-sm rounded border-gray-300"
          placeholder="Details, context, what needs to happen…"
          disabled={busy}
        />
        <label className="block text-[10px] uppercase tracking-wide text-gray-500">
          Captured on (optional)
        </label>
        <input
          type="date"
          value={capturedAt}
          onChange={(e) => setCapturedAt(e.target.value)}
          className="text-sm rounded border-gray-300"
          disabled={busy}
        />
        <label className="block text-[10px] uppercase tracking-wide text-gray-500">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full text-sm rounded border-gray-300"
          disabled={busy}
        />
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !body.trim()}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
