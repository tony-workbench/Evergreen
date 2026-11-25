// Approach 2: constraint search. Free slots are the domain, order and deadline are constraints, and a
// depth-first search with backtracking looks for a full set of steps; a soft cost prefers a little air around events.
import { greedyFinder, greedySteps, isFree, slots, stepStart, nextFrom, STEP_VARIANTS, ms, MIN } from '../core.mjs';

const cost = (t, length, events) => events.some((e) => t < ms(e.end) + 15 * MIN && t + length > ms(e.start) - 15 * MIN) ? 1 : 0;

function finder(from, length, o = {}) {
  let best = null, bestCost = Infinity, seen = 0;
  for (const t of slots(from, length, o)) {
    if (!isFree(t, t + length, o)) continue;
    const c = cost(t, length, o.events ?? []);
    if (c < bestCost) { best = t; bestCost = c; }
    if (c === 0 || ++seen >= 24) break;
  }
  return best;
}

function search(intent, ctx, lengths) {
  const start = stepStart(intent, ctx), span = intent.deadline - start;
  if (span <= 0) return null;
  const domains = lengths.map((length) => [...slots(start, length, { limit: intent.deadline })].filter((t) => isFree(t, t + length, { events: ctx.events, blocks: ctx.blocks })));
  let nodes = 0;
  const dfs = (i, prevEnd, left) => {
    if (i === lengths.length) return [];
    if (++nodes > 50000 || prevEnd + left > intent.deadline) return null;
    const share = start + (span * i) / lengths.length, after = nextFrom(intent, prevEnd, i === 0);
    const ok = domains[i].filter((t) => t >= after);
    for (const t of [...ok.filter((x) => x >= share), ...ok.filter((x) => x < share)]) {
      const rest = dfs(i + 1, t + lengths[i], left - lengths[i]);
      if (rest) return [t, ...rest];
    }
    return null;
  };
  return dfs(0, start, lengths.reduce((a, b) => a + b, 0));
}

function steps(intent, ctx) {
  for (const variant of intent.variants ?? STEP_VARIANTS) {
    const found = search(intent, ctx, variant.map((m) => m * MIN));
    if (found) return found.map((s, i) => ({ s, minutes: variant[i] }));
  }
  return greedySteps(intent, ctx, greedyFinder);
}

export const solver = { name: 'search', finder, steps };
export default solver;
