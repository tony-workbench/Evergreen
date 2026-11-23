// Lint for fact sentences: facts only, no advice, no judgement, no predictions.
// The lists are exported so other seats (store, output, feedback) can reuse them.
import { sentenceProblems, sentencesOf } from '../contract/facts.mjs';
import { ACTIVITY_LABELS_ALL } from './constants.mjs';

export { ACTIVITY_LABELS_ALL };

// Whole words, case-insensitive. "resting" does not match "rest".
export const BANNED_WORDS = [
  'you', 'your', 'yours', 'yourself', 'should', 'shouldn\'t', 'shall', 'must', 'ought', 'try', 'trying', 'rest', 'great', 'good', 'bad', 'better', 'worse',
  'excellent', 'amazing', 'awesome', 'impressive', 'lazy', 'healthy', 'unhealthy', 'ready', 'recovered', 'recover',
  'recovery', 'overreaching', 'overtraining', 'overtrained', 'consider', 'recommend', 'recommended', 'avoid', 'careful',
  'risk', 'risky', 'injury', 'lot', 'lots', 'plenty', 'insufficient', 'excessive', 'pushing', 'improve',
  'improving', 'improved', 'declining', 'worry', 'concern', 'concerning', 'fine', 'normal', 'abnormal',
  'will', 'would', 'likely', 'probably', 'might', 'could', 'expect', 'expected', 'predict', 'forecast', 'projected',
];

// Subsets of BANNED_WORDS that get their own diagnostic category.
export const SECOND_PERSON_WORDS = ['you', 'your', 'yours', 'yourself'];
export const MODAL_WORDS = ['should', "shouldn't", 'shall', 'must', 'ought', 'could', 'would', 'might', 'will'];
export const MODAL_PHRASES = ['need to', 'needs to'];

// Phrases (matched as lower-case substrings on word boundaries).
export const BANNED_PHRASES = [
  'a lot', 'too much', 'too many', 'too little', 'too few', 'need to', 'needs to', 'going to', 'on track', 'keep it up',
  'well done', 'good job', 'next week', 'tomorrow', 'you should', 'let\'s', 'be sure', 'make sure', 'take a', 'in the future',
];

// A sentence that starts with one of these verbs is read as an instruction.
export const IMPERATIVE_STARTS = [
  'take', 'do', 'don\'t', 'try', 'rest', 'stretch', 'aim', 'make', 'keep', 'get', 'go', 'add', 'drink', 'eat', 'sleep', 'run',
  'walk', 'stay', 'avoid', 'increase', 'reduce', 'decrease', 'consider', 'remember', 'focus', 'start', 'stop', 'plan',
  'schedule', 'use', 'let', 'please', 'be', 'push', 'limit', 'skip', 'continue', 'maintain', 'build', 'set', 'give',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole word: not preceded or followed by a letter or apostrophe (no lookbehind, for older JavaScriptCore).
const wordRe = (w) => new RegExp(`(^|[^A-Za-z'])${esc(w)}(?![A-Za-z'])`, 'i');
const WORD_RES = BANNED_WORDS.map((w) => [w, wordRe(w)]);
const PHRASE_RES = BANNED_PHRASES.map((p) => [p, wordRe(p)]);
// Diagnostics are fixed text naming only the rule category. They never contain the matched text (a name such as
// "Will" must not be echoed back).
export const LINT_CATEGORIES = ['second person', 'modal verb', 'banned word', 'banned phrase', 'imperative start', 'no template match'];
const wordCategory = (w) => (SECOND_PERSON_WORDS.includes(w) ? 'second person' : MODAL_WORDS.includes(w) ? 'modal verb' : 'banned word');
const phraseCategory = (p) => (MODAL_PHRASES.includes(p) ? 'modal verb' : 'banned phrase');

// The engine's own sentence templates, keyed by fact id (slot facts share the key "regularity.slot").
// A fact text must match one of the patterns for its id, so nothing else can be said.
const N = String.raw`\d+(?:\.\d+)?`;
const D = String.raw`\d{4}-\d{2}-\d{2}`;
const ACT = `(?:${ACTIVITY_LABELS_ALL.join('|')})`;
const CMP = (unit) => String.raw`(?:equal to|(?:less than )?${N} ${unit} (?:above|below))`;
const PCTP = String.raw`(?:equal|(?:less than )?${N}% (?:above|below))`;
const RATIO = String.raw`(?:0|less than 0\.01|${N})`;
const t = (src) => new RegExp(`^${src}$`);
const WD = '(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)';

export const FACT_TEMPLATES = {
  'history.thin': [t(String.raw`\d+ days? of data; fewer than 14\.`)],
  'coverage.28d': [t(String.raw`Data was logged on \d+ of the last 28 days, so the 28-day load average uses \d+ days?\.`)],
  'volume.today': [t(String.raw`On ${D}: \d+ counted workouts? \(10 minutes or more\) and ${N} workout minutes(?:, \d+ under 10 minutes not counted)?\.`)],
  'volume.today_so_far': [t(String.raw`So far today \(${D}\): \d+ counted workouts? \(10 minutes or more\) and ${N} workout minutes, day not finished(?:, \d+ under 10 minutes not counted)?\.`)],
  'volume.today_unlogged': [t(String.raw`${D} has no data: 0 of 1 days logged\.`), t(String.raw`${D} has no data so far: 0 of 1 days logged\.`)],
  'volume.week': [t(String.raw`Counted in the last 7 days \(${D} to ${D}; workouts of 10 minutes or more\): \d+ workouts? and ${N} workout minutes on \d+ logged days? \(\d+ unlogged days?\)(?:, \d+ under 10 minutes not counted)?\.`)],
  'volume.28d': [t(String.raw`Counted in the last 28 days \(${D} to ${D}; workouts of 10 minutes or more\): \d+ workouts? and ${N} workout minutes on \d+ logged days? \(\d+ unlogged days?\)(?:, \d+ under 10 minutes not counted)?\.`)],
  'past.week_comparisons_skipped': [t(String.raw`Comparisons of the last 7 days with earlier weeks or a target are not stated: only \d+ of 7 days are logged\.`)],
  'past.today_vs_avg': [
    t(String.raw`${N} workout minutes on ${D}, ratio ${RATIO} to the daily average of ${N} minutes over the previous 28 days \(\d+ logged days?(?:, ${PCTP})?\)\.`),
    t(String.raw`${N} workout minutes on ${D}; the daily average over the previous 28 days is ${N} minutes \(ratio 0, \d+ logged days?\)\.`),
    t(String.raw`${N} workout minutes on ${D}; the daily average over the previous 28 days is ${N} minutes, so the ratio is not defined \(\d+ logged days?\)\.`),
  ],
  'past.today_vs_highest': [t(String.raw`The workout minutes on ${D} \(${N}\) are ${N}x the highest recorded day of the previous 28 days \(${N}\)\.`)],
  'past.today_rank': [t(String.raw`The workout minutes on ${D} \(${N}\) rank \d+ of \d+ logged days? in the last 28 days, where 1 is the highest\.`)],
  'past.week_vs_avg': [
    t(String.raw`${N} workout minutes in the last 7 days, ratio ${RATIO} to the 4-week average of ${N} minutes per week \(\d+ logged days? before this week(?:, ${PCTP})?\)\.`),
    t(String.raw`${N} workout minutes in the last 7 days; the 4-week average is ${N} minutes per week \(ratio 0, \d+ logged days? before this week\)\.`),
    t(String.raw`${N} workout minutes in the last 7 days; the 4-week average is ${N} minutes per week, so the ratio is not defined \(\d+ logged days? before this week\)\.`),
  ],
  'past.week_rank': [t(String.raw`This week's workout minutes \(${N}\) rank \d+ of \d+ complete 7-day weeks? in the last 12 weeks, where 1 is the highest\.`)],
  'load.ratio': [
    t(String.raw`The minutes-based 7-day load is ${N} minutes, ratio ${RATIO} to the 28-day weekly average of ${N} minutes \(\d+ logged days?(?:, ${PCTP})?\)\.`),
    t(String.raw`The effort-weighted 7-day load is ${N} effort-minutes, ratio ${RATIO} to the 28-day weekly average of ${N} effort-minutes \(\d+ logged days?(?:, ${PCTP})?\)\.`),
  ],
  'regularity.days_since_last': [
    t(String.raw`Days since the last counted workout \(10 minutes or more\) as of ${D}: \d+ \(${D}\); \d+ counted workouts? in the last 28 days\.`),
    t(String.raw`No counted workout in the last 28 days as of ${D}: 0 workouts\.`),
  ],
  'regularity.longest_gap': [t(String.raw`Longest stretch of logged days without a counted workout \(10 minutes or more\) in the last \d+ days: \d+ days? \(\d+ unlogged days? in the window\)\.`)],
  'regularity.per_week': [t(String.raw`Counted workouts \(10 minutes or more\) in each of the last \d+ weeks \(7-day blocks, most recent first\): \d+(?:, \d+)*; logged days in those weeks: \d+(?:, \d+)*\.`)],
  'regularity.slot': [t(String.raw`Fixed slot among recognised activities: ${ACT} on ${WD} between (?:\d{2}:00 and \d{2}:00|23:00 and 00:00 the next day), in \d+ of the last 4 weeks\.`)],
  'regularity.slots_none': [t(String.raw`Fixed slots among recognised activities \(same activity, weekday and hour in 3 of the last 4 weeks\) found: 0\.`)],
  'mix.count': [
    t(String.raw`Counted workouts \(10 minutes or more\) by activity in the last 28 days: ${ACT} \d+(?:, ${ACT} \d+)*\.`),
    t(String.raw`No counted workouts \(10 minutes or more\) by activity in the last 28 days \(0 workouts\)\.`),
  ],
  'mix.median_length': [t(String.raw`Median length of counted workouts \(10 minutes or more\) by activity in the last 28 days: ${ACT} ${N} min(?:, ${ACT} ${N} min)*\.`)],
  'mix.start_bands': [t(String.raw`Counted workout starts \(10 minutes or more\) in the last 28 days: morning \d+, afternoon \d+, evening \d+ \(morning is before 12:00, evening from 17:00\)\.`)],
  'body.sleep': [t(String.raw`Average sleep over the last 7 days: ${N} h \(from \d+ nights\), ${CMP('h')} the 28-day average of ${N} h \(from \d+ nights\)\.`)],
  'body.resting_hr': [t(String.raw`Average resting heart rate over the last 7 days: ${N} bpm \(from \d+ days with a reading\), ${CMP('bpm')} the 28-day average of ${N} bpm \(from \d+ days with a reading\)\.`)],
  'goal.workouts_per_week': [t(String.raw`\d+ counted workouts? \(10 minutes or more\) in the last 7 days; the baseline is ${N} counted workouts per week over the 28 days before this week \(\d+ logged days?\)(?:, a ratio of ${N})?\.`)],
  'goal.target_progress': [t(String.raw`Progress to the target of ${N} workouts per week: \d+ counted workouts? \(10 minutes or more\) in the last 7 days, ratio ${RATIO} to the target(?: \(${N}% of the target\))?\.`)],
};

// The brief's sentences (src/memory/brief.mjs), keyed by line id; `usual_times` is the one text line that joins the fixed slots.
const LABEL = '(?:[A-Z][a-z]+(?: [a-z]+)*|HIIT)';
const CLOCK = '(?:1[0-2]|[1-9]) (?:AM|PM)';
const WEEKS = String.raw`\((?:3|4|3 or 4) of the last 4 weeks\)`;
export const BRIEF_TEMPLATES = {
  thin: [t(String.raw`\d+ days? of data(?:, fewer than 14)?\.`)],
  workouts_per_week: [t(String.raw`Workouts: ${N} a week \(4-week average\)\.`)],
  usual_time: [t(`${LABEL} ${WD} ${CLOCK} ${WEEKS}\\.`)],
  usual_times: [t(`Usual times: ${LABEL} ${WD} ${CLOCK}(?:, (?:${LABEL} )?${WD} ${CLOCK}){0,2} ${WEEKS}\\.`)],
  mix: [t(String.raw`Mix over 4 weeks: ${LABEL} \d+(?:, ${LABEL} \d+){0,3}(?:, \d+ in \d+ other types?)?\.`)],
  recent_weeks: [t(String.raw`Last [1-4] fully logged weeks?: \d+(?:, \d+){0,3} workouts\.`)],
  load: [t(String.raw`Load: \d+ (?:min|effort-min) in the last 7 days, ${RATIO}× the 28-day weekly average\.`)],
  sleep: [t(String.raw`Average sleep: ${N} h a night over 7 days \(28-day average ${N} h\)\.`)],
  resting_hr: [t(String.raw`Resting heart rate: \d+ bpm over 7 days \(28-day average \d+ bpm\)\.`)],
};

const templateKey = (id) => (id.startsWith('regularity.slot.') ? 'regularity.slot' : id);

// Word-level lint only (banned words and phrases anywhere, imperative sentence starts, one sentence with a number).
// Other seats whose facts have their own wording can use this, or pass their own templates to lintFact.
export function lintWords(text) {
  const problems = [...sentenceProblems(text)];
  if (typeof text !== 'string') return problems;
  for (const [w, re] of WORD_RES) if (re.test(text)) problems.push(wordCategory(w));
  for (const [p, re] of PHRASE_RES) if (re.test(text)) problems.push(phraseCategory(p));
  for (const sentence of sentencesOf(text)) {
    const first = sentence.split(/[\s,:;]+/)[0].toLowerCase();
    if (IMPERATIVE_STARTS.includes(first)) problems.push('imperative start');
  }
  return [...new Set(problems)];
}

// Full lint: word lint plus the template check. options.id restricts the match to that fact id's templates;
// options.templates replaces the engine's table (same shape: id -> array of anchored RegExp).
export function lintFact(text, options = {}) {
  const problems = lintWords(text);
  if (typeof text !== 'string') return problems;
  const table = options.templates || FACT_TEMPLATES;
  const pools = options.id ? table[templateKey(options.id)] || [] : Object.values(table).flat();
  if (!pools.some((re) => re.test(text))) problems.push('no template match');
  return problems;
}
