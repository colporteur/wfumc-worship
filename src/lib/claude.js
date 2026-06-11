// Claude integration for the Worship Planning app.
//
// Routes through the same `claude-proxy` Edge Function the bulletin and
// sermon apps use. The proxy is auth-gated (any authenticated user) and
// pulls the Anthropic key from public.church_settings server-side, so
// the key never leaves the server.

import { supabase, withTimeout } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// Cheap, fast model for the short summarization jobs this app needs
// (text descriptions, sermon main points). The proxy's default model
// is Sonnet; we override per-call.
export const LOW_COST_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Low-level proxy call. Mirrors the sermon app's callClaude.
 * @param {Object} body { messages, system?, max_tokens?, model? }
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=60000]
 */
export async function callClaude(body, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not signed in');
  }
  let res;
  try {
    res = await withTimeout(
      fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }),
      timeoutMs
    );
  } catch (e) {
    if (String(e?.message || '').includes('Request timed out')) {
      throw new Error(
        `Claude took longer than ${Math.round(timeoutMs / 1000)}s to respond. Try again.`
      );
    }
    throw e;
  }
  if (!res.ok) {
    const errBody = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(errBody);
    } catch {
      parsed = null;
    }
    const apiMessage =
      parsed?.error?.message ||
      parsed?.message ||
      (typeof parsed === 'string' ? parsed : '');
    const apiType = parsed?.error?.type || '';
    if (apiType === 'overloaded_error' || res.status === 529) {
      throw new Error(
        "Anthropic's API is temporarily overloaded. Wait a minute and try again."
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Claude proxy refused the request. Make sure you are signed in and the Anthropic API key is set in church_settings.'
      );
    }
    if (apiMessage) {
      throw new Error(`Claude error (${res.status}): ${apiMessage}`);
    }
    throw new Error(`Claude proxy error ${res.status}: ${errBody}`);
  }
  return res.json();
}

/** Pulls the first text block out of a Claude /messages response. */
function extractText(response) {
  const block = response?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

/**
 * Best-effort JSON-array extraction. Claude sometimes wraps JSON in
 * prose or code fences; pull out the first [...] block.
 */
function parseJsonArrayLoose(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Worship-doc summarization helpers
// ---------------------------------------------------------------------

/**
 * Batch-summarize scripture texts into very short descriptions for the
 * "Text Description" column of the planning Word doc.
 *
 * One Claude call for the whole batch — references are short, and the
 * model knows the passages, so there's no need for per-week calls.
 *
 * @param {Array<{key: string, reference: string}>} items
 * @returns {Object} map of key → description (missing keys = no answer)
 */
export async function summarizeTextDescriptions(items) {
  if (!items || items.length === 0) return {};
  const list = items
    .map((it, i) => `${i + 1}. [${it.key}] ${it.reference}`)
    .join('\n');
  const system =
    'You are helping a United Methodist pastor build a worship-planning grid. ' +
    'For each scripture reference, write an extremely brief description of the ' +
    "passage's content — 20 words MAXIMUM, fewer is better (5-12 words is ideal). " +
    'Telegraphic style is fine; no need for complete sentences. ' +
    'If a line contains multiple readings (e.g. "OT: ... / NT: ..."), describe each ' +
    'part briefly with the same prefixes, still within the word budget. ' +
    'Respond with ONLY a JSON array: [{"key": "...", "description": "..."}]. ' +
    'Use the exact key shown in [brackets] for each item.';
  const res = await callClaude({
    model: LOW_COST_MODEL,
    system,
    max_tokens: 2048,
    messages: [{ role: 'user', content: list }],
  });
  const arr = parseJsonArrayLoose(extractText(res));
  const out = {};
  for (const row of arr ?? []) {
    if (row?.key && typeof row.description === 'string') {
      out[row.key] = row.description.trim();
    }
  }
  return out;
}

/**
 * Summarize one sermon's main point for the "Sermon Main Point" column.
 * 30 words max, fewer is better. Uses the manuscript when available,
 * falling back to title/theme.
 *
 * @param {Object} sermon { title?, theme?, scripture_reference?, manuscript_text? }
 * @returns {string} the summary ('' if there was nothing to summarize)
 */
export async function summarizeSermonMainPoint(sermon) {
  const manuscript = (sermon?.manuscript_text || '').trim();
  const title = (sermon?.title || '').trim();
  const theme = (sermon?.theme || '').trim();
  if (!manuscript && !title && !theme) return '';

  // Keep the prompt cheap — the opening + closing of a manuscript carry
  // the thesis; we don't need the whole thing for a one-line summary.
  const MAX_CHARS = 14000;
  let body = manuscript;
  if (manuscript.length > MAX_CHARS) {
    const head = manuscript.slice(0, MAX_CHARS * 0.7);
    const tail = manuscript.slice(-MAX_CHARS * 0.3);
    body = `${head}\n\n[... middle of manuscript omitted ...]\n\n${tail}`;
  }

  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (sermon?.scripture_reference) parts.push(`Scripture: ${sermon.scripture_reference}`);
  if (theme) parts.push(`Theme: ${theme}`);
  if (body) parts.push(`Manuscript:\n${body}`);

  const system =
    'You are helping a United Methodist pastor build a worship-planning grid. ' +
    "State the sermon's main point in 30 words MAXIMUM — fewer is better " +
    '(10-20 words is ideal). One sentence, no preamble, no quotation marks. ' +
    'Respond with ONLY the summary sentence.';
  const res = await callClaude(
    {
      model: LOW_COST_MODEL,
      system,
      max_tokens: 256,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    },
    { timeoutMs: 45000 }
  );
  return extractText(res).trim();
}
