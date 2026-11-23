// The hard rules a plan must keep, from Plan Calendar's benchmark contract (validatePlan), cut down to what the phone needs.
// codes: shape, overlap-event, overlap-block, order, deadline
import { ms } from './core.mjs';

const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start);

export function violations(blocks, { events = [], deadline = null, chain = [] } = {}) {
  const out = [], ids = new Set();
  for (const b of blocks) {
    const s = ms(b.start), e = ms(b.end);
    if (typeof b.id !== 'string' || ids.has(b.id) || !Number.isFinite(s) || !Number.isFinite(e) || e < s || (e === s && !b.allDay)) out.push({ code: 'shape', block: b.id });
    ids.add(b.id);
  }
  if (out.length) return out;
  const real = blocks.filter((b) => !b.cancelled && !b.allDay);
  for (const b of real) for (const ev of events) if (overlaps(b, ev)) out.push({ code: 'overlap-event', block: b.id, event: ev.id });
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) if (overlaps(real[i], real[j])) out.push({ code: 'overlap-block', block: real[i].id, other: real[j].id });
  const steps = chain.map((id) => real.find((b) => b.id === id)).filter(Boolean);
  for (const [i, b] of steps.entries()) {
    if (deadline !== null && ms(b.end) > deadline) out.push({ code: 'deadline', block: b.id });
    if (i && ms(b.start) < ms(steps[i - 1].end)) out.push({ code: 'order', block: b.id, after: steps[i - 1].id });
  }
  return out;
}
