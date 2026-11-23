// Every failure leaves the engine as { ok: false, error: { code, text } }; text is one plain sentence the app can show.
const TEXT = {
  BadJSON: 'The input was not valid JSON.',
  BadInput: 'The input must be an object.',
  BadNow: 'The current time is missing or is not an ISO time.',
  BadRequest: 'I need a sentence or an intent to plan from.',
  BadPlan: 'The earlier proposal is missing or not valid.',
  BadChange: 'I do not know that change. Use a drag, an answer or a text change.',
  Error: 'Something went wrong while planning. Nothing was changed.',
};
export const fail = (code, text = TEXT[code] ?? TEXT.Error) => Object.assign(new Error(code), { name: 'PlanError', code, text });
export const errorOf = (e) => ({ ok: false, error: e?.name === 'PlanError' ? { code: e.code, text: e.text } : { code: 'Error', text: TEXT.Error } });
