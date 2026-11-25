// The rules reader: turns one sentence into a small intent, with no model. It knows fitness words (activities, lengths,
// times of day) and five things a person asks for: add, move, resize, cancel, and plan back from a race day.
// A sentence it cannot read as one of these is { kind: 'none' }; it never guesses.
import { parseMinutes, parseDay, dayStart, weekStart, ms, D, WINDOW, AWAKE_END } from './core.mjs';

// The closed activity list every agent and the app share (contract/AGENTS.md).
export const ACTIVITIES = {
  long_run: { title: 'Long run', minutes: 90, noun: 'long run' },
  run: { title: 'Run', minutes: 45, noun: 'run' },
  walk: { title: 'Walk', minutes: 30, noun: 'walk' },
  strength: { title: 'Strength', minutes: 40, noun: 'strength session' },
  yoga: { title: 'Yoga', minutes: 30, noun: 'yoga session' },
  ride: { title: 'Ride', minutes: 60, noun: 'ride' },
  swim: { title: 'Swim', minutes: 45, noun: 'swim' },
  stretch: { title: 'Stretch', minutes: 15, noun: 'stretch' },
  elliptical: { title: 'Elliptical', minutes: 40, noun: 'elliptical session', indoor: true },
  // Anything not named above. Only the app or the agent sends it; the rules reader never makes one up.
  other: { title: 'Workout', minutes: 30, noun: 'workout' },
  rest: { title: 'Rest day', minutes: 0, noun: 'rest day' },
};

// Order matters: "stretch after my run" is a stretch, "long run" is not a plain run.
const SPOKEN = [
  ['long_run', /\blong\s+(?:run|jog)\b/],
  ['rest', /\brest\s+day\b|\bday\s+off\b|\b(?:take|need|want|schedule|add|plan)\s+(?:a\s+|some\s+)?rest\b/],
  ['stretch', /\bstretch(?:ing|es)?\b|\bmobility\b/],
  ['yoga', /\byoga\b/],
  ['elliptical', /\b(?:elliptical|cross[- ]?trainer)\b/],
  ['strength', /\b(?:strength|weights?|gym|lift(?:ing)?)\b/],
  ['swim', /\bswim(?:ming)?\b/],
  ['ride', /\b(?:ride|cycle|cycling|bike|biking|spin)\b/],
  ['walk', /\b(?:walk|walking|hike)\b/],
  ['run', /\b(?:run|runs|running|jog|jogging)\b/],
  ['strength', /\b(?:work\s?out|exercise|training session)\b/],
];
// "A workout" names no activity: it is planned as strength, and it matches any workout when one is looked for.
const generic = (text) => /\b(?:work\s?out|exercise|training session)\b/.test(text) && !/\b(?:strength|weights?|gym|lift(?:ing)?)\b/.test(text) && detectActivity(text) === 'strength';
export const detectActivity = (text) => SPOKEN.find(([, re]) => re.test(text))?.[0] ?? null;

// An activity from the app: one of the closed list, or a Health name for one ("Running", "TraditionalStrengthTraining"). Else null.
export function normalizeActivity(name, title = '') {
  if (Object.hasOwn(ACTIVITIES, name)) return name;
  const t = `${name ?? ''} ${title}`.toLowerCase().replace(/[^a-z]/g, '');
  if (/long(run|jog)/.test(t)) return 'long_run';
  if (/run|jog/.test(t)) return 'run';
  if (/walk|hik/.test(t)) return 'walk';
  if (/strength|weight|gym|lift/.test(t)) return 'strength';
  if (/yoga/.test(t)) return 'yoga';
  if (/cycl|bik|ride|spin/.test(t)) return 'ride';
  if (/swim/.test(t)) return 'swim';
  if (/stretch|mobility|flexib/.test(t)) return 'stretch';
  if (/elliptical|crosstrainer/.test(t)) return 'elliptical';
  return /rest/.test(t) ? 'rest' : null;
}

// ---- time hints ----
const PARTS = [
  [/\bbefore (?:work|breakfast)\b|\bfirst thing\b/, { lo: 360, hi: 540, special: 'before work', am: true }],
  [/\bafter work\b/, { lo: 1020, hi: 1320, special: 'after work', pm: true }],
  [/\bbefore lunch\b/, { lo: 540, hi: 720, special: 'before lunch', am: true }],
  [/\bafter lunch\b/, { lo: 780, hi: 1020, special: 'after lunch', pm: true }],
  [/\bbefore dinner\b/, { lo: 900, hi: 1110, special: 'before dinner', pm: true }],
  [/\bafter dinner\b/, { lo: 1170, hi: 1320, special: 'after dinner', pm: true }],
  [/\b(?:lunch(?:time|\s+break)?|midday|noon)\b/, { lo: 690, hi: 810, special: 'at lunch', meals: false }],
  [/\bmorning\b/, { lo: 360, hi: 720, part: 'morning', am: true }],
  [/\bafternoon\b/, { lo: 720, hi: 1020, part: 'afternoon', pm: true }],
  [/\b(?:evening|tonight|night)\b/, { lo: 1020, hi: 1320, part: 'evening', pm: true }],
];
const CLOCK = /\b(after|before|by|at|around|about|from)\s+(\d{1,2})(?::(\d\d))?\s*(am|pm|a\.m\.?|p\.m\.?)?(?![\d:]|\s*(?:min|hours?\b|hrs?\b|st\b|nd\b|rd\b|th\b|k\b|days?\b|weeks?\b|more\b|miles?\b|km\b))/;
const BARE_CLOCK = /\b(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/;

export function clock(minutes) {
  const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// Without am or pm: "after 6" is the evening, "before 9" and "at 7" are the morning, unless a part of the day says otherwise.
function hourOf(word, h, suffix, part) {
  if (h > 12 || suffix) return suffix && /^p/.test(suffix) ? (h % 12) + 12 : suffix ? h % 12 : h;
  if (h === 12) return 12;
  if (part?.am) return h;
  if (part?.pm) return h + 12;
  return (word === 'after' || word === 'from' ? h <= 8 : h <= 4) ? h + 12 : h;
}

// Reads the day and the time of day out of a piece of text.
// -> { day, span, lo, hi, pad, exact, meals, clockLabel, special, part, any, timed, past }
export function parseHint(text, nowMs, { bareNumber = false } = {}) {
  const t = text.toLowerCase(), today0 = dayStart(nowMs), week0 = weekStart(nowMs);
  const hint = { day: null, span: 1, lo: null, hi: null, pad: false, exact: false, meals: true, clockLabel: null, special: null, part: null, past: /\byesterday\b/.test(t) };
  const weekend = t.match(/\b(next\s+)?weekend\b/);
  if (weekend) {
    const sat = week0 + 5 * D + (weekend[1] ? 7 * D : 0);
    hint.day = Math.max(sat, today0); hint.span = (sat + 2 * D - hint.day) / D;
  } else if (/\bnext week\b/.test(t)) { hint.day = week0 + 7 * D; hint.span = 7; }
  else if (/\bthis week\b/.test(t)) { hint.day = today0; hint.span = (week0 + 7 * D - today0) / D; }
  else hint.day = parseDay(t, nowMs);
  const part = PARTS.find(([re]) => re.test(t))?.[1] ?? null;
  if (part) Object.assign(hint, { lo: part.lo, hi: part.hi, special: part.special ?? null, part: part.part ?? null, meals: part.meals ?? true });
  let c = t.match(CLOCK), word = c?.[1];
  if (!c) { c = t.match(BARE_CLOCK); if (c) { c = [c[0], 'at', c[1], c[2], c[3]]; word = 'at'; } }
  if (!c && bareNumber) { const n = t.match(/^\s*(?:the\s+)?(\d{1,2})(?::(\d\d))?\s*$/); if (n) { c = [n[0], 'at', n[1], n[2], undefined]; word = 'at'; } }
  if (c && +c[2] <= 23 && +(c[3] ?? 0) <= 59) {
    const m = hourOf(word, +c[2], c[4], part) * 60 + +(c[3] ?? 0);
    if (word === 'after' || word === 'from') Object.assign(hint, { lo: m, hi: m >= 1200 ? AWAKE_END : part && part.hi > m ? part.hi : WINDOW[1], clockLabel: `after ${clock(m)}`, special: null });
    else if (word === 'before' || word === 'by') Object.assign(hint, { lo: part && part.lo < m ? part.lo : WINDOW[0], hi: m, clockLabel: `before ${clock(m)}`, special: null });
    else if (word === 'at') Object.assign(hint, { lo: m, hi: m, pad: true, exact: true, meals: false, clockLabel: `at ${clock(m)}`, special: null });
    else Object.assign(hint, { lo: Math.max(m - 30, 0), hi: m + 30, pad: true, meals: false, clockLabel: `around ${clock(m)}`, special: null });
  }
  hint.timed = hint.lo !== null;
  hint.any = hint.timed || hint.day !== null;
  return hint;
}

// ---- which workout is meant ----
const POSSESSIVE = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this (?:morning|afternoon|evening))'s\b/;

// -> { block } or { missing: text }. Names win over guesses: an activity and a day must both match;
// with only an activity it is the next one coming up; with neither it is the block the talk is about.
function findTarget(part, whole, ctx, dayFromPart) {
  const act = detectActivity(part) ?? detectActivity(whole), poss = whole.match(POSSESSIVE);
  const day = poss ? parseDay(poss[1], ctx.nowMs) : dayFromPart ? parseDay(part, ctx.nowMs) : null;
  const live = ctx.blocks.filter((b) => !b.cancelled && !b.allDay && ms(b.end) > ctx.nowMs).sort((a, b) => ms(a.start) - ms(b.start));
  if (!act && day === null) {
    const one = ctx.primary ? live.find((b) => b.id === ctx.primary) : live.length === 1 ? live[0] : null;
    return one ? { block: one } : { missing: 'I am not sure which workout you mean. Name it, for example "Sunday\'s long run".' };
  }
  const pool = day === null ? live : live.filter((b) => dayStart(ms(b.start)) === day);
  let found = pool;
  if (act && !generic(part) && !(part !== whole && !detectActivity(part) && generic(whole))) {
    found = pool.filter((b) => b.activity === act);
    if (!found.length && act === 'run') found = pool.filter((b) => b.activity === 'long_run');
  }
  if (found.length) return { block: found[0] };
  const what = act && !generic(whole) ? ACTIVITIES[act].noun : 'workout', an = /^[aeiou]/.test(what) ? 'an' : 'a';
  return { missing: `I could not find ${an} ${what}${day !== null ? ` ${ctx.onDay(day)}` : ''} in your plan.` };
}

// ---- the five requests ----
const CANCEL = /\b(?:skip(?:ping)?|cancel|drop|delete|remove|scrap|call off|(?:can'?t|cannot|won'?t) (?:make|do|run|go)|too tired for)\b|^no\s/;
const MANY = /\b(?:every|each|daily|twice|\d+ times|(?:two|three|four|five) times|everything|all my)\b/;
const SWAP = /\b(?:swap|switch)\b/;
const DAYS_OFF = /\b(an?|one|two|three|\d)\s+days?\s+(later|earlier|sooner)\b/;
const RESIZE = /\b(?:shorten|lengthen|extend|trim|longer|shorter|cut short)\b/;
const MAKE = /\b(?:make|cut|change)\b/;
const ADD_TO = /\badd\s+(?:another\s+)?[\w\s-]*?(?:minutes?|mins?|hours?)\s+(?:to|onto)\b|\b\d+\s+(?:more|extra)\s+min/;
const MOVE = /\b(?:move|push|shift|reschedule|bump|slide|change|delay|postpone|bring|instead)\b/;
const SOFT = /\b(?:not (?:that|so) (early|late)|too (early|late))\b/;
const DIRECTION = /\b(later|earlier|sooner|back|forward)\b/;
const RACE = /\b(?:race|marathon|half[- ]marathon|triathlon|parkrun)\b|\b(?:my|i have a|i've got a|signed up for a)\s+(?:5k|10k)\b/;
const RELATIVE = /\b(?:back|forward|up)\s+(?:by\s+)?(?:\d+|an?|half|one|two)\b|\b(?:minutes?|mins?|hours?|hrs?)\s+(?:later|earlier|sooner)\b|\bby\s+(?:\d+|an?|half|one|two)\s/;
const BARE_NO = /^(?:i|i'm|my|we|it|the|that|this|he|she|they|you)\b|\b(?:is|are|love|like|hate|enjoy)\b/;
const STRONG = /\b(?:find|schedule|book|block|fit|squeeze in|carve out|set aside|make time|time for|put|plan|add|pencil in|slot in)\b/;
const WEAK = /\b(?:need to|have to|want to|wanna|can you|could you|help me|remind|go for|go to|hit the|i'd like to|i would like to|let's|i should|gotta|need a|want a|when can)\b/;
const PAST = /\b(?:yesterday|last (?:night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|ran|walked|swam|rode|did|went|felt|finished|completed)\b/;
const QUESTION = /^(?:what|why|who|where|how (?:many|much|far|long|fast|do|did|is|was|should)|is|are|was|were|does|did|should)\b/;


const NOT_A_REQUEST = 'I can plan workouts: try "find me 45 minutes for a run after 6" or "move Sunday\'s long run to the afternoon".';
const none = (message = NOT_A_REQUEST) => ({ kind: 'none', message });

// Where a move should go: the text after "to", or the whole sentence without the day that names the workout.
function destination(t, ctx) {
  let cutAt = -1;
  for (const m of t.matchAll(/\b(?:to|till|until|for)\b/g)) if (parseHint(t.slice(m.index + m[0].length), ctx.nowMs, { bareNumber: true }).any) cutAt = m.index;
  if (cutAt >= 0) {
    const tail = t.slice(cutAt).replace(/^\w+\s*/, '');
    return { source: t.slice(0, cutAt), split: true, tail, hint: parseHint(tail, ctx.nowMs, { bareNumber: true }) };
  }
  const tail = t.replace(POSSESSIVE, ' ').replace(/\binstead of .*$/, ' ');
  return { source: t, split: false, tail, hint: parseHint(tail, ctx.nowMs) };
}

// ctx: { nowMs, blocks, primary, awaiting, onDay }
export function read(request, ctx) {
  const t = String(request ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  if (!t) return none();
  if (ctx.awaiting === 'race' && !RACE.test(t)) {
    const day = parseDay(t, ctx.nowMs);
    if (day !== null) return { kind: 'race', day };
  }
  const act = detectActivity(t), names = Boolean(act) || POSSESSIVE.test(t) || /\b(?:it|that|this one)\b/.test(t);
  if (MANY.test(t)) return none('I plan one workout at a time, and repeats are not supported yet.');
  if (SWAP.test(t)) return none('I cannot swap two workouts yet. Move them one at a time.');

  if (CANCEL.test(t)) {
    if (!names) return none('I can only skip workouts. Name one, for example "skip Thursday\'s strength".');
    const tg = findTarget(t, t, ctx, true);
    return tg.block ? { kind: 'cancel', target: tg.block.id } : none(tg.missing);
  }

  const minutes = parseMinutes(t);
  if (!/\bmake (?:time|room|space)\b/.test(t) && (RESIZE.test(t) || ADD_TO.test(t) || (MAKE.test(t) && minutes !== null && names))) {
    const tg = findTarget(t, t, ctx, true);
    if (!tg.block) return none(tg.missing);
    const less = /\b(?:shorten|trim|shorter|cut short|fewer|less)\b/.test(t), more = /\b(?:lengthen|extend|longer|more|extra)\b/.test(t) || ADD_TO.test(t);
    const relative = ADD_TO.test(t) || /\bby\s+(?:\d|an?\s|half)/.test(t) || /\b(?:minutes?|mins?|hours?)\s+(?:longer|shorter|more|less)\b/.test(t) || minutes === null;
    if (relative) return { kind: 'resize', target: tg.block.id, delta: (less ? -1 : 1) * (minutes ?? 15) };
    if (!less && !more && !MAKE.test(t)) return none();
    return { kind: 'resize', target: tg.block.id, minutes };
  }

  const soft = t.match(SOFT), direction = t.match(DIRECTION)?.[1];
  if ((MOVE.test(t) && names) || soft || (direction && names && !STRONG.test(t) && (ctx.primary || POSSESSIVE.test(t)))) {
    const dest = destination(t, ctx), tg = findTarget(dest.source, t, ctx, dest.split);
    if (!tg.block) return none(tg.missing);
    const move = { kind: 'move', target: tg.block.id, hint: dest.hint, relative: null, soft: null };
    const length = parseMinutes(dest.tail);
    const off = t.match(DAYS_OFF);
    if (off) move.relative = (off[2] === 'later' ? 1 : -1) * ({ a: 1, an: 1, one: 1, two: 2, three: 3 }[off[1]] ?? +off[1]) * 1440;
    else if (soft) move.soft = (soft[1] ?? soft[2]) === 'early' ? 'later' : 'earlier';
    else if (RELATIVE.test(t) && length !== null) move.relative = (/\b(?:earlier|sooner|forward|up)\b/.test(t) ? -1 : 1) * length;
    else if (direction && !dest.hint.any) move.soft = /earlier|sooner|forward/.test(direction) ? 'earlier' : 'later';
    return move;
  }

  if (RACE.test(t) && !PAST.test(t) && !QUESTION.test(t)) return { kind: 'race', day: parseDay(t, ctx.nowMs) };

  if (PAST.test(t) || QUESTION.test(t)) return none();
  const hint = parseHint(t, ctx.nowMs), words = t.split(' ').length;
  const strong = STRONG.test(t), asked = strong || WEAK.test(t) || (words <= 10 && !BARE_NO.test(t) && (hint.any || minutes !== null));
  if (act && asked && /\b(?:and|then|plus)\b/.test(t) && new Set(SPOKEN.filter(([, re]) => re.test(t)).map(([key]) => key)).size > 1) return none('I plan one workout at a time. Ask for the first one, then the next.');
  if (act && asked) return { kind: 'add', activity: act, title: generic(t) ? 'Workout' : ACTIVITIES[act].title, minutes: minutes ?? ACTIVITIES[act].minutes, hint };
  return none();
}
