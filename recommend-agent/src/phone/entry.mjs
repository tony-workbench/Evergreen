// The phone entry: twelve functions Swift calls in JavaScriptCore. Each takes one JSON string and returns one JSON string; none throws.
// Success is { ok: true, ... }; failure is { ok: false, error: { code, text } }. Nothing here reads the network, a file or a clock.
//
//   recommendWeek({ now, history, memory?, calendar?, stopped?, shoes?, newPairArrives?, raceDate? })  -> { ok, sessions, reasons, summary, actions, suggestions, ... }
//   planContext({ now, tz?, memory, calendar?, shoes?, raceDate?, newPairArrives?, history? })        -> { ok, usualWeek, loadThisWeek, loadCap, readiness, freeSlots, shoe, race, stoppedKeys, ... }
//   checkPlan({ plan: { sessions }, context })                                                        -> { ok, pass, violations: [{ code, text, sessionId? }], hints: [{ code, action?, sessionId?, fix }] }
//   explainAction({ action, memory })                                                                 -> { ok, text, basedOn, memory }
//   checkWeek({ sessions, calendar })                                                                 -> { ok, conflicts }
//   planBrief({ context })                                                                            -> { ok, lines: [string] }   the week's constraints as plain sentences for the model
//   workoutContent({ sessionId, focus, minutes?, rules, history?, loads?, turn?, lastPain?, deload? })  -> { ok, content: { sessionId, focus, minutes, items: [{ ..., slow? }] } }
//   weekContent({ sessions: [{ sessionId, focus, minutes? }], rules, history?, loads?, deload? })     -> { ok, contents, setsByPattern, target, note }
//   checkContent({ content, rules, history?, minutes?, week? })                                       -> { ok, pass, violations: [{ code, text, movementId? }] }
//   contentBrief({ focus, rules, history?, loads?, minutes?, deload?, lastPain? })                    -> { ok, lines, choices: [{ id, name, pattern, level, isNew, dose }], target }   what a model may choose from
//   proposedContent({ proposal: { items: [{ movementId, sets, reps?, seconds? }], reason? }, sessionId, focus, rules, history?, loads?, minutes?, week?, rulesWeek?, deload?, lastPain? })
//                                                                                                     -> { ok, content, pass, violations }   a model's proposal, dosed and checked by code
//   movementLibrary({})                                                                               -> { ok, version, movements }   every word the workout page shows
//
// Every context may also carry the person's `rules` ({ restWeekdays, sessionMinutes, window, mornings, equipment, avoid,
// movements }), `dayKinds` ({ "YYYY-MM-DD": "home" | "out" | "rest" }) and `carry` (what a missed session worked), and `queue` ({ "YYYY-MM-DD": focus }, what this week's days at home left were planned to work). With
// `rules`, every day at home with time to train gets one strength session and the context carries `homeWeek`, which runs from
// today through Sunday (through next Sunday when today is Sunday); `dayOffsets` ({ "YYYY-MM-DD": "+HH:MM" }) gives each
// day's own UTC offset across a clock change.
import { recommendWeek } from '../workouts.mjs';
import { planContext, checkPlan, explainAction, checkWeek, planBrief } from '../plan.mjs';
import { workoutContent, weekContent, checkContent, movementLibrary, contentBrief, proposedContent } from '../content.mjs';

const TEXT = {
  bad_json: 'The request could not be read.',
  bad_request: 'The request could not be read.',
  bad_datetime: 'A time in the request is not an ISO 8601 time with an offset.',
  bad_date: 'A day in the request is not written as YYYY-MM-DD.',
  bad_shoes: 'The shoes need the day they were bought and their miles.',
  bad_memory: 'Memory must be a table of rows.',
  bad_stopped: 'The stopped usual times must be a list.',
  bad_context: 'The context is missing.',
  bad_plan: 'The plan has no list of sessions.',
  bad_action: 'There is no session to explain.',
  bad_rules: 'Your rules could not be read.',
  bad_day_kinds: 'A day is marked as something other than home, out or rest.',
  bad_day_offsets: 'A day\'s offset from UTC is not written as +HH:MM or -HH:MM.',
  bad_content: 'The workout could not be read.',
  missing_history: 'There is no workout history to plan from.',
  internal: 'Something went wrong while working this out.',
};
const fail = (code) => JSON.stringify({ ok: false, error: { code, text: TEXT[code] ?? TEXT.internal } });

const tool = (fn) => (argsJson) => {
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return fail('bad_json');
  }
  try {
    return JSON.stringify({ ok: true, ...fn(args) });
  } catch (e) {
    return fail(e && e.name === 'InputError' && typeof e.code === 'string' ? e.code : 'internal');
  }
};

globalThis.recommendWeek = tool(recommendWeek);
globalThis.planContext = tool(planContext);
globalThis.checkPlan = tool(checkPlan);
globalThis.explainAction = tool(explainAction);
globalThis.checkWeek = tool(checkWeek);
globalThis.planBrief = tool(planBrief);
globalThis.workoutContent = tool(workoutContent);
globalThis.weekContent = tool(weekContent);
globalThis.checkContent = tool(checkContent);
globalThis.movementLibrary = tool(movementLibrary);
globalThis.contentBrief = tool(contentBrief);
globalThis.proposedContent = tool(proposedContent);
