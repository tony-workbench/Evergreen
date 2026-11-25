# Phone host

`npm run build` writes `dist/memory-phone.js`. It sets the globals below, each taking and returning one JSON string (arguments: `src/phone/entry.mjs`); none throws. Every failure is `{"ok":false,"error":{"code","text"}}`, with `text` one plain sentence; the codes are `ERROR_TEXT` in `src/agent/schema.mjs`.

## Facts

- `memoryRoll`, `memoryState`.
- `memoryPlannerText`: `{ok,text,words}`: the agent's table once it has a row, else the brief (bullets, at most 120 words). `brief: true`: always the brief; `full: true`: the long text.
- `memoryBrief`: `{ok, lines:[{group,id,key,text}], words, stopped:[{key,label}], facts:[{kind,text}]}`. Groups: `routine`, `body`; `facts` are the stored sentences behind the brief.
- `memoryForget`, `memoryRestore` with `what: 'stop'` and a line's `key` (`slot:running:sun:08`, `sleep`, or a table row's key): out until restored.
- `memoryForget({what:'day', day, snapshot})`: pass the snapshot, so the facts are rolled again and the table is not left empty.

## Memory agent

Once a day, after the midnight `memoryRoll`.

- `memoryDailyRequest({root,user,now,outcomes?,extras?,snapshot?})`: `{ok, day, alreadyDone, system, user, schema, evidence:[{id,text,numbers,window,slots,supportDays}], neighbors:[{memoryId,slot,statement,state,version,updated}]}`. `outcomes`: `[{sessionId,day,activity,plannedStart,done,actualStart?,actualMinutes?}]`. `extras`: `{gear?:[{item,name?,startedOn,km}], goal?:[{what,date}]}`. `snapshot`: only without an earlier roll. Send `system`, `user` and `schema` to the person's model unless `alreadyDone` or `evidence` is empty.
- `memoryDailyApply({root,user,now,day?,proposals})`: `{ok, day, alreadyDone, applied:[{index,op,slot,memoryId,version,guard?}], rejected:[{index,code,text}], review:[row]}`. `proposals` is the model's answer as it came: `{proposals:[{op,slot,statement,kind,numbers?,evidenceIds,targetMemoryId?}]}` or the list.
- `memoryTable({root,user,now?})`: `{ok, day, rows:[{memoryId,key,slot,group,kind,statement,data,state,confidence,since,updated}], text, words, leftOut}`.
- `memoryReviewQueue({root,user})`: `{ok, rows:[{reviewId,memoryId,key,slot,group,kind,statement,data,question,reason:{code,text},day,targetMemoryId,targetStatement}]}`.
- `memoryConfirm`, `memoryReject`, `memoryRestore` (`{root,user,now}` with `key` or `memoryId`): `{ok, memoryId, slot, state}`.
- `memoryDemoModel(request)`: `{proposals}`, a rule-based stand-in for the model, for tests, and the app's fallback when the model gives no usable answer.

Codes: `docs/MEMORY-LOGIC.md`, section 9.

## Host

Set synchronous `globalThis.memoryIO` first, as below. A throw (`code`: `ENOENT`, `EEXIST`) fails that call.

```js
const fs = new Map();
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const get = (p) => fs.get(p) ?? fail('ENOENT');
const put = (p, x) => (fs.has(p) ? fail('EEXIST') : fs.set(p, { isFile: !x.dir, isDirectory: !!x.dir, isSymbolicLink: false, dev: 1, ino: fs.size, ...x }));
put('/', { dir: 1 });
globalThis.memoryIO = {
  platform: 'posix',
  readFile: (p) => get(p).text,
  writeFile: (p, text) => put(p, { text }),
  fsyncFile() {}, fsyncDir() {},
  rename: (a, b) => { fs.set(b, get(a)); fs.delete(a); },
  remove: (p) => { fs.delete(p); },
  mkdir: (p) => put(p, { dir: 1 }),
  lstat: get,
  realpath: (p) => (get(p), p),
  readdir: (p) => [...fs.keys()].filter((k) => k.startsWith(`${p}/`) && !/\/./.test(k.slice(p.length + 1))).map((k) => ({ name: k.slice(p.length + 1), ...fs.get(k) })),
  sha256: (text) => hostSha256(text),
};
const call = (name, more) => JSON.parse(globalThis[name](JSON.stringify({ root: '/mem', user: 'usr_0123456789abcdef', ...more })));
const now = '2026-11-18T00:00:00-08:00';
call('memoryRoll', { snapshot, now });
const planner = call('memoryPlannerText', {});
const request = call('memoryDailyRequest', { now, outcomes: [] });
const answer = call('memoryDemoModel', request);          // the app asks the person's model here instead
const applied = call('memoryDailyApply', { now, day: request.day, proposals: answer });
const table = call('memoryTable', {});
```
