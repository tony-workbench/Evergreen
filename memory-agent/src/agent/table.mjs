// The daily table for the recommendation agent: only memories in use (saved or confirmed, not stopped, not expired),
// ranked, at most 25 rows and 200 words. Row: { memoryId, key, slot, group, kind, statement, data, state, confidence, since, updated }.
// `key` is opaque and stable: pass it to memoryReject to stop the row. Everything a consumer needs is in `data`, by `kind`.
import { USABLE, CONFIRMED, GROUPS, groupOf, EXPIRE_DAYS, TABLE_MAX_ROWS, TABLE_MAX_WORDS } from './schema.mjs';
import { addDays } from './evidence.mjs';

export const tableWords = (text) => text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const HEAD = '| Slot | What | Since | Sure? |\n| --- | --- | --- | --- |';
const line = (r) => `| ${r.slot} | ${r.statement} | ${r.since} | ${r.state === CONFIRMED ? 'confirmed' : 'likely'} |`;
const render = (rows) => [HEAD, ...rows.map(line)].join('\n');

/** { ok, day, rows, text, words, leftOut }. Ranked: confirmed first, then by group, days of evidence, confidence and slot. */
export function memoryTable(state, day) {
  if (state.off) return { ok: true, day, rows: [], text: '', words: 0, leftOut: 0 };
  const limit = addDays(day, -EXPIRE_DAYS);
  const ranked = state.memories.filter((m) => USABLE.includes(m.state) && !state.stopped[m.slot] && m.updated >= limit).map((m) => {
    const v = m.versions[m.versions.length - 1];
    const days = new Set(m.versions.flatMap((x) => x.evidence.map((r) => r.day))).size;
    return { days, row: { memoryId: m.id, key: m.slot, slot: m.slot, group: groupOf(m.slot), kind: m.kind, statement: v.statement, data: v.data, state: m.state, confidence: v.confidence, since: m.since, updated: m.updated } };
  }).sort((a, b) => (a.row.state === b.row.state ? 0 : a.row.state === CONFIRMED ? -1 : 1) || GROUPS.indexOf(a.row.group) - GROUPS.indexOf(b.row.group)
    || b.days - a.days || b.row.confidence - a.row.confidence || (a.row.slot < b.row.slot ? -1 : 1));
  const rows = ranked.slice(0, TABLE_MAX_ROWS).map((r) => r.row);
  while (rows.length > 0 && tableWords(render(rows)) > TABLE_MAX_WORDS) rows.pop();
  const text = rows.length === 0 ? '' : render(rows);
  return { ok: true, day, rows, text, words: tableWords(text), leftOut: ranked.length - rows.length };
}
