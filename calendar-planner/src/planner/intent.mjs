// The structured intent: what an agent in front of the engine sends instead of a sentence.
// One schema says what is allowed; the same schema is checked here, so the two cannot drift apart.
import { ms, dayStart, WINDOW, AWAKE_END } from './core.mjs';
import { ACTIVITIES, clock } from './fitness.mjs';
import { fail } from './errors.mjs';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$', TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const PARTS = { morning: { lo: 360, hi: 720 }, afternoon: { lo: 720, hi: 1020 }, evening: { lo: 1020, hi: 1320 } };

export const INTENT_SCHEMA = {
  type: 'object',
  description: 'One change to the workout plan. The engine proposes; nothing is saved until the person confirms.',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['add', 'move', 'resize', 'cancel', 'race'], description: 'add: a new workout (needs activity). move, resize, cancel: change one workout (needs targetWorkoutId; resize also needs minutes or distanceKm). race: plan back from a race day (needs raceDate).' },
    activity: { type: 'string', enum: Object.keys(ACTIVITIES), description: 'What to add. "rest" is a full rest day. "other" is anything not in the list; give it a title.' },
    title: { type: 'string', minLength: 1, maxLength: 60, description: 'For add: a short name to show, for example "Climbing". Left out, the activity name is used.' },
    minutes: { type: 'integer', minimum: 5, maximum: 240, description: 'Length in minutes. Left out, the usual length for the activity is used.' },
    sessionId: { type: 'string', minLength: 1, description: 'For add: the id of the recommended session this places. It comes back on the proposed block.' },
    targetWorkoutId: { type: 'string', minLength: 1, description: 'The id of the workout to move, resize or cancel, from the workouts given or from the proposal on screen.' },
    day: { type: 'string', pattern: DATE, description: 'Local day, YYYY-MM-DD, today or later. For move: the day to move to.' },
    after: { type: 'string', pattern: TIME, description: 'Start no earlier than this local time, HH:MM (24 hour).' },
    exact: { type: 'boolean', description: 'true: start exactly at `after` (needs `after`), as for an accepted suggestion. Only a real event or another workout moves it; meal times do not.' },
    before: { type: 'string', pattern: TIME, description: 'End no later than this local time, HH:MM (24 hour).' },
    partOfDay: { type: 'string', enum: Object.keys(PARTS), description: 'morning is 06:00 to 12:00, afternoon 12:00 to 17:00, evening 17:00 to 22:00.' },
    raceDate: { type: 'string', pattern: DATE, description: 'Local race day, YYYY-MM-DD, after today.' },
    distanceKm: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Distance of a run instead of minutes; turned into minutes with the person\'s usual pace.' },
  },
};

const CODES = { exact: 'BadExact', title: 'BadTitle', sessionId: 'BadSessionId', kind: 'BadKind', activity: 'BadActivity', minutes: 'BadMinutes', targetWorkoutId: 'BadTarget', day: 'BadDay', after: 'BadTime', before: 'BadTime', partOfDay: 'BadPartOfDay', raceDate: 'BadRaceDate', distanceKm: 'BadDistance' };
const SAY = {
  kind: 'The kind of change must be add, move, resize, cancel or race.',
  activity: `I do not know that activity. I can plan: ${Object.keys(ACTIVITIES).join(', ')}.`,
  exact: 'The exact flag must be true or false.',
  title: 'The title must be a text of 1 to 60 characters.',
  sessionId: 'The session id must be a non-empty text.',
  minutes: 'The length must be a whole number of minutes from 5 to 240.',
  targetWorkoutId: 'The workout to change must be named by its id.',
  day: 'The day must be a real date written as YYYY-MM-DD.',
  after: 'The "after" time must be written as HH:MM, from 00:00 to 23:59.',
  before: 'The "before" time must be written as HH:MM, from 00:00 to 23:59.',
  partOfDay: 'The part of the day must be morning, afternoon or evening.',
  raceDate: 'The race date must be a real date written as YYYY-MM-DD.',
  distanceKm: 'The distance must be more than 0 and at most 100 kilometres.',
};
const bad = fail;

function fits(value, rule) {
  if (rule.type === 'string' && typeof value !== 'string') return false;
  if (rule.type === 'boolean' && typeof value !== 'boolean') return false;
  if (rule.type === 'integer' && !Number.isInteger(value)) return false;
  if (rule.type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
  if (rule.minLength !== undefined && value.length < rule.minLength) return false;
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return false;
  if (rule.minimum !== undefined && value < rule.minimum) return false;
  if (rule.maximum !== undefined && value > rule.maximum) return false;
  return !(rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum);
}

// "2026-11-29" -> the wall-time start of that day, or null when it is not a real date.
const dayOf = (text) => { const t = Date.parse(`${text}T00:00:00.000Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === text ? t : null; };
const minutesOf = (text) => +text.slice(0, 2) * 60 + +text.slice(3);

// Checks a structured intent and turns it into what the rules reader would have produced.
// ctx: { nowMs, blocks, pace, usual }. -> { intent, notes }. Throws an IntentError { code, text } the agent can relay.
export function fromIntent(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('BadIntent', 'The intent must be an object with a kind.');
  const x = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const rule = INTENT_SCHEMA.properties[key];
    if (!rule) throw bad('UnknownField', `I do not know the field "${key}".`);
    if (!fits(value, rule)) throw bad(CODES[key], SAY[key]);
    x[key] = value;
  }
  if (!x.kind) throw bad('BadKind', SAY.kind);
  const today = dayStart(ctx.nowMs), notes = [];

  if (x.kind === 'race') {
    if (!x.raceDate) throw bad('MissingRaceDate', 'I need the race date to plan back from it.');
    const day = dayOf(x.raceDate);
    if (day === null) throw bad('BadRaceDate', SAY.raceDate);
    if (day <= today) throw bad('PastRaceDate', 'The race date must be after today.');
    return { intent: { kind: 'race', day }, notes };
  }

  let target = null;
  if (x.kind !== 'add') {
    if (!x.targetWorkoutId) throw bad('MissingTarget', 'I need to know which workout to change.');
    target = ctx.blocks.find((b) => b.id === x.targetWorkoutId && !b.cancelled);
    if (!target) throw bad('UnknownTarget', `There is no workout with the id "${x.targetWorkoutId}" in the plan.`);
  } else if (!x.activity) throw bad('MissingActivity', 'I need to know which activity to add.');
  if (target?.allDay && x.kind !== 'cancel') throw bad('BadTarget', 'A rest day can only be cancelled or dragged to another day.');
  if (x.kind === 'cancel') return { intent: { kind: 'cancel', target: target.id }, notes };

  // Length: minutes as given, else from the distance and the usual pace, else the usual length for the activity.
  const activity = x.kind === 'add' ? x.activity : target.activity;
  let minutes = x.minutes ?? null;
  if (minutes === null && x.distanceKm !== undefined) {
    const runs = activity === 'run' || activity === 'long_run';
    if (runs && ctx.pace) {
      minutes = Math.min(240, Math.max(10, Math.round((x.distanceKm * ctx.pace) / 5) * 5));
      notes.push(`${x.distanceKm} km at your usual pace is about ${minutes} minutes.`);
    } else if (x.kind === 'add') notes.push(`I do not know your pace for that, so I used the usual ${ACTIVITIES[activity].minutes} minutes.`);
    else throw bad('MissingMinutes', 'I do not know your pace for that, so I need the new length in minutes.');
  }
  if (x.kind === 'resize') {
    if (minutes === null) throw bad('MissingMinutes', 'I need the new length in minutes.');
    return { intent: { kind: 'resize', target: target.id, minutes }, notes };
  }

  // Day and time of day, in the same form the rules reader gives.
  const hint = { day: null, span: 1, lo: null, hi: null, pad: false, exact: false, meals: true, clockLabel: null, special: null, part: null, past: false };
  if (x.day) {
    hint.day = dayOf(x.day);
    if (hint.day === null) throw bad('BadDay', SAY.day);
    if (hint.day < today) throw bad('PastDay', 'That day has already passed.');
  }
  const part = x.partOfDay ? PARTS[x.partOfDay] : null, after = x.after ? minutesOf(x.after) : null, before = x.before ? minutesOf(x.before) : null;
  if (part) Object.assign(hint, { lo: part.lo, hi: part.hi, part: x.partOfDay });
  if (after !== null) Object.assign(hint, { lo: after, hi: after >= 1200 ? AWAKE_END : part && part.hi > after ? part.hi : WINDOW[1], clockLabel: `after ${clock(after)}` });
  if (before !== null) Object.assign(hint, { lo: after ?? (part && part.lo < before ? part.lo : WINDOW[0]), hi: before, clockLabel: after !== null ? `between ${clock(after)} and ${clock(before)}` : `before ${clock(before)}` });
  // An exact start: asked for outright, or a time alone that comes from a suggested session or is one of the person's usual times.
  // It is placed right there unless a real event or another workout is in the way; meals only steer times the engine picks freely.
  if (x.exact && after === null) throw bad('MissingTime', 'An exact start needs the time in "after".');
  const alone = after !== null && before === null && !part, weekday = hint.day === null ? null : (new Date(hint.day).getUTCDay() + 6) % 7;
  const usual = alone && (ctx.usual ?? []).some((u) => u.dow === weekday && u.hour * 60 === after && (u.activity === activity || (activity === 'long_run' && u.activity === 'run')));
  if (x.exact || (alone && (x.sessionId || usual))) Object.assign(hint, { lo: after, hi: after, pad: true, exact: true, meals: false, part: null, clockLabel: `at ${clock(after)}` });
  const length = minutes ?? (x.kind === 'add' ? ACTIVITIES[activity].minutes : (ms(target.end) - ms(target.start)) / 60000);
  if ((part && after !== null && after >= part.hi) || (part && before !== null && before <= part.lo)) throw bad('BadTimeRange', `That time is not in the ${x.partOfDay}.`);
  if (hint.lo !== null && !hint.exact && hint.hi - hint.lo < length && activity !== 'rest') throw bad('BadTimeRange', `${length} minutes do not fit between those times.`);
  hint.timed = hint.lo !== null;
  hint.any = hint.timed || hint.day !== null;

  if (x.kind === 'move') return { intent: { kind: 'move', target: target.id, hint, relative: null, soft: null }, notes };
  if (hint.day === null && activity === 'rest') hint.day = today;
  return { intent: { kind: 'add', activity, title: x.title?.trim() || ACTIVITIES[activity].title, minutes: minutes ?? ACTIVITIES[activity].minutes, hint, ...(x.sessionId ? { sessionId: x.sessionId } : {}) }, notes };
}
