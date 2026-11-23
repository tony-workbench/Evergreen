// Test-only adapter: the harness's memory (fact sentences) as the table rows the phone bundle takes.
// The Python rules read slots from sentences and build keys like slot:running:sun:08; the bundle never does, so the tests do it here.
import { readFileSync, existsSync } from 'node:fs';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITY = { running: 'run', walking: 'walk', cycling: 'ride', yoga: 'yoga', 'strength training': 'strength' };
const SLOT = /Fixed slot among recognised activities: (\w[\w ]*?) on (\w{3}) between (\d\d):00(?: and \d\d:00, in (\d+) of the last (\d+) weeks)?/;

export function rowsFromFacts(facts) {
  const rows = [];
  const row = (key, kind, statement, data) => rows.push({
    memoryId: `m${rows.length + 1}`, key, slot: null, group: 'routine', kind, statement, data, state: 'saved', confidence: 1, since: null, updated: null,
  });
  for (const f of facts) {
    const t = f.text;
    let m;
    if ((m = SLOT.exec(t))) {
      const activity = ACTIVITY[m[1].toLowerCase()];
      if (!activity) continue;
      row(`slot:${m[1].toLowerCase().replaceAll(' ', '_')}:${m[2].toLowerCase()}:${m[3]}`, 'usual_slot', t,
        { activity, weekday: WEEKDAYS.indexOf(m[2]), hour: Number(m[3]), minutes: null, weeksSeen: m[4] ? Number(m[4]) : null, weeksTotal: m[5] ? Number(m[5]) : null });
    } else if ((m = /7-day load is ([\d.]+) minutes, ratio ([\d.]+) to/.exec(t))) row('load', 'load', t, { minutes7d: Number(m[1]), ratioToUsual: Number(m[2]) });
    else if ((m = /Average sleep over the last 7 days: ([\d.]+) h .*?28-day average of ([\d.]+) h/.exec(t))) row('sleep', 'sleep', t, { hours7d: Number(m[1]), hours28d: Number(m[2]) });
    else if ((m = /Average resting heart rate over the last 7 days: ([\d.]+) bpm.*?28-day average of ([\d.]+) bpm/.exec(t))) row('resting_hr', 'resting_hr', t, { bpm7d: Number(m[1]), bpm28d: Number(m[2]) });
    else if ((m = /4-week average: ([\d.]+) workouts per week/.exec(t))) row('workouts_per_week', 'weekly_volume', t, { workoutsPerWeek: Number(m[1]), minutesPerWeek: null });
  }
  return rows;
}

/** The harness's bundled memory for a demo persona, or null. */
export function bundledFacts(persona) {
  const url = new URL(`./harness-memory/${persona}.json`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')).facts : null;
}

/** The memory a harness request would use, as rows: what the request carries, else the persona's bundled copy, else none. */
export function memoryFor(input) {
  const phone = input.memory && (input.memory.facts?.length || input.memory.plannerText) ? input.memory.facts : null;
  const facts = phone ?? bundledFacts(input.persona);
  return facts ? { rows: rowsFromFacts(facts) } : undefined;
}
