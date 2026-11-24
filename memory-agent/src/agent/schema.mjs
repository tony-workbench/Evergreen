// The vocabulary of the memory agent: states, who may move a memory between them, operations, slot families, kinds,
// thresholds and the JSON Schema of the model's answer. The design is the usual one for agent memory
// (a model proposes, code executes behind guardrails); docs/MEMORY-LOGIC.md has the details.

export const CANDIDATE = 'candidate';
export const SAVED = 'saved';
export const CONFIRMED = 'confirmed';
export const REJECTED = 'rejected';
export const SUPERSEDED = 'superseded';
export const INACTIVE = 'inactive';
export const STATES = [CANDIDATE, SAVED, CONFIRMED, REJECTED, SUPERSEDED, INACTIVE];
export const USABLE = [SAVED, CONFIRMED];                 // the only states the daily table shows
export const OPEN = [CANDIDATE, SAVED, CONFIRMED];        // may still be merged, superseded or reviewed

// 'from>to' -> who may make the move. system = the guarded executor; user = the person, through the phone globals.
export const TRANSITIONS = {
  'candidate>confirmed': ['user'],
  'candidate>rejected': ['user'],
  'candidate>inactive': ['system'],
  'saved>confirmed': ['user'],
  'saved>rejected': ['user'],
  'saved>superseded': ['system', 'user'],
  'saved>inactive': ['system'],
  'confirmed>rejected': ['user'],
  'confirmed>superseded': ['system', 'user'],
  'confirmed>inactive': ['system'],
  'inactive>rejected': ['user'],
  'rejected>saved': ['user'],
  'superseded>saved': ['system'],                           // only when forgetting a day deleted the successor
};
export const mayMove = (from, to, actor) => (TRANSITIONS[`${from}>${to}`] ?? []).includes(actor);

export const OPS = ['ADD', 'NOOP', 'MERGE', 'SUPERSEDE', 'REVIEW'];
export const GROUPS = ['routine', 'body', 'load', 'response', 'gear', 'goal'];
export const KINDS = ['usual_slot', 'weekly_volume', 'load', 'sleep', 'resting_hr', 'mix', 'response', 'gear', 'goal', 'training_place'];
export const ACTIVITIES = ['run', 'long_run', 'walk', 'strength', 'yoga', 'ride', 'swim', 'elliptical', 'stretch', 'rest', 'other'];
export const SLOT_RE = /^[a-z]+(\.[a-z0-9_]+){1,3}$/;
export const groupOf = (slot) => slot.slice(0, slot.indexOf('.'));

// Thresholds (our choices).
export const MAX_PROPOSALS = 30;
export const MAX_STATEMENT = 160;          // characters
export const MIN_CONFIDENCE = 0.5;         // below this an ADD, MERGE or SUPERSEDE becomes a REVIEW; code computes the confidence
export const STRONG_DAYS = { routine: 3, body: 3, load: 3, response: 3, gear: 1, goal: 1 };   // MERGE / SUPERSEDE; gear and goal are what the person told the app
export const ADD_DAYS = { routine: 1, body: 1, load: 1, response: 3, gear: 1, goal: 1 };      // ADD saved straight away
export const SLOT_WEEKS = 3;               // a usual slot is strong when seen in 3 of the last 4 weeks
export const SUPPORT_WINDOW = 28;          // days of evidence counted as support
export const EXPIRE_DAYS = 35;             // without evidence for this long a memory becomes inactive
export const EVIDENCE_KEPT = 35;           // days of evidence kept
export const VERSIONS_KEPT = 5;
export const SUPERSEDED_KEPT = 3;          // per slot
export const EVENTS_KEPT = 400;
export const TABLE_MAX_ROWS = 25;
export const TABLE_MAX_WORDS = 200;

const proposal = {
  type: 'object',
  additionalProperties: false,
  required: ['op', 'slot', 'statement', 'kind', 'evidenceIds'],
  properties: {
    op: { enum: OPS },
    slot: { type: 'string', pattern: SLOT_RE.source },
    statement: { type: 'string', minLength: 8, maxLength: MAX_STATEMENT },
    kind: { enum: KINDS },
    numbers: { type: 'object', additionalProperties: { type: 'number' } },
    evidenceIds: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
    targetMemoryId: { type: ['string', 'null'] },
  },
};
/** The JSON Schema the app gives the model for its one answer of the day. */
export const PROPOSALS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: { proposals: { type: 'array', maxItems: MAX_PROPOSALS, items: proposal } },
};

// One plain sentence per code, for the app to show or log. Codes under GUARD turn a proposal into a REVIEW instead of dropping it.
export const CODE_TEXT = {
  bad_shape: 'The proposal is missing a field or has a wrong value.',
  bad_slot: 'The slot key is not lowercase English words joined by dots.',
  slot_family: 'The slot key is not in an allowed family.',
  duplicate_slot: 'Another proposal in this answer already used this slot.',
  too_many: 'The answer holds more proposals than allowed.',
  slot_stopped: 'The person stopped this slot, so nothing is written to it until it is restored.',
  unknown_evidence: 'A cited evidence id is not in this day\'s evidence.',
  slot_not_supported: 'None of the cited evidence supports this slot.',
  kind_mismatch: 'The kind does not match the slot.',
  number_not_in_evidence: 'A number in the statement is not in the cited evidence.',
  not_a_fact: 'The statement is not one plain fact about the person.',
  raw_reading: 'The statement rests on a single day\'s reading, not on a window.',
  rejected_before: 'The person already rejected this statement.',
  target_missing: 'The operation needs a target memory.',
  target_not_neighbor: 'The target is not one of the memories returned for this day.',
  target_not_open: 'The target memory can no longer be changed.',
  slot_occupied: 'The slot already holds a memory, so ADD does not apply.',
  weak_evidence: 'There are too few days of evidence, so the person is asked.',
  low_confidence: 'The evidence gives a low confidence, so the person is asked.',
  older_evidence: 'The evidence is older than the memory, so the person is asked.',
};
export const GUARD_CODES = ['weak_evidence', 'low_confidence', 'older_evidence'];
export const REJECT_CODES = Object.keys(CODE_TEXT).filter((c) => !GUARD_CODES.includes(c));

export const ERROR_TEXT = {
  bad_arguments: 'The arguments are missing or wrong.',
  bad_user: 'The user id must be usr_ followed by 8 to 32 lowercase hex characters.',
  bad_extras: 'The gear or goal extras are not in the agreed form.',
  bad_outcomes: 'The outcomes are not in the agreed form.',
  bad_proposals: 'The proposals are not a list.',
  no_evidence: 'There is no evidence for that day yet: roll the day first.',
  day_forgotten: 'That day was forgotten.',
  memory_off: 'The computed memory was forgotten and is off until it is restored.',
  not_found: 'There is no such memory.',
  not_allowed: 'That memory cannot be moved to that state.',
  slot_occupied: 'The slot already holds a memory in use.',
  failed: 'The memory could not be read or written.',
  memory_unavailable: 'The memory is not available: a file is damaged or a change is unfinished.',
  bad_path: 'The memory folder is not a plain folder inside the root.',
  unknown_what: 'That is not something the memory can forget or restore.',
  not_done: 'Nothing changed: that key, date or type is not known.',
  roll_failed: 'The day could not be rolled from that snapshot.',
  too_long: 'The memory text is too long to return.',
};
export const fail = (code) => ({ ok: false, error: { code, text: ERROR_TEXT[code] } });
