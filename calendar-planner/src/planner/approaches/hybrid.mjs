// Approach 4: hybrid. Rules draft the plan, a hard-rule check judges it, and constraint search takes over when the draft fails.
// Only what the plan itself changed is judged; a clash that was already in the person's calendar is not the plan's fault.
import rules from './rules.mjs';
import search from './search.mjs';
import { planWith, replanWith } from '../engine.mjs';
import { violations } from '../check.mjs';

const problems = ({ check }) => violations(check.blocks, check).filter((v) => check.changed.has(v.block) || check.changed.has(v.other)).map((v) => v.code);

function pick(run) {
  const first = run(rules), bad = problems(first);
  if (!bad.length) return { ...first.out, state: { ...first.out.state, used: 'rules' } };
  const second = run(search);
  return { ...second.out, state: { ...second.out.state, used: 'search' } };
}

export const plan = (input) => pick((solver) => planWith(input, solver));
export const replan = (input) => pick((solver) => replanWith(input, solver));
export default { plan, replan };
