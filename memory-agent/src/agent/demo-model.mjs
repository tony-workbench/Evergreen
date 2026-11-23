// A rule-based stand-in for the model, for tests and the demo only: demoModel(request) -> { proposals }.
// It reads what memoryDailyRequest returns (evidence and neighbors) and answers the way the prompt asks. Same request,
// same answer. It is no model and names none; the app's real call goes to the person's own model.
import { statementFor } from './statements.mjs';

// One candidate memory per evidence item the rules know: { slot, kind, statement, moved(old) -> boolean }.
function candidate(e) {
  const n = e.numbers;
  const base = { slot: e.slots[0], statement: statementFor(e) };
  if (e.id.startsWith('regularity.slot.')) return { ...base, kind: 'usual_slot' };
  if (e.id === 'volume.per_week') return { ...base, kind: 'weekly_volume' };
  if (e.id === 'load.ratio') return { ...base, kind: 'load' };
  if (e.id === 'body.sleep') return { ...base, kind: 'sleep', moved: (old) => Math.abs(Number(/and (\d+(?:\.\d+)?) h over 28/.exec(old)?.[1] ?? n.average28) - n.average28) >= 0.2 };
  if (e.id === 'body.resting_hr') return { ...base, kind: 'resting_hr', moved: (old) => Math.abs(Number(/and (\d+) bpm over 28/.exec(old)?.[1] ?? n.average28) - n.average28) >= 2 };
  if (e.id === 'mix.count') return { ...base, kind: 'mix' };
  if (e.id.startsWith('gear.') || e.id.startsWith('goal.')) return { ...base, kind: e.id.slice(0, 4), moved: () => true };
  if (e.id.startsWith('outcomes.') && n.notDone >= 2) return { ...base, kind: 'response', ask: true };
  return null;
}

export function demoModel(request) {
  const proposals = [];
  if (request === null || typeof request !== 'object' || !Array.isArray(request.evidence) || !Array.isArray(request.neighbors)) return { proposals };
  for (const e of request.evidence) {
    const c = candidate(e);
    if (c === null) continue;
    const here = request.neighbors.filter((m) => m.slot === c.slot);
    if (here.some((m) => m.state === 'rejected')) continue;                           // the person stopped it
    const open = here.find((m) => m.state === 'saved' || m.state === 'confirmed') ?? here.find((m) => m.state === 'candidate');
    const base = { slot: c.slot, kind: c.kind, statement: c.statement, evidenceIds: [e.id] };
    if (!open) proposals.push({ op: c.ask ? 'REVIEW' : 'ADD', ...base });
    else if (open.statement === c.statement || (c.kind !== 'usual_slot' && e.supportDays < 3)) proposals.push({ op: 'NOOP', ...base, targetMemoryId: open.memoryId });
    else if (open.state === 'candidate') proposals.push({ op: 'REVIEW', ...base, targetMemoryId: open.memoryId });
    else proposals.push({ op: c.moved?.(open.statement) ? 'SUPERSEDE' : 'MERGE', ...base, targetMemoryId: open.memoryId });
  }
  return { proposals };
}
