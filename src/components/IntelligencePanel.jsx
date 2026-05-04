import { useEffect, useMemo, useState } from 'react';
import {
  loadIntelligence,
  getPastorUserId,
  sermonArchiveUrl,
  TIER_LABELS,
} from '../lib/intelligence';

// Pastor-only intelligence panel — collapsible, lazy-loaded.
//
// Lives inside WeekCard. Three sections:
//   * WFUMC sermons  — sermons preached at WFUMC (any preaching with
//                      bulletin_id set). Most recent preaching date shown.
//   * Other sermons  — every other matching sermon. May include sermons
//                      preached at WFUMC historically without a linked
//                      bulletin row; the link to the Sermon Archive
//                      shows the full preaching history.
//   * Resources matching the text (scripture overlap)
//   * Resources matching the theme (tag overlap with selected theme)
//
// Each section defaults to verse-overlap matches only. A "+ N chapter,
// + M book" expander reveals wider matches when the pastor wants them.
// Sermons with a manuscript link out to the Sermon Archive.
export default function IntelligencePanel({ scriptureReference, themes }) {
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
            {data.resourcesByText.length + data.resourcesByTheme.length}{' '}
            resources)
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {loading && (
            <p className="text-xs text-gray-500 italic">Searching…</p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {!loading && !error && data && (
            <>
              <SermonSection
                title="WFUMC sermons"
                emptyHint="No prior WFUMC-bulletin sermons match this text."
                results={data.wfumcSermons}
              />
              <SermonSection
                title="Other matching sermons"
                emptyHint="No other sermons in the archive match this text."
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

// ---------- shared ----------

const TIER_BADGE = {
  verse_overlap: 'bg-green-100 text-green-800',
  same_chapter: 'bg-blue-100 text-blue-800',
  same_book: 'bg-gray-100 text-gray-700',
  theme_match: 'bg-amber-100 text-amber-800',
};

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

// Split a results array into "primary" (verse_overlap or theme_match)
// and "wider" (same_chapter, same_book) buckets.
function splitTiers(results) {
  const primary = [];
  const wider = [];
  for (const r of results) {
    if (r.tier === 'verse_overlap' || r.tier === 'theme_match') {
      primary.push(r);
    } else {
      wider.push(r);
    }
  }
  return { primary, wider };
}

// "+ 3 chapter, + 7 book" — the human-readable summary on the expander.
function widerLabel(wider) {
  const counts = wider.reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] || 0) + 1;
      return acc;
    },
    {}
  );
  const parts = [];
  if (counts.same_chapter) parts.push(`${counts.same_chapter} chapter`);
  if (counts.same_book) parts.push(`${counts.same_book} book`);
  return parts.join(', ');
}

// ---------- sermon section ----------

function SermonSection({ title, emptyHint, results }) {
  const { primary, wider } = useMemo(() => splitTiers(results), [results]);
  const [showWider, setShowWider] = useState(false);
  const visible = showWider ? [...primary, ...wider] : primary;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title} ({results.length})
      </p>
      {results.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{emptyHint}</p>
      ) : primary.length === 0 && !showWider ? (
        <p className="text-xs text-gray-500 italic">
          No verse-level matches.{' '}
          {wider.length > 0 && (
            <button
              type="button"
              className="text-umc-700 hover:text-umc-900 underline"
              onClick={() => setShowWider(true)}
            >
              Show + {widerLabel(wider)} matches
            </button>
          )}
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {visible.slice(0, 12).map(({ sermon, tier, wfumcDates }) => (
              <SermonRow
                key={sermon.id}
                sermon={sermon}
                tier={tier}
                wfumcDates={wfumcDates}
              />
            ))}
            {visible.length > 12 && (
              <li className="text-xs text-gray-500 italic">
                + {visible.length - 12} more
              </li>
            )}
          </ul>
          {wider.length > 0 && (
            <button
              type="button"
              onClick={() => setShowWider((v) => !v)}
              className="mt-1 text-xs text-umc-700 hover:text-umc-900 underline"
            >
              {showWider
                ? `Hide wider matches`
                : `Show + ${widerLabel(wider)} matches`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SermonRow({ sermon, tier, wfumcDates }) {
  // Always link the title to the Sermon Archive entry (even sermons
  // without a manuscript on file — the archive page lets the pastor
  // view + edit metadata, history, etc.). The 📄 indicator separately
  // tells you whether a manuscript is attached.
  const archiveUrl = sermonArchiveUrl(sermon.id);
  const titleNode = sermon.title || '(untitled)';
  return (
    <li className="flex items-baseline gap-2 py-0.5">
      <span
        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
          TIER_BADGE[tier] || ''
        }`}
        title={TIER_LABELS[tier] || tier}
      >
        {tierShort(tier)}
      </span>
      {archiveUrl ? (
        <a
          href={archiveUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-umc-700 hover:text-umc-900 underline truncate"
          title="Open in Sermon Archive"
        >
          {titleNode}
        </a>
      ) : (
        <span className="text-sm text-umc-900 truncate">{titleNode}</span>
      )}
      {sermon.hasManuscript && (
        <span
          className="text-[10px] text-gray-500"
          title="Has manuscript on file"
        >
          📄
        </span>
      )}
      <span className="text-xs text-gray-500 truncate">
        {sermon.scripture_reference}
      </span>
      {wfumcDates && wfumcDates.length > 0 && (
        <span
          className="text-[10px] text-green-700"
          title={`Preached at WFUMC: ${wfumcDates.join(', ')}`}
        >
          · WFUMC {wfumcDates[0]}
          {wfumcDates.length > 1 && ` (+${wfumcDates.length - 1})`}
        </span>
      )}
    </li>
  );
}

// ---------- resource section ----------

function ResourceSection({ title, emptyHint, results, isThemeMatch }) {
  const { primary, wider } = useMemo(
    () => splitTiers(results),
    [results]
  );
  const [showWider, setShowWider] = useState(false);
  const visible = showWider ? [...primary, ...wider] : primary;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title} ({results.length})
      </p>
      {results.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{emptyHint}</p>
      ) : primary.length === 0 && !showWider ? (
        <p className="text-xs text-gray-500 italic">
          No verse-level matches.{' '}
          {wider.length > 0 && (
            <button
              type="button"
              className="text-umc-700 hover:text-umc-900 underline"
              onClick={() => setShowWider(true)}
            >
              Show + {widerLabel(wider)} matches
            </button>
          )}
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {visible.slice(0, 12).map(({ resource, tier }) => (
              <li
                key={resource.id}
                className="flex items-baseline gap-2 py-0.5"
              >
                <span
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    TIER_BADGE[tier] ||
                    (isThemeMatch ? TIER_BADGE.theme_match : '')
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
                      ? resource.content.slice(0, 60) +
                        (resource.content.length > 60 ? '…' : '')
                      : '(untitled)')}
                </span>
                {resource.scripture_refs && (
                  <span className="text-xs text-gray-500 truncate">
                    · {resource.scripture_refs}
                  </span>
                )}
              </li>
            ))}
            {visible.length > 12 && (
              <li className="text-xs text-gray-500 italic">
                + {visible.length - 12} more
              </li>
            )}
          </ul>
          {wider.length > 0 && (
            <button
              type="button"
              onClick={() => setShowWider((v) => !v)}
              className="mt-1 text-xs text-umc-700 hover:text-umc-900 underline"
            >
              {showWider
                ? 'Hide wider matches'
                : `Show + ${widerLabel(wider)} matches`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
