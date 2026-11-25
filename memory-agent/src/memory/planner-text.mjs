// The full planner view of the memory. The default text is the brief (brief.mjs); this long form is the optional full text.
//
// Pinned files in full (profile, preferences); rolling as 12 weekly lines, the latest 7 daily lines and a line with the
// number of lines left out; feedback and history only as a path and a count. If the text is over the hard limit, the oldest
// daily lines and then the oldest weekly lines are dropped and the line says how many. If the memory cannot answer safely
// (a half-finished change that cannot be completed, an invalid file) the result is an error and carries no text.
import { recover, FILE_KINDS, canonicalOrder } from '../store/index.mjs';

export const DAILY_SHOWN = 7;
export const WEEKLY_SHOWN = 12;
export const TARGET_WORDS = 450;
export const MAX_WORDS = 600;

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const lines = (facts) => facts.map((f) => `- ${f.text}`);

/** Every memory file's facts in canonical order: { ok: true, files } or { ok: false, error }. Throws on an invalid file. */
export function memoryFiles(store) {
  if (!recover(store).ok) return { ok: false, error: 'memory is not available: a half-finished change is pending' };
  const files = {};
  for (const name of Object.keys(FILE_KINDS)) {
    const doc = store.read(name);
    if (doc !== null) files[name] = canonicalOrder(name, doc.facts, []).facts;
  }
  return { ok: true, files };
}

/** { ok: true, text, words, targetMet, leftOut: { daily, weekly } } or { ok: false, error } (no text). Same store state, same text. */
export function plannerText(store) {
  try {
    const read = memoryFiles(store);
    if (!read.ok) return read;
    const { files } = read;
    const render = (nDaily, nWeekly) => {
      const out = ['Memory facts (counts and dates only)'];
      for (const name of ['profile', 'preferences']) {
        if (files[name]) out.push(`## ${FILE_KINDS[name].path} (${files[name].length} facts)`, ...lines(files[name]));
      }
      const roll = files.rolling;
      if (roll) {
        const daily = roll.filter((f) => f.kind === 'daily');
        const weekly = roll.filter((f) => f.kind === 'weekly');
        const rest = roll.filter((f) => f.kind !== 'daily' && f.kind !== 'weekly');
        const left = { daily: daily.length - Math.min(nDaily, daily.length), weekly: weekly.length - Math.min(nWeekly, weekly.length) };
        out.push(`## ${FILE_KINDS.rolling.path} (${roll.length} facts)`, ...lines(weekly.slice(left.weekly)),
          ...lines(daily.slice(left.daily)), ...lines(rest),
          `- ${FILE_KINDS.rolling.path}: ${left.daily} earlier daily lines and ${left.weekly} earlier weekly lines not shown`);
        render.left = left;
      }
      const others = ['feedback', 'history'].filter((n) => files[n]);
      if (others.length) out.push(`## Other memory files (${others.length} files)`, ...others.map((n) => `- ${FILE_KINDS[n].path}: ${files[n].length} facts`));
      return out.join('\n');
    };
    let nDaily = DAILY_SHOWN;
    let nWeekly = WEEKLY_SHOWN;
    let text = render(nDaily, nWeekly);
    while (words(text) > MAX_WORDS && (nDaily > 0 || nWeekly > 0)) {
      if (nDaily > 0) nDaily--; else nWeekly--;
      text = render(nDaily, nWeekly);
    }
    if (words(text) > MAX_WORDS) return { ok: false, error: 'memory text is too long even without rolling lines' };
    return { ok: true, text, words: words(text), targetMet: words(text) <= TARGET_WORDS, leftOut: render.left ?? { daily: 0, weekly: 0 } };
  } catch (e) {
    return { ok: false, error: String(e && e.name ? e.name : 'Error') };
  }
}
export { plannerText as fullText };
