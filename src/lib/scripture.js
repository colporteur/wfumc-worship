// Scripture reference parser + overlap computation.
//
// Inputs are messy human-typed strings. Examples we need to handle:
//   "John 3:16"
//   "John 3:1-21"
//   "John 3:1-10, 16"            (compound — pastor noted multiple parts)
//   "1 Cor 13:1-13"
//   "1 Corinthians 13"           (whole chapter)
//   "Psalm 23"                   (psalm — single chapter book, no verses)
//   "Psalm 23:1-6"
//   "Mark 12:28-34; Romans 13:8" (multi-ref string from resources table)
//   "Acts 2:1-21 (NRSVUe)"       (translation parenthetical to strip)
//   "Genesis 1:1-2:3"            (cross-chapter range — uncommon, handle gracefully)
//
// We DON'T try to perfectly parse every malformed input. We aim for:
//   * Best-effort book + chapter + verse(s) extraction.
//   * Overlap computation that gives sensible "verse_overlap" /
//     "same_chapter" / "same_book" / "none" tiers.
//   * Robust against missing pieces (no verse → matches whole chapter).

// Canonical list of bible books. Aliases let us match "1 Cor", "1 Corinthians",
// "I Corinthians", "1Cor", etc. all to the same canonical name.
//
// Format: [canonical, ...aliases] (lowercase). The first entry is the
// display name (with proper capitalization shown elsewhere).
const BOOKS = [
  // Old Testament
  ['Genesis', 'gen', 'gn'],
  ['Exodus', 'ex', 'exod', 'exo'],
  ['Leviticus', 'lev', 'lv'],
  ['Numbers', 'num', 'nm', 'nb'],
  ['Deuteronomy', 'deut', 'dt'],
  ['Joshua', 'josh', 'jos'],
  ['Judges', 'judg', 'jdg'],
  ['Ruth', 'ru'],
  ['1 Samuel', '1 sam', '1sam', 'i samuel', '1sm'],
  ['2 Samuel', '2 sam', '2sam', 'ii samuel', '2sm'],
  ['1 Kings', '1 kgs', '1kgs', 'i kings'],
  ['2 Kings', '2 kgs', '2kgs', 'ii kings'],
  ['1 Chronicles', '1 chr', '1chr', 'i chronicles'],
  ['2 Chronicles', '2 chr', '2chr', 'ii chronicles'],
  ['Ezra'],
  ['Nehemiah', 'neh'],
  ['Esther', 'est'],
  ['Job'],
  ['Psalms', 'psalm', 'ps'],
  ['Proverbs', 'prov', 'pr'],
  ['Ecclesiastes', 'eccl', 'qoh'],
  ['Song of Solomon', 'song', 'sos', 'song of songs', 'cant'],
  ['Isaiah', 'isa', 'is'],
  ['Jeremiah', 'jer'],
  ['Lamentations', 'lam'],
  ['Ezekiel', 'ezek', 'ez'],
  ['Daniel', 'dan'],
  ['Hosea', 'hos'],
  ['Joel'],
  ['Amos'],
  ['Obadiah', 'obad'],
  ['Jonah'],
  ['Micah', 'mic'],
  ['Nahum', 'nah'],
  ['Habakkuk', 'hab'],
  ['Zephaniah', 'zeph'],
  ['Haggai', 'hag'],
  ['Zechariah', 'zech'],
  ['Malachi', 'mal'],
  // New Testament
  ['Matthew', 'matt', 'mt'],
  ['Mark', 'mk'],
  ['Luke', 'lk'],
  ['John', 'jn'],
  ['Acts'],
  ['Romans', 'rom'],
  ['1 Corinthians', '1 cor', '1cor', 'i corinthians'],
  ['2 Corinthians', '2 cor', '2cor', 'ii corinthians'],
  ['Galatians', 'gal'],
  ['Ephesians', 'eph'],
  ['Philippians', 'phil'],
  ['Colossians', 'col'],
  ['1 Thessalonians', '1 thess', '1thess', '1 thes', 'i thessalonians'],
  ['2 Thessalonians', '2 thess', '2thess', '2 thes', 'ii thessalonians'],
  ['1 Timothy', '1 tim', '1tim', 'i timothy'],
  ['2 Timothy', '2 tim', '2tim', 'ii timothy'],
  ['Titus'],
  ['Philemon', 'phlm', 'phm'],
  ['Hebrews', 'heb'],
  ['James', 'jas'],
  ['1 Peter', '1 pet', '1pet', 'i peter'],
  ['2 Peter', '2 pet', '2pet', 'ii peter'],
  ['1 John', '1 jn', '1jn', 'i john'],
  ['2 John', '2 jn', '2jn', 'ii john'],
  ['3 John', '3 jn', '3jn', 'iii john'],
  ['Jude'],
  ['Revelation', 'rev', 'rv', 'apoc'],
];

// Build a lookup: lowercased name/alias → canonical display name
const BOOK_LOOKUP = (() => {
  const m = new Map();
  for (const entry of BOOKS) {
    const canonical = entry[0];
    m.set(canonical.toLowerCase(), canonical);
    for (let i = 1; i < entry.length; i++) {
      m.set(entry[i].toLowerCase(), canonical);
    }
  }
  return m;
})();

// Book name regex: optional leading digit ("1 ", "2 ", "3 ", "I ", "II ",
// "III "), then a letter sequence (with optional periods/spaces).
//
// We grab as broadly as possible, then look up the result against
// BOOK_LOOKUP to confirm.
const BOOK_RE = /^\s*((?:[1-3]|[Ii]{1,3})\s*)?([A-Za-z][A-Za-z\.\s]*?)/;

// After the book name, the chapter+verse part. Examples this matches:
//   "3"           → ch=3, no verses
//   "3:16"        → ch=3, verse 16
//   "3:1-10"      → ch=3, verse 1-10
//   "3:1-10, 16"  → ch=3, verses 1-10 + 16
//   "3:1-2:3"     → cross-chapter (we treat this as ch=3:1+ and stop)
//
// We won't parse fully-cross-chapter ranges precisely; we'll just record
// the starting chapter + verses and accept some imprecision.
const CHAPTER_VERSE_RE = /(\d+)(?:\s*:\s*([\d\s,\-–—]+))?/;

// Strip trailing "(NRSVUe)" / "(NIV)" / etc. before parsing.
const TRANSLATION_RE = /\s*\([A-Za-z][A-Za-z0-9 ]*\)\s*$/;

// Parse a single reference string like "John 3:16" into:
//   { book: 'John', chapter: 3, verses: Set<number> | null, raw: 'John 3:16' }
// Returns null if we can't recognize a book.
//
// `verses` is a Set of integers. Null means "whole chapter" (e.g.,
// "John 3" or "Psalm 23"). Empty Set means "we tried but found nothing"
// (treat as whole chapter for overlap purposes).
function parseSingle(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(TRANSLATION_RE, '').trim();
  if (!trimmed) return null;

  // Find book name. Walk char-by-char until we hit the first digit that
  // looks like a chapter number (i.e., a digit preceded by space, NOT a
  // digit that's part of a leading book-number like "1 John").
  // Strategy: try increasingly long book-name prefixes and look them up.
  const lower = trimmed.toLowerCase();
  let bookName = null;
  let restStart = 0;

  // Walk back from the rightmost-likely position.
  // The book ends right before the LAST run of digits in the string —
  // but only if that run is preceded by a space (not part of "1 John").
  // Easier: find the LAST occurrence of " <digit>" or end-of-string.
  for (let i = trimmed.length; i >= 1; i--) {
    const candidate = trimmed.slice(0, i).trim().toLowerCase();
    if (BOOK_LOOKUP.has(candidate)) {
      bookName = BOOK_LOOKUP.get(candidate);
      restStart = i;
      break;
    }
    // Also try without the trailing period
    const noDot = candidate.replace(/\.$/, '');
    if (BOOK_LOOKUP.has(noDot)) {
      bookName = BOOK_LOOKUP.get(noDot);
      restStart = i;
      break;
    }
  }

  if (!bookName) return null;

  const rest = trimmed.slice(restStart).trim();
  if (!rest) {
    // Just a book name. Treat as whole-book reference.
    return { book: bookName, chapter: null, verses: null, raw };
  }

  const m = rest.match(CHAPTER_VERSE_RE);
  if (!m) {
    return { book: bookName, chapter: null, verses: null, raw };
  }
  const chapter = parseInt(m[1], 10);
  const versePart = m[2]?.trim();
  if (!versePart) {
    return { book: bookName, chapter, verses: null, raw };
  }
  // Parse verse spec: "1-10, 16" → set {1,2,3,...,10,16}
  // We CAP at 200 verses to avoid runaway loops on garbled input.
  const verses = new Set();
  for (const part of versePart.split(/\s*,\s*/)) {
    const range = part.split(/\s*[-–—]\s*/);
    if (range.length === 1) {
      const v = parseInt(range[0], 10);
      if (Number.isFinite(v)) verses.add(v);
    } else {
      // Two-part range. If the second part contains ":", we have a
      // cross-chapter range — punt and just take the start verse.
      if (range[1].includes(':')) {
        const v = parseInt(range[0], 10);
        if (Number.isFinite(v)) verses.add(v);
      } else {
        const start = parseInt(range[0], 10);
        const end = parseInt(range[1], 10);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          for (let v = start; v <= end && verses.size < 200; v++) verses.add(v);
        } else if (Number.isFinite(start)) {
          verses.add(start);
        }
      }
    }
  }
  return {
    book: bookName,
    chapter,
    verses: verses.size > 0 ? verses : null,
    raw,
  };
}

// Parse a possibly-multi-ref string into an array of parsed refs.
// Splits on ';' (most common) and ' / ' and ' & '.
//
// Returns [] if nothing parseable.
export function parseRefs(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap((s) => parseRefs(s));
  }
  if (typeof input !== 'string') return [];
  const parts = input.split(/\s*[;\/]\s*|\s+&\s+/);
  const out = [];
  for (const p of parts) {
    const parsed = parseSingle(p);
    if (parsed) out.push(parsed);
  }
  return out;
}

// Compute the overlap tier between a target reference and a candidate
// reference. Returns one of:
//
//   'verse_overlap' — same book + same chapter + at least one shared
//                     verse (or one of them is whole-chapter)
//   'same_chapter'  — same book + same chapter, no verse overlap
//   'same_book'     — same book, different chapter
//   'none'          — different book (or unparseable)
//
// `target` and `candidate` are parsed objects (not raw strings).
export function overlapTier(target, candidate) {
  if (!target || !candidate) return 'none';
  if (target.book !== candidate.book) return 'none';
  // Same book.
  if (target.chapter == null || candidate.chapter == null) {
    // One of them is "whole book". Treat as same_book (we don't know
    // chapter overlap).
    return 'same_book';
  }
  if (target.chapter !== candidate.chapter) return 'same_book';
  // Same chapter. Check verses.
  if (!target.verses || !candidate.verses) {
    // One is "whole chapter". They overlap.
    return 'verse_overlap';
  }
  for (const v of target.verses) {
    if (candidate.verses.has(v)) return 'verse_overlap';
  }
  return 'same_chapter';
}

// Best (strongest) tier between any pair of refs from two lists.
// Used when both target and candidate may be multi-ref strings.
export function bestOverlapTier(targetRefs, candidateRefs) {
  let best = 'none';
  const rank = { verse_overlap: 3, same_chapter: 2, same_book: 1, none: 0 };
  for (const t of targetRefs) {
    for (const c of candidateRefs) {
      const tier = overlapTier(t, c);
      if (rank[tier] > rank[best]) best = tier;
      if (best === 'verse_overlap') return best; // can't beat this
    }
  }
  return best;
}

// Pretty-print a parsed ref, mostly for debugging / display.
export function fmtRef(ref) {
  if (!ref) return '';
  if (ref.chapter == null) return ref.book;
  if (!ref.verses) return `${ref.book} ${ref.chapter}`;
  // Compress consecutive verses into ranges, e.g. {1,2,3,5,6} → "1-3, 5-6"
  const sorted = [...ref.verses].sort((a, b) => a - b);
  const groups = [];
  let start = sorted[0];
  let prev = start;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      groups.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = sorted[i];
      prev = start;
    }
  }
  groups.push(start === prev ? `${start}` : `${start}-${prev}`);
  return `${ref.book} ${ref.chapter}:${groups.join(', ')}`;
}

// Display rank for sorting: stronger tier first.
export const TIER_RANK = {
  verse_overlap: 3,
  same_chapter: 2,
  same_book: 1,
  none: 0,
};

export const TIER_LABELS = {
  verse_overlap: 'Verse overlap',
  same_chapter: 'Same chapter',
  same_book: 'Same book',
  none: 'No match',
};

// Exposed for tests / debugging only.
export const _internal = { parseSingle, BOOK_LOOKUP };
