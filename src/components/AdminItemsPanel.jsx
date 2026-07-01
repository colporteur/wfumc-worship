import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  detachAttachment,
  setAdminItemStatus,
} from '../lib/adminItems';

// Compact "admin items for this Sunday" panel — rendered inside each
// WeekCard on the Forecast page. Shows the open items attached to the
// current worship_plan, with quick detach + mark-resolved affordances.
//
// Deep-linking to the full item list uses /admin-items — no per-item
// deep link yet (kept lean for Phase 2; can add later if useful).
//
// Props:
//   items    — array of { join_id, admin_item_id, description, body,
//              status, captured_at, source_capture_id }
//   onChanged — called after any successful mutation so the parent
//              (Forecast → WeekCard) can reload its admin-items map
//   setError — parent's error setter, shared with the rest of WeekCard
export default function AdminItemsPanel({ items = [], onChanged, setError }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          📋 Admin items ({items.length})
        </p>
        <Link
          to="/admin-items"
          className="text-[11px] text-umc-700 hover:text-umc-900 underline"
        >
          Open all
        </Link>
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <AdminItemRow
            key={it.join_id}
            item={it}
            onChanged={onChanged}
            setError={setError}
          />
        ))}
      </ul>
    </div>
  );
}

function AdminItemRow({ item, onChanged, setError }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const wrap = async (fn) => {
    setBusy(true);
    setError?.(null);
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      setError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border border-gray-200 bg-gray-50 rounded p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm text-left text-umc-900 hover:text-umc-700 w-full"
            title="Toggle full body"
          >
            {item.description || (
              <span className="italic text-gray-500">(no description)</span>
            )}
            {item.source_capture_id && (
              <span
                className="ml-2 text-[10px] uppercase tracking-wide text-umc-700 bg-umc-50 px-1 rounded"
                title="From a Daily Capture segment"
              >
                Plaud
              </span>
            )}
          </button>
          {expanded && (
            <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap font-serif">
              {item.body}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px]">
          <button
            type="button"
            onClick={() =>
              wrap(() => setAdminItemStatus(item.admin_item_id, 'resolved'))
            }
            disabled={busy}
            className="text-green-700 hover:text-green-900 underline disabled:opacity-50"
            title="Mark this item resolved (stays in All tab for history)"
          >
            Resolve
          </button>
          <button
            type="button"
            onClick={() => wrap(() => detachAttachment(item.join_id))}
            disabled={busy}
            className="text-gray-500 hover:text-red-700 underline disabled:opacity-50"
            title="Detach from this Sunday (item stays in the inbox)"
          >
            Detach
          </button>
        </div>
      </div>
    </li>
  );
}
