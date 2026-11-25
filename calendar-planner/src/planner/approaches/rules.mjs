// Approach 1: plain rules. Place each block in the first free slot.
import { greedyFinder, greedySteps } from '../core.mjs';

export const solver = { name: 'rules', finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
export default solver;
