import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import WeekCard from '../components/WeekCard.jsx';
import SpecialServiceCard from '../components/SpecialServiceCard.jsx';
import AddSpecialServiceModal from '../components/AddSpecialServiceModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  canDecide,
  canVote,
  canSeePastorOnlyPanels,
  ROLE_LABELS,
} from '../lib/permissions';
import {
  upcomingSundays,
  loadPlanningState,
  loadSermonsByIds,
  deriveSermonPlan,
} from '../lib/planning';
import { loadSpecialServicesFrom } from '../lib/specialServices';
import { exportWorshipPlanningDocx } from '../lib/exportWorshipDoc';
import { loadGroupingState } from '../lib/groupings';
import { loadWeekElementsInRange } from '../lib/elements';

// Forecast — Phase 2.
//
// Interleaves the next 12 Sundays (from rcl.json) with any special
// services the pastor has added on dates in the same window. Sundays
// use the WeekCard component (RCL readings + voting + grouping/theme
// badge + linked elements teaser). Special services use
// SpecialServiceCard.
export default function Forecast() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyDate, setBusyDate] = useState(null);
  const [planningState, setPlanningState] = useState({
    plansByDate: {},
    optionsByDate: {},
    votesByOption: {},
    myVotedOptions: new Set(),
  });
  const [specialServices, setSpecialServices] = useState([]);
  const [groupingState, setGroupingState] = useState({
    groupings: [],
    datesByGrouping: {},
    groupingsByDate: {},
    themesByGrouping: {},
    votesByTheme: {},
    myVotedThemes: new Set(),
  });
  const [weekElementsByDate, setWeekElementsByDate] = useState({});
  const [sermonsById, setSermonsById] = useState({});
  const [showAddSpecial, setShowAddSpecial] = useState(false);
  const [editingSpecial, setEditingSpecial] = useState(null);
  const [exporting, setExporting] = useState(null); // progress message | null

  const today = new Date().toISOString().slice(0, 10);
  const sundays = useMemo(() => upcomingSundays(today, 12), [today]);

  // Date window we care about: today → last Sunday in the forecast.
  // Used for special_services + week_elements range queries.
  const horizonEnd = sundays.length > 0
    ? sundays[sundays.length - 1].service_date
    : today;

  const reload = async () => {
    if (!user?.id || sundays.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const [planning, specials, grouping, weekElements] = await Promise.all([
        loadPlanningState(sundays.map((w) => w.service_date), user.id),
        loadSpecialServicesFrom(today),
        loadGroupingState(user.id),
        loadWeekElementsInRange(today, horizonEnd),
      ]);
      setPlanningState(planning);
      // Only show specials in the visible window. Anything past the
      // 12-Sunday horizon stays in the database for later forecasts.
      setSpecialServices(
        (specials || []).filter((s) => s.service_date <= horizonEnd)
      );
      setGroupingState(grouping);

      const elementsByDate = {};
      for (const we of weekElements || []) {
        if (!elementsByDate[we.service_date]) elementsByDate[we.service_date] = [];
        elementsByDate[we.service_date].push(we);
      }
      setWeekElementsByDate(elementsByDate);

      // Pull sermon details for any plans that picked one — populates
      // the WeekCard's "Upcoming sermon" pinned section.
      const sermonIds = Object.values(planning.plansByDate)
        .map((p) => p?.selected_sermon_id)
        .filter(Boolean);
      if (sermonIds.length > 0) {
        try {
          const map = await loadSermonsByIds(sermonIds);
          setSermonsById(map);
        } catch {
          setSermonsById({});
        }
      } else {
        setSermonsById({});
      }
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

  // Build a unified, date-sorted list of cards: Sundays + special services
  // Tie-break: Sundays first if a special falls on the same date.
  const items = useMemo(() => {
    const list = [];
    for (const w of sundays) {
      list.push({ kind: 'sunday', date: w.service_date, week: w });
    }
    for (const s of specialServices) {
      list.push({ kind: 'special', date: s.service_date, service: s });
    }
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      // Same date: Sunday first
      if (a.kind === b.kind) return 0;
      return a.kind === 'sunday' ? -1 : 1;
    });
    return list;
  }, [sundays, specialServices]);

  if (!profile) return <LoadingSpinner label="Loading…" />;
  if (loading) return <LoadingSpinner label="Loading the next 12 weeks…" />;

  const decide = canDecide(profile.role);
  const vote = canVote(profile.role);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
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
        {decide && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={Boolean(exporting)}
              onClick={async () => {
                setError(null);
                setExporting('Starting export…');
                try {
                  await exportWorshipPlanningDocx({
                    weeks: sundays,
                    specials: specialServices,
                    onProgress: (msg) => setExporting(msg),
                  });
                } catch (e) {
                  setError(e.message || String(e));
                } finally {
                  setExporting(null);
                }
              }}
              className="btn-secondary text-sm disabled:opacity-60"
              title="Download a Word planning grid for the next 12 weeks"
            >
              {exporting ? exporting : '⬇ Word doc'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingSpecial(null);
                setShowAddSpecial(true);
              }}
              className="btn-secondary text-sm"
            >
              + Add special service
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Pastor-only workload summary across the visible Sundays */}
      {canSeePastorOnlyPanels(profile.role) && sundays.length > 0 && (
        <WorkloadSummary
          sundays={sundays}
          plansByDate={planningState.plansByDate}
        />
      )}

      {items.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          No upcoming RCL data found. Add weeks to{' '}
          <code className="text-xs">src/data/rcl.json</code>.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) =>
            item.kind === 'sunday' ? (
              <WeekCard
                key={`sun-${item.week.service_date}`}
                week={item.week}
                state={planningState}
                groupingState={groupingState}
                weekElementsByDate={weekElementsByDate}
                sermonsById={sermonsById}
                userId={user.id}
                role={profile.role}
                busyDate={busyDate}
                setBusyDate={setBusyDate}
                setError={setError}
                reload={reload}
              />
            ) : (
              <SpecialServiceCard
                key={`spc-${item.service.id}`}
                service={item.service}
                role={profile.role}
                onEdit={(svc) => {
                  setEditingSpecial(svc);
                  setShowAddSpecial(true);
                }}
                onChanged={reload}
                setError={setError}
              />
            )
          )}
        </ul>
      )}

      {!decide && !vote && (
        <p className="text-xs text-gray-400 italic">
          Signed in as {profile.full_name}{' '}
          (<span>{ROLE_LABELS[profile.role] || profile.role}</span>) — read-only.
        </p>
      )}

      <AddSpecialServiceModal
        open={showAddSpecial}
        onClose={() => {
          setShowAddSpecial(false);
          setEditingSpecial(null);
        }}
        userId={user.id}
        initial={editingSpecial}
        onSaved={reload}
      />
    </div>
  );
}

// Pastor-only workload summary across the visible Sundays. Counts how
// many weeks already have a sermon decision (reuse vs from scratch)
// versus still-undecided. Quick at-a-glance read of the writing
// workload over the next 12 weeks.
function WorkloadSummary({ sundays, plansByDate }) {
  const counts = useMemo(() => {
    const out = {
      total: sundays.length,
      reuse: 0,
      from_scratch: 0,
      undecided: 0,
      no_text: 0,
    };
    for (const s of sundays) {
      const plan = plansByDate[s.service_date];
      const status = deriveSermonPlan(plan);
      // "no_text" — the pastor hasn't even picked a scripture yet, so
      // the sermon plan is moot. Counted separately so the workload
      // numbers represent actually-actionable weeks.
      const hasText = plan?.scripture_reference;
      if (!hasText) {
        out.no_text++;
      } else if (status === 'reuse') {
        out.reuse++;
      } else if (status === 'from_scratch') {
        out.from_scratch++;
      } else {
        out.undecided++;
      }
    }
    return out;
  }, [sundays, plansByDate]);

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">
        Sermon workload · next {counts.total} weeks
      </p>
      <Pill label="Reusing a base" count={counts.reuse} cls="bg-blue-100 text-blue-800" />
      <Pill
        label="From scratch"
        count={counts.from_scratch}
        cls="bg-purple-100 text-purple-800"
      />
      <Pill
        label="Text picked, no plan"
        count={counts.undecided}
        cls="bg-amber-100 text-amber-800"
      />
      <Pill label="Text not yet picked" count={counts.no_text} cls="bg-gray-100 text-gray-700" />
    </div>
  );
}

function Pill({ label, count, cls }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${cls}`}
    >
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}
