// The phone entry: two functions Swift calls in JavaScriptCore. Each takes one JSON string and returns one JSON string;
// neither throws, reads the clock, touches the network or saves anything. Fields: docs/PHONE.md.
//
//   calendarPlan({ request | intent, now, tzOffsetMinutes, tzChanges?, events, workouts, memory? }) -> a proposal
//   calendarReplan({ plan, change, now, tzOffsetMinutes, tzChanges?, events, workouts, memory? })   -> a proposal
//   calendarIntentSchema()                                                                          -> the JSON Schema of `intent`
//
// A proposal: { ok, kind, message, proposed: [...], question?, undoToken, replaces?, state }.
// On failure: { ok: false, error: { code, text } }, where text is one plain sentence the app or the agent can show.
import hybrid from '../planner/approaches/hybrid.mjs';
import { INTENT_SCHEMA } from '../planner/intent.mjs';
import { fail, errorOf } from '../planner/errors.mjs';

const call = (argsJson, fn) => {
  let args;
  try { args = JSON.parse(argsJson); } catch { return JSON.stringify(errorOf(fail('BadJSON'))); }
  try { return JSON.stringify(fn(args)); } catch (e) { return JSON.stringify(errorOf(e)); }
};

export const calendarPlan = (argsJson) => call(argsJson, hybrid.plan);
export const calendarReplan = (argsJson) => call(argsJson, hybrid.replan);
export const calendarIntentSchema = () => JSON.stringify(INTENT_SCHEMA);

Object.assign(globalThis, { calendarPlan, calendarReplan, calendarIntentSchema });
