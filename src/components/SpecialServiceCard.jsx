import { useState } from 'react';
import { canDecide } from '../lib/permissions';
import {
  SERVICE_KIND_LABELS,
  fmtServiceDateLong,
  deleteSpecialService,
} from '../lib/specialServices';

// Renders one special_service row in the unified forecast list.
//
// Lightweight services are simple cards: title, time, location, notes.
// Planning services get a teaser that links into the same workflow as a
// Sunday card (the actual planning state lives on worship_plans /
// planning_options keyed by service_date).
//
// Only pastor / office_admin see edit + delete affordances.
export default function SpecialServiceCard({
  service,
  role,
  onEdit,
  onChanged,
  setError,
}) {
  const decide = canDecide(role);
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Remove "${service.title}" from the forecast? This deletes the special service record (any voting / theme data tied to that date stays put).`
      )
    ) {
      return;
    }
    setBusy(true);
    setError?.(null);
    try {
      await deleteSpecialService(service.id);
      await onChanged?.();
    } catch (e) {
      setError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = SERVICE_KIND_LABELS[service.service_kind] || service.service_kind;

  return (
    <li className="card border-l-4 border-l-amber-400">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-lg text-umc-900">{service.title}</h2>
            <span className="px-2 py-0.5 text-[10px] uppercase tracking-wide rounded bg-amber-100 text-amber-800">
              {service.workflow_kind === 'planning'
                ? `Planning · ${kindLabel}`
                : `Special · ${kindLabel}`}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtServiceDateLong(service.service_date)}
            {service.time_of_day && ` · ${service.time_of_day}`}
            {service.location && ` · ${service.location}`}
          </p>
        </div>
        {decide && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEdit?.(service)}
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
              {busy ? 'Working…' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {service.notes && (
        <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">
          {service.notes}
        </p>
      )}

      {service.workflow_kind === 'planning' && (
        <p className="mt-3 text-xs text-gray-500 italic">
          Planning workflow active — open the date in voting / themes / library
          tabs to plan readings and music. (This card mirrors any
          worship_plans entry pinned to {service.service_date}.)
        </p>
      )}
    </li>
  );
}
