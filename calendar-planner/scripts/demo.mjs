// Offline demo: six sentences against one sample week. Run: node scripts/demo.mjs
// It calls the same two functions the phone calls, with a fixed "now", so the output is the same every time.
import { fileURLToPath } from 'node:url';
import { calendarPlan, calendarReplan } from '../src/phone/entry.mjs';

const day = (n, hh, mm = '00') => `2026-11-${String(9 + n).padStart(2, '0')}T${hh}:${mm}:00-08:00`; // day 0 is Monday 9 November 2026
export const WEEK = {
  now: day(0, '09'),
  tzOffsetMinutes: -480,
  events: [
    { id: 'e1', title: 'Team sync', start: day(0, '17'), end: day(0, '18'), fixed: true },
    { id: 'e2', title: 'Client call', start: day(1, '14'), end: day(1, '15'), fixed: true },
    { id: 'e3', title: 'Evening class', start: day(2, '19'), end: day(2, '20'), fixed: true },
    { id: 'e4', title: 'Design review', start: day(3, '10'), end: day(3, '12'), fixed: true },
  ],
  workouts: [
    { id: 'w1', activity: 'Running', title: 'Run', start: day(1, '18'), end: day(1, '18', '45'), minutes: 45 },
    { id: 'w2', activity: 'TraditionalStrengthTraining', title: 'Strength', start: day(3, '07'), end: day(3, '07', '40'), minutes: 40 },
    { id: 'w3', activity: 'Running', title: 'Long run', start: day(6, '07'), end: day(6, '08', '30'), minutes: 90 },
  ],
  memory: { slots: [{ key: 'slot:yoga:wed:17', activity: 'yoga', weekday: 2, hour: 17, minutes: 30 }] },
};
export const SENTENCES = [
  'Find me half an hour for a walk after 5 tonight',
  'I want to do some yoga this week',
  "Move Sunday's long run to the afternoon",
  "Make Tuesday's run 30 minutes",
  "Move Thursday's strength to Saturday",
  'My race is on the 29th',
];

const call = (fn, args) => JSON.parse(fn(JSON.stringify(args)));
const line = (p) => `     ${p.status.padEnd(9)} ${p.title.padEnd(13)} ${p.start.slice(5, 16).replace('T', ' ')} to ${p.end.slice(11, 16)}${p.activity === 'rest' ? ' (all day)' : ''}  ${p.reason}`;
const show = (r) => [`   [${r.kind}] ${r.message}`, ...r.proposed.map(line), ...(r.question ? [`     ? ${r.question.text}  (${r.question.answers.map((a) => a.label).join(' | ')})`] : [])];

export function runDemo() {
  const out = ['Calendar planner demo. Now: Monday 9 November 2026, 09:00 (UTC-8).', ''];
  for (const [i, request] of SENTENCES.entries()) {
    const plan = call(calendarPlan, { ...WEEK, request });
    out.push(`${i + 1}. "${request}"`, ...show(plan));
    if (plan.question) {
      const answer = plan.question.answers[0];
      out.push(`   Answer: "${answer.label}"`, ...show(call(calendarReplan, { ...WEEK, plan, change: { type: 'answer', answerId: answer.id } })));
    }
    out.push('');
  }
  return out.join('\n');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) console.log(runDemo());
