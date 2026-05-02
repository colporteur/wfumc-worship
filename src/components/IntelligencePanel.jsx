import { useEffect, useState } from 'react';
import {
  loadIntelligence,
  getPastorUserId,
  TIER_LABELS,
} from '../lib/intelligence';

// Pastor-only intelligence panel — collapsible, lazy-loaded.
//
// Lives inside WeekCard. Three sections:
//   * WFUMC sermons matching this week's text (owned by the pastor)
//   * Other sermons matching (e.g., Todd's wife's archive)
//   * Resources matching the text or the selected theme
//
// Lazy: doesn't query until the user opens the panel. Once opened, the
// data sticks for the lifetime of the WeekCard (no refetch on collapse).
export default function IntelligencePanel({
  scriptureReference,
  themes,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || data || loading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pastorUserId = await getPastorUserId();
        const result = await loadIntelligence({
          scriptureReference,
          themes,
          pastorUserId,
        });
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // If neither text nor theme is set, there's nothing to look up.
  const hasSomething =
    (scriptureReference && scriptureReference.trim()) ||
    (themes && themes.length > 0);
  if (!hasSomething) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-umc-700 hover:text-umc-900 font-medium flex items-center gap-1"
      >
        <span>{open ? '▼' : '▶'}</span>
        Intelligence
        {open && data && (
          <span className="text-gray-500 font-normal ml-1">
            ({data.wfumcSermons.length + data.otherSermons.length} sermons,{' '}
            {data.resourcesByText.length + data.resourcesByTheme.length} resources)
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {loading && (
            <p className="text-xs text-gray-500 italic">Searching…</p>
          )}
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          {!loading && !error && data && (
            <>
              <SermonSection
                title="WFUMC sermons"
                emptyHint="No prior WFUMC sermons match this text."
                results={data.wfumcSermons}
              />
              <SermonSection
                title="Other sermons"
                emptyHint="No other-archive sermons match this text."
                results={data.otherSermons}
              />
              <ResourceSection
                title="Resources matching this text"
                emptyHint={
                  data.targetRefs.length === 0
                    ? 'No scripture set yet.'
                    : 'No matching resources.'
                }
                results={data.resourcesByText}
              />
              <ResourceSection
                title="Resources matching theme"
                emptyHint={
                  data.themeTerms.length === 0
                    ? 'No theme selected yet.'
                    : 'No theme-tagged resources.'
                }
                results={data.resourcesByTheme}
                isThemeMatch
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- sermon section ----------

const TIER_BADGE = {
  verse_overlap: 'bg-green-100 text-green-800',
  same_chapter: 'bg-blue-100 text-blue-800',
  same_book: 'bg-gray-100 text-gray-700',
  theme_match: 'bg-amber-100 text-amber-800',
};

function SermonSection({ title, emptyHint, results }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title} ({results.length})
      </p>
      {results.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{emptyHint}</p>
      ) : (
        <ul className="space-y-1">
          {results.slice(0, 8).map(({ sermon, tier }) => (
            <li
              key={sermon.id}
              className="flex items-baseline gap-2 py-0.5"
            >
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${TIER_BADGE[tier] || ''}`}
                title={TIER_LABELS[tier] || tier}
              >
                {tierShort(tier)}
              </span>
              <span className="text-sm text-umc-900 truncate">
                {sermon.title || '(untitled)'}
              </span>
              <span className="text-xs text-gray-500 truncate">
                {sermon.scripture_reference}
                {sermon.preached_at && ` · ${sermon.preached_at}`}
              </span>
            </li>
          ))}
          {results.length > 8 && (
            <li className="text-xs text-gray-500 italic">
              + {results.length - 8} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ---------- resource section ----------

function ResourceSection({ title, emptyHint, results, isThemeMatch }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title} ({results.length})
      </p>
      {results.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{emptyHint}</p>
      ) : (
        <ul className="space-y-1">
          {results.slice(0, 8).map(({ resource, tier }) => (
            <li
              key={resource.id}
              className="flex items-baseline gap-2 py-0.5"
            >
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  TIER_BADGE[tier] || (isThemeMatch ? TIER_BADGE.theme_match : '')
                }`}
                title={TIER_LABELS[tier] || tier}
              >
                {tierShort(tier)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                {resource.resource_type}
              </span>
              <span className="text-sm text-umc-900 truncate">
                {resource.title ||
                  (resource.content
                    ? resource.content.slice(0, 60) + (resource.content.length > 60 ? '…' : '')
                    : '(untitled)')}
              </span>
              {resource.scripture_refs && (
                <span className="text-xs text-gray-500 truncate">
                  · {resource.scripture_refs}
                </span>
              )}
            </li>
          ))}
          {results.length > 8 && (
            <li className="text-xs text-gray-500 italic">
              + {results.length - 8} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function tierShort(tier) {
  switch (tier) {
    case 'verse_overlap':
      return 'Verse';
    case 'same_chapter':
      return 'Chapter';
    case 'same_book':
      return 'Book';
    case 'theme_match':
      return 'Theme';
    default:
      return tier;
  }
}
