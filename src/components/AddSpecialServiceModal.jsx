import { useEffect, useState } from 'react';
import {
  SERVICE_KIND_OPTIONS,
  createSpecialService,
  updateSpecialService,
} from '../lib/specialServices';

// Modal for adding (or editing) a special non-Sunday service.
//
// Picking a service_kind from the picker prefills workflow_kind to its
// default ('planning' for liturgical specials; 'lightweight' for
// funerals/weddings/etc.). Pastor can override.
export default function AddSpecialServiceModal({
  open,
  onClose,
  userId,
  onSaved,
  initial = null,
}) {
  const isEdit = Boolean(initial);
  const [title, setTitle] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [serviceKind, setServiceKind] = useState('other');
  const [workflowKind, setWorkflowKind] = useState('lightweight');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title || '');
      setServiceDate(initial.service_date || '');
      setServiceKind(initial.service_kind || 'other');
      setWorkflowKind(initial.workflow_kind || 'lightweight');
      setTimeOfDay(initial.time_of_day || '');
      setLocation(initial.location || '');
      setNotes(initial.notes || '');
    } else {
      setTitle('');
      setServiceDate('');
      setServiceKind('other');
      setWorkflowKind('lightweight');
      setTimeOfDay('');
      setLocation('');
      setNotes('');
    }
    setError(null);
  }, [open, initial]);

  const onPickKind = (val) => {
    setServiceKind(val);
    const opt = SERVICE_KIND_OPTIONS.find((o) => o.value === val);
    // When the user changes service_kind, snap workflow to that kind's
    // default — but only if they haven't manually overridden it for this
    // session (we approximate that by always re-applying).
    if (opt) setWorkflowKind(opt.defaultWorkflow);
    // Auto-fill title if it's still empty.
    if (opt && !title.trim()) setTitle(opt.label);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        title,
        service_date: serviceDate,
        service_kind: serviceKind,
        workflow_kind: workflowKind,
        time_of_day: timeOfDay,
        location,
        notes,
      };
      if (isEdit) {
        await updateSpecialService(initial.id, payload);
      } else {
        await createSpecialService(payload, userId);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-lg sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-umc-900">
              {isEdit ? 'Edit special service' : 'Add special service'}
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

          <Field label="Service kind" required>
            <select
              value={serviceKind}
              onChange={(e) => onPickKind(e.target.value)}
              className="input"
            >
              {SERVICE_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g., Funeral for Jane Doe"
              className="input"
            />
          </Field>

          <Field label="Date" required>
            <input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              required
              className="input"
            />
          </Field>

          <Field label="Workflow">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="workflow"
                  value="lightweight"
                  checked={workflowKind === 'lightweight'}
                  onChange={() => setWorkflowKind('lightweight')}
                />
                <span>
                  <strong>Lightweight</strong> — calendar entry only (funerals,
                  weddings, simple services).
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="workflow"
                  value="planning"
                  checked={workflowKind === 'planning'}
                  onChange={() => setWorkflowKind('planning')}
                />
                <span>
                  <strong>Planning</strong> — full workflow (voting, themes,
                  scripture pick).
                </span>
              </label>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Time">
              <input
                type="text"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                placeholder="7:00 PM"
                className="input"
              />
            </Field>
            <Field label="Location">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Sanctuary"
                className="input"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input"
              placeholder="Anything you want recorded — readings, music notes, who's officiating, etc."
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-sm"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy}
            >
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
