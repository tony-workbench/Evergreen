// Runs the memory agent for 28 days over one sample person with the rule-based stand-in for the model, and prints the
// final table: node scripts/demo.mjs [sedentary|moderate|half_marathon]. No network, no key, nothing written to disk.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { MemoryStore } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { recordDay, dailyRequest, dailyApply, table, reviews, confirm } from '../src/agent/index.mjs';
import { fakeModel } from './fake-model.mjs';

const FIRST = Date.UTC(2026, 9, 22);                        // the first midnight: 2026-10-22; the last is 2026-11-18
const dateOf = (i) => new Date(FIRST + i * 86400000).toISOString().slice(0, 10);

// A small in-memory io object, so the demo leaves no file behind.
export function memoryIo() {
  const files = new Map([['/', { dir: true }]]);
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const get = (p) => files.get(p) ?? fail('ENOENT');
  return {
    platform: 'posix',
    readFile: (p) => get(p).text,
    writeFile: (p, text) => (files.has(p) ? fail('EEXIST') : files.set(p, { text })),
    fsyncFile() {}, fsyncDir() {},
    rename: (a, b) => { files.set(b, get(a)); files.delete(a); },
    remove: (p) => { files.delete(p); },
    mkdir: (p) => (files.has(p) ? fail('EEXIST') : files.set(p, { dir: true })),
    lstat: (p) => ({ isFile: !get(p).dir, isDirectory: !!get(p).dir, isSymbolicLink: false, dev: 1, ino: [...files.keys()].indexOf(p) + 1 }),
    realpath: (p) => (get(p), p),
    readdir: (p) => [...files.keys()].filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map((k) => ({ name: k.slice(p.length + 1), isDirectory: !!files.get(k).dir, isSymbolicLink: false })),
    sha256: (text) => createHash('sha256').update(text).digest('hex'),
  };
}

// Scripted outcomes: a planned 06:00 run on three days, done once; the person answers the question on the last day.
const PLANNED = { 16: false, 23: false, 9: true };

/** 28 daily rounds (roll, request, stand-in model, apply). Returns { ctx, days: [{ day, request, answer, result }], table, reviews }. */
export function runAgentDemo(who = 'half_marathon', { io = memoryIo(), user = `usr_${'c3'.repeat(8)}` } = {}) {
  const snapshot = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${who}.json`, import.meta.url), 'utf8'));
  const store = new MemoryStore('/mem', user, { io });
  const ctx = { store, io, user };
  const days = [];
  let now = null;
  for (let i = 0; i < 28; i++) {
    now = `${dateOf(i)}T00:00:00-08:00`;
    const day = dateOf(i - 1);
    rollDay({ store, snapshot: { ...snapshot, exportDate: now }, now });
    recordDay(ctx, { snapshot: { ...snapshot, exportDate: now }, now });
    const outcomes = Object.hasOwn(PLANNED, i) ? [{ sessionId: `s-${day}-run-0600`, day, activity: 'run', plannedStart: `${day}T06:00:00-08:00`, done: PLANNED[i] }] : [];
    const request = dailyRequest(ctx, { now, outcomes });
    const answer = request.ok && !request.alreadyDone && request.evidence.length > 0 ? fakeModel(request) : { proposals: [] };
    const result = request.ok ? dailyApply(ctx, { now, day, proposals: answer.proposals }) : request;
    days.push({ day, request, answer, result });
  }
  const asked = reviews(ctx).rows;
  for (const q of asked) confirm(ctx, { now, memoryId: q.memoryId });
  return { ctx, days, asked, table: table(ctx, { now }), reviews: reviews(ctx) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = runAgentDemo(process.argv[2]);
  const ops = {};
  for (const d of run.days) for (const a of d.result.applied ?? []) ops[a.op] = (ops[a.op] ?? 0) + 1;
  const dropped = run.days.reduce((n, d) => n + (d.result.rejected?.length ?? 0), 0);
  console.log(`28 days, operations applied: ${JSON.stringify(ops)}, dropped: ${dropped}`);
  console.log(`Questions answered "yes" on the last day: ${run.asked.map((q) => q.statement).join(' ') || 'none'}`);
  console.log(`\nThe table for the recommendation agent (${run.table.rows.length} rows, ${run.table.words} words):\n`);
  console.log(run.table.text);
}
