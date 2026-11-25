// Prints a sample week from the built bundle, with the brief the model would get and the guardrail's answer: node scripts/sample.mjs
import vm from 'node:vm';
import { buildPhone } from './build-phone.mjs';
import { historyFor } from '../tests/support/sample.mjs';

const context = vm.createContext({});
vm.runInContext(await buildPhone(), context);
const call = (name, args) => JSON.parse(context[name](JSON.stringify(args)));

const row = (key, weekday, hour) => ({
  memoryId: key, key, slot: null, group: 'routine', kind: 'usual_slot', statement: `Usually runs at ${hour}:00.`,
  data: { activity: 'run', weekday, hour, minutes: 45, weeksSeen: 3, weeksTotal: 4 }, state: 'saved', confidence: 0.75, since: null, updated: null,
});
const now = '2026-11-20T09:00:00-08:00';
const ctx = {
  now, history: historyFor('jordan', now), memory: { rows: [row('mem-tue-run', 1, 18), row('mem-thu-run', 3, 6), row('mem-sun-run', 6, 8)] },
  shoes: { boughtOn: '2026-10-22', startMiles: 267 }, raceDate: '2026-11-29',
};
const pad = (v, n) => String(v).padEnd(n);

const week = call('recommendWeek', ctx);
console.log(week.summary);
for (const s of week.sessions) console.log(`${s.day} ${s.start.slice(11, 16)}  ${String(s.minutes).padStart(3)} min ${pad(s.activity, 10)} ${pad(s.intensity, 6)} ${s.reason}`);
for (const n of week.notes) console.log(`${n.day}        ${n.text}`);
const check = call('checkPlan', { plan: { sessions: week.sessions }, context: ctx });
console.log(`guardrail: ${check.pass ? 'pass' : check.violations.map((v) => v.code).join(', ')}`);
console.log('\nbrief:');
for (const line of call('planBrief', { context: ctx }).lines) console.log(`  ${line}`);
