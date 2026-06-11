// Word-document export for the worship-planning forecast.
//
// Produces a landscape .docx matching the pastor's hand-built planning
// grid ("Worship Planning – Winter - Spring 2026.docx"):
//
//   Date | Text | Liturgical Time | Text Description | Sermon Main Point | Music / Liturgy / Notes
//
// Column rules:
//   * Text            — the selected text for the week; if none is
//                       selected, all RCL readings for that Sunday.
//   * Liturgical Time — RCL designation from app data (e.g. "4th Sunday
//                       after the Epiphany"); specials use their label.
//   * Text Description — Claude (low-cost model), ≤20 words.
//   * Sermon Main Point — Claude (low-cost model), ≤30 words, only when
//                       the week has a linked sermon; blank otherwise.
//   * Music / Liturgy / Notes — always blank (filled in by hand).

import {
  AlignmentType,
  Document,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { supabase, withTimeout } from './supabase';
import { SERVICE_KIND_LABELS } from './specialServices';
import {
  summarizeTextDescriptions,
  summarizeSermonMainPoint,
} from './claude';

const FONT = 'Bookman Old Style';
const SIZE = 24; // half-points → 12pt

// Column widths in DXA (1440/inch), taken from the sample document.
const COL_WIDTHS = [1987, 1757, 2434, 2304, 2520, 2174];
const TABLE_WIDTH = COL_WIDTHS.reduce((a, b) => a + b, 0);

const HEADERS = [
  'Date',
  'Text',
  'Liturgical Time',
  'Text Description',
  'Sermon Main Point',
  'Music / Liturgy / Notes',
];

const READING_PREFIX = {
  ot: 'OT',
  psalm: 'Psalm',
  epistle: 'Epistle',
  gospel: 'Gospel',
};

// ---------------------------------------------------------------------
// Date helpers (avoid TZ drift by never parsing 'YYYY-MM-DD' with Date()).
// ---------------------------------------------------------------------

function parseDateParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d, date: new Date(y, m - 1, d) };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function monthDay(iso) {
  const { m, d } = parseDateParts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

function weekdayOf(iso) {
  return WEEKDAYS[parseDateParts(iso).date.getDay()];
}

// "Worship Planning – January through April 2026" (sample style); spans
// a year boundary as "December 2026 through February 2027".
function buildTitle(firstIso, lastIso) {
  const a = parseDateParts(firstIso);
  const b = parseDateParts(lastIso);
  if (a.y === b.y) {
    return `Worship Planning – ${MONTHS[a.m - 1]} through ${MONTHS[b.m - 1]} ${a.y}`;
  }
  return `Worship Planning – ${MONTHS[a.m - 1]} ${a.y} through ${MONTHS[b.m - 1]} ${b.y}`;
}

// ---------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------

// Build the logical rows (no Claude yet). Each row:
//   { key, dateLines, textLines, liturgicalTime, sermonId }
function buildRows(weeks, specials, plansByDate) {
  const items = [];
  for (const w of weeks) {
    items.push({ kind: 'sunday', date: w.service_date, week: w });
  }
  for (const s of specials || []) {
    items.push({ kind: 'special', date: s.service_date, service: s });
  }
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.kind === b.kind) return 0;
    return a.kind === 'sunday' ? -1 : 1;
  });

  return items.map((item, i) => {
    const plan = plansByDate[item.date] || null;
    if (item.kind === 'sunday') {
      const w = item.week;
      let textLines;
      if (plan?.scripture_reference?.trim()) {
        textLines = [plan.scripture_reference.trim()];
      } else {
        const r = w.readings || {};
        textLines = ['ot', 'psalm', 'epistle', 'gospel']
          .filter((k) => r[k])
          .map((k) => `${READING_PREFIX[k]}: ${r[k]}`);
      }
      return {
        key: `r${i}`,
        dateLines: [monthDay(item.date)],
        textLines,
        liturgicalTime: w.designation || '',
        sermonId: plan?.selected_sermon_id || null,
      };
    }
    // Special service. Non-Sundays show the weekday on its own line,
    // matching the sample ("Wednesday, / February 18").
    const s = item.service;
    const wd = weekdayOf(item.date);
    const dateLines =
      wd === 'Sunday'
        ? [monthDay(item.date)]
        : [`${wd},`, monthDay(item.date)];
    const textLines = plan?.scripture_reference?.trim()
      ? [plan.scripture_reference.trim()]
      : [];
    return {
      key: `r${i}`,
      dateLines,
      textLines,
      liturgicalTime:
        s.title || SERVICE_KIND_LABELS[s.service_kind] || 'Special service',
      // Specials share the worship_plans row for their date. For a
      // non-Sunday special (Ash Wednesday etc.) that row belongs to the
      // special, so its linked sermon applies. A Sunday-dated special
      // (e.g. Easter Vigil on Easter morning's date) would just repeat
      // the Sunday row's sermon — leave it blank there.
      sermonId: wd === 'Sunday' ? null : plan?.selected_sermon_id || null,
    };
  });
}

async function fetchPlans(dates) {
  if (!dates.length) return {};
  const { data, error } = await withTimeout(
    supabase.from('worship_plans').select('*').in('service_date', dates)
  );
  if (error) throw error;
  const byDate = {};
  for (const p of data ?? []) byDate[p.service_date] = p;
  return byDate;
}

async function fetchSermons(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await withTimeout(
    supabase
      .from('sermons')
      .select('id, title, theme, scripture_reference, manuscript_text')
      .in('id', uniq)
  );
  if (error) throw error;
  const out = {};
  for (const s of data ?? []) out[s.id] = s;
  return out;
}

// ---------------------------------------------------------------------
// docx construction
// ---------------------------------------------------------------------

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: SIZE, ...opts });
}

function cellParagraphs(lines, opts = {}) {
  const list = lines.length ? lines : [''];
  return list.map(
    (t) =>
      new Paragraph({
        children: [run(t, opts)],
        alignment: opts.alignment,
      })
  );
}

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: '000000' },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [run(text, { bold: true, color: 'FFFFFF' })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

function bodyCell(lines, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: cellParagraphs(lines),
  });
}

function buildDoc(title, rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: HEADERS.map((h, i) => headerCell(h, COL_WIDTHS[i])),
  });

  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: [
          bodyCell(r.dateLines, COL_WIDTHS[0]),
          bodyCell(r.textLines, COL_WIDTHS[1]),
          bodyCell([r.liturgicalTime], COL_WIDTHS[2]),
          bodyCell(r.description ? [r.description] : [], COL_WIDTHS[3]),
          bodyCell(r.mainPoint ? [r.mainPoint] : [], COL_WIDTHS[4]),
          bodyCell([], COL_WIDTHS[5]), // Music / Liturgy / Notes — by hand
        ],
      })
  );

  const border = { style: 'single', size: 4, color: '000000' };

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              // docx v8 swaps these for landscape — pass portrait dims
              // to land on 11" × 8.5".
              width: 12240,
              height: 15840,
            },
            margin: { top: 990, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: [
          new Paragraph({
            children: [run(title, { bold: true })],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ children: [] }),
          new Table({
            width: { size: TABLE_WIDTH, type: WidthType.DXA },
            columnWidths: COL_WIDTHS,
            borders: {
              top: border,
              bottom: border,
              left: border,
              right: border,
              insideHorizontal: border,
              insideVertical: border,
            },
            rows: [headerRow, ...bodyRows],
          }),
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Build + download the planning Word doc for the given forecast window.
 *
 * @param {Object} opts
 * @param {Array}  opts.weeks     upcomingSundays() output (rcl.json weeks)
 * @param {Array}  [opts.specials] special_services rows in the window
 * @param {Function} [opts.onProgress] (message: string) => void
 * @returns {string} the downloaded filename
 */
export async function exportWorshipPlanningDocx({
  weeks,
  specials = [],
  onProgress = () => {},
}) {
  if (!weeks?.length) {
    throw new Error('No upcoming weeks to export.');
  }

  onProgress('Loading plans…');
  const dates = [
    ...new Set([
      ...weeks.map((w) => w.service_date),
      ...specials.map((s) => s.service_date),
    ]),
  ];
  const plansByDate = await fetchPlans(dates);
  const rows = buildRows(weeks, specials, plansByDate);

  // --- Sermon main points (linked sermons only) ----------------------
  const sermonsById = await fetchSermons(rows.map((r) => r.sermonId));
  const pointCache = {}; // sermonId → summary
  const withSermons = rows.filter((r) => r.sermonId && sermonsById[r.sermonId]);
  let done = 0;
  for (const r of withSermons) {
    if (!(r.sermonId in pointCache)) {
      done += 1;
      onProgress(`Summarizing sermon main points (${done}/${withSermons.length})…`);
      try {
        pointCache[r.sermonId] = await summarizeSermonMainPoint(
          sermonsById[r.sermonId]
        );
      } catch {
        pointCache[r.sermonId] = ''; // never let one summary sink the doc
      }
    }
    r.mainPoint = pointCache[r.sermonId];
  }

  // --- Text descriptions (one batched call) --------------------------
  const describable = rows.filter((r) => r.textLines.length > 0);
  if (describable.length > 0) {
    onProgress('Summarizing text descriptions…');
    try {
      const descriptions = await summarizeTextDescriptions(
        describable.map((r) => ({
          key: r.key,
          reference: r.textLines.join(' / '),
        }))
      );
      for (const r of describable) {
        r.description = descriptions[r.key] || '';
      }
    } catch {
      // Descriptions are nice-to-have — ship the doc without them
      // rather than failing the whole export.
    }
  }

  // --- Build + download ----------------------------------------------
  onProgress('Building Word document…');
  const title = buildTitle(
    weeks[0].service_date,
    weeks[weeks.length - 1].service_date
  );
  const doc = buildDoc(title, rows);
  const blob = await Packer.toBlob(doc);

  const fname =
    title.replace(/[–—]/g, '-').replace(/[\\/:*?"<>|]+/g, '').trim() + '.docx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fname;
}
