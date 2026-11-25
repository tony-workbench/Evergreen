(() => {
  // src/planner/core.mjs
  var MIN = 6e4;
  var H = 36e5;
  var D = 864e5;
  var MEALS = [[450, 480, "breakfast"], [720, 780, "lunch"], [1110, 1170, "dinner"]];
  var WINDOW = [360, 1320];
  var AWAKE_END = 1410;
  var STEP_VARIANTS = [[60, 120, 60], [60, 60, 60], [30, 60, 30], [30, 30, 30]];
  var DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  var iso = (t) => new Date(t).toISOString();
  var ms = (v) => Date.parse(v);
  var dayStart = (t) => Math.floor(t / D) * D;
  var ceilTo = (t, step = 15 * MIN) => Math.ceil(t / step) * step;
  var minOfDay = (t) => (t - dayStart(t)) / MIN;
  var weekStart = (t) => dayStart(t) - (new Date(dayStart(t)).getUTCDay() + 6) % 7 * D;
  var dur = (b) => ms(b.end) - ms(b.start);
  var real = (blocks) => blocks.filter((b) => !b.cancelled && !b.allDay);
  function isFree(s, e, { events = [], blocks = [], meals = true } = {}) {
    if ([...events, ...real(blocks)].some((x) => s < ms(x.end) && e > ms(x.start))) return false;
    if (!meals) return true;
    const a = minOfDay(s), b = a + (e - s) / MIN;
    return !MEALS.some(([x, y]) => a < y && b > x);
  }
  function* slots(from, length, { window = WINDOW, limit = from + 30 * D, step = 15 * MIN } = {}) {
    for (let ds = dayStart(from); ds < limit; ds += D) {
      const hi = Math.min(ds + window[1] * MIN, limit);
      for (let t = Math.max(ds + window[0] * MIN, ceilTo(from, step)); t + length <= hi; t += step) yield t;
    }
  }
  function greedyFinder(from, length, o = {}) {
    for (const t of slots(from, length, o)) if (isFree(t, t + length, o)) return t;
    return null;
  }
  var WORDS = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 };
  function parseMinutes(text) {
    const t = text.toLowerCase();
    if (/half an hour|half hour|half-hour/.test(t)) return 30;
    if (/\b(?:an?|one)\s+(?:hour|hr)\s+and\s+a\s+half\b/.test(t)) return 90;
    if (/\bquarter of an hour\b|\bquarter hour\b/.test(t)) return 15;
    let m = t.match(/(\d+)[\s-]*(?:minutes?|mins?)\b/);
    if (m) return +m[1];
    m = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:hours?|hrs?)\b/);
    if (m) return Math.round(+m[1] * 60);
    m = t.match(/\b(an|a|one|two|three|four)\s+hours?\b/);
    return m ? WORDS[m[1]] * 60 : null;
  }
  function parseDay(text, nowMs) {
    const t = text.toLowerCase();
    const today0 = dayStart(nowMs), week0 = weekStart(nowMs);
    if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return today0;
    if (/\bday after tomorrow\b/.test(t)) return today0 + 2 * D;
    if (/\btomorrow\b/.test(t)) return today0 + D;
    const eow = t.match(/\bend of (?:the )?(this |next )?week\b/);
    if (eow) {
      const friday = week0 + 4 * D + (eow[1] === "next " ? 7 * D : 0);
      return friday < today0 ? friday + 7 * D : friday;
    }
    const inDays = t.match(/\bin (\d{1,2}) days?\b/);
    if (inDays) return today0 + +inDays[1] * D;
    const inWeeks = t.match(/\bin (\d{1,2}|an?|one|two|three|four) weeks?\b/);
    if (inWeeks) return today0 + (WORDS[inWeeks[1]] ?? +inWeeks[1]) * 7 * D;
    const ord = t.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(\w+))?/) || t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (ord) {
      const named = /^\d/.test(ord[1]) ? MONTHS.indexOf(ord[2] ?? "") : MONTHS.indexOf(ord[1]);
      const dom = /^\d/.test(ord[1]) ? +ord[1] : +ord[2], base = new Date(today0);
      if (dom >= 1 && dom <= 31) {
        let month = named >= 0 ? named : base.getUTCMonth(), year = base.getUTCFullYear(), d2 = Date.UTC(year, month, dom);
        if (d2 < today0) d2 = named >= 0 ? Date.UTC(year + 1, month, dom) : Date.UTC(year, month + 1, dom);
        return d2;
      }
    }
    const m = t.match(/\b(?:(this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (!m) return null;
    let d = week0 + DAYS.indexOf(m[2]) * D;
    if (m[1] === "next") d += 7 * D;
    else if (d < today0) d += 7 * D;
    return d;
  }
  function stepStart(intent, ctx) {
    return Math.max(ceilTo(ms(ctx.now)), intent.from ?? -Infinity);
  }
  var nextFrom = (intent, prevEnd, first) => intent.apart && !first ? Math.max(prevEnd, dayStart(prevEnd) + D) : prevEnd;
  function greedySteps(intent, ctx, finder2 = greedyFinder) {
    const { events, blocks = [] } = ctx, start = stepStart(intent, ctx), span = intent.deadline - start;
    if (span <= 0) return [];
    const variants = intent.variants ?? STEP_VARIANTS;
    const run = (variant, spread) => {
      const placed = [];
      let prevEnd = start;
      for (const [i, minutes] of variant.entries()) {
        const length = minutes * MIN, o = { events, blocks, limit: intent.deadline }, after = nextFrom(intent, prevEnd, i === 0);
        const t = finder2(Math.max(spread ? start + span * i / variant.length : start, after), length, o) ?? finder2(after, length, o);
        if (t === null) break;
        placed.push({ s: t, minutes });
        prevEnd = t + length;
      }
      return placed;
    };
    let best = [];
    for (const variant of variants) for (const spread of [true, false]) {
      const placed = run(variant, spread);
      if (placed.length === variant.length) return placed;
      if (placed.length > best.length) best = placed;
    }
    return best;
  }
  function cascade(blocks, order, { events, limit = Infinity, meals = true, chained = null }) {
    const by = new Map(blocks.map((b) => [b.id, { ...b }]));
    const pending = new Set(order.slice(1)), unplaced = [];
    const anchorEnd = ms(by.get(order[0]).end);
    let prevEnd = anchorEnd;
    for (const id of order.slice(1)) {
      const b = by.get(id), length = dur(b);
      pending.delete(id);
      const others = [...by.values()].filter((x) => x.id !== id && !pending.has(x.id));
      const s = ms(b.start), ordered = !chained || chained.has(id);
      if (!((!ordered || s >= prevEnd) && s + length <= limit && isFree(s, s + length, { events, blocks: others, meals: false }))) {
        const t = greedyFinder(ordered ? prevEnd : anchorEnd, length, { events, blocks: others, meals, limit, window: meals ? WINDOW : [WINDOW[0], AWAKE_END] });
        if (t === null) {
          unplaced.push(id);
          by.delete(id);
          continue;
        }
        b.start = iso(t);
        b.end = iso(t + length);
        b.moved = true;
      }
      if (ordered) prevEnd = ms(b.end);
    }
    return { blocks: blocks.filter((b) => by.has(b.id)).map((b) => by.get(b.id)), unplaced };
  }
  function shiftConfirmed(blocks, pend, ok, events) {
    const find = (id) => blocks.find((b) => b.id === id);
    const out = new Map(blocks.map((b) => [b.id, b])), waiting = new Set(ok);
    for (const id of [...ok].sort((a, b) => ms(find(a).start) - ms(find(b).start))) {
      const b = out.get(id), length = dur(b);
      waiting.delete(id);
      const others = [...out.values()].filter((x) => x.id !== id && !waiting.has(x.id));
      let s = ms(b.start) + pend.delta;
      if (!isFree(s, s + length, { events, blocks: others, meals: false })) s = greedyFinder(s, length, { events, blocks: others, meals: false, window: [WINDOW[0], AWAKE_END] }) ?? s;
      out.set(id, { ...b, start: iso(s), end: iso(s + length), moved: true });
    }
    return blocks.map((b) => out.get(b.id));
  }

  // src/planner/approaches/rules.mjs
  var solver = { name: "rules", finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
  var rules_default = solver;

  // src/planner/approaches/search.mjs
  var cost = (t, length, events) => events.some((e) => t < ms(e.end) + 15 * MIN && t + length > ms(e.start) - 15 * MIN) ? 1 : 0;
  function finder(from, length, o = {}) {
    let best = null, bestCost = Infinity, seen = 0;
    for (const t of slots(from, length, o)) {
      if (!isFree(t, t + length, o)) continue;
      const c = cost(t, length, o.events ?? []);
      if (c < bestCost) {
        best = t;
        bestCost = c;
      }
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
      if (++nodes > 5e4 || prevEnd + left > intent.deadline) return null;
      const share = start + span * i / lengths.length, after = nextFrom(intent, prevEnd, i === 0);
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
  var solver2 = { name: "search", finder, steps };
  var search_default = solver2;

  // src/planner/errors.mjs
  var TEXT = {
    BadJSON: "The input was not valid JSON.",
    BadInput: "The input must be an object.",
    BadNow: "The current time is missing or is not an ISO time.",
    BadRequest: "I need a sentence or an intent to plan from.",
    BadPlan: "The earlier proposal is missing or not valid.",
    BadChange: "I do not know that change. Use a drag, an answer or a text change.",
    Error: "Something went wrong while planning. Nothing was changed."
  };
  var fail = (code, text = TEXT[code] ?? TEXT.Error) => Object.assign(new Error(code), { name: "PlanError", code, text });
  var errorOf = (e) => ({ ok: false, error: e?.name === "PlanError" ? { code: e.code, text: e.text } : { code: "Error", text: TEXT.Error } });

  // src/planner/time.mjs
  var MIN2 = 6e4;
  var two = (n) => String(n).padStart(2, "0");
  function offsetOf(text) {
    const m = /(Z|[+-]\d\d:?\d\d)$/.exec(String(text ?? ""));
    if (!m) return null;
    if (m[1] === "Z") return 0;
    const sign = m[1][0] === "-" ? -1 : 1, digits = m[1].replace(/[+:-]/g, "");
    return sign * (+digits.slice(0, 2) * 60 + +digits.slice(2));
  }
  function makeZone({ now, tzOffsetMinutes, tzChanges } = {}) {
    const nowUtc = Date.parse(now);
    if (!Number.isFinite(nowUtc)) throw fail("BadNow");
    const base = Number.isFinite(tzOffsetMinutes) ? Math.round(tzOffsetMinutes) : offsetOf(now) ?? 0;
    const changes = (Array.isArray(tzChanges) ? tzChanges : []).map((c) => ({ at: Date.parse(c?.at), off: Math.round(c?.tzOffsetMinutes) })).filter((c) => Number.isFinite(c.at) && Number.isFinite(c.off) && c.at > nowUtc).sort((a, b) => a.at - b.at);
    const offsetAt = (utc) => {
      let off = base;
      for (const c of changes) if (c.at <= utc) off = c.off;
      return off;
    };
    const toWall = (utc) => utc + offsetAt(utc) * MIN2;
    const fromWall = (wall) => {
      for (const off of [base, ...changes.map((c) => c.off)]) if (offsetAt(wall - off * MIN2) === off) return wall - off * MIN2;
      return wall - offsetAt(wall - base * MIN2) * MIN2;
    };
    return {
      nowWall: toWall(nowUtc),
      // An ISO string from the host -> the wall-time string the planner works with.
      wall: (text) => {
        const utc = Date.parse(text);
        return Number.isFinite(utc) ? new Date(toWall(utc)).toISOString() : null;
      },
      // A wall-time value from the planner -> an ISO string with the local offset in force at that moment.
      local: (wallValue) => {
        const utc = fromWall(typeof wallValue === "number" ? wallValue : Date.parse(wallValue)), off = offsetAt(utc), a = Math.abs(off);
        return `${new Date(utc + off * MIN2).toISOString().slice(0, 19)}${off < 0 ? "-" : "+"}${two(Math.floor(a / 60))}:${two(a % 60)}`;
      }
    };
  }

  // src/planner/fitness.mjs
  var ACTIVITIES = {
    long_run: { title: "Long run", minutes: 90, noun: "long run" },
    run: { title: "Run", minutes: 45, noun: "run" },
    walk: { title: "Walk", minutes: 30, noun: "walk" },
    strength: { title: "Strength", minutes: 40, noun: "strength session" },
    yoga: { title: "Yoga", minutes: 30, noun: "yoga session" },
    ride: { title: "Ride", minutes: 60, noun: "ride" },
    swim: { title: "Swim", minutes: 45, noun: "swim" },
    stretch: { title: "Stretch", minutes: 15, noun: "stretch" },
    elliptical: { title: "Elliptical", minutes: 40, noun: "elliptical session", indoor: true },
    // Anything not named above. Only the app or the agent sends it; the rules reader never makes one up.
    other: { title: "Workout", minutes: 30, noun: "workout" },
    rest: { title: "Rest day", minutes: 0, noun: "rest day" }
  };
  var SPOKEN = [
    ["long_run", /\blong\s+(?:run|jog)\b/],
    ["rest", /\brest\s+day\b|\bday\s+off\b|\b(?:take|need|want|schedule|add|plan)\s+(?:a\s+|some\s+)?rest\b/],
    ["stretch", /\bstretch(?:ing|es)?\b|\bmobility\b/],
    ["yoga", /\byoga\b/],
    ["elliptical", /\b(?:elliptical|cross[- ]?trainer)\b/],
    ["strength", /\b(?:strength|weights?|gym|lift(?:ing)?)\b/],
    ["swim", /\bswim(?:ming)?\b/],
    ["ride", /\b(?:ride|cycle|cycling|bike|biking|spin)\b/],
    ["walk", /\b(?:walk|walking|hike)\b/],
    ["run", /\b(?:run|runs|running|jog|jogging)\b/],
    ["strength", /\b(?:work\s?out|exercise|training session)\b/]
  ];
  var generic = (text) => /\b(?:work\s?out|exercise|training session)\b/.test(text) && !/\b(?:strength|weights?|gym|lift(?:ing)?)\b/.test(text) && detectActivity(text) === "strength";
  var detectActivity = (text) => SPOKEN.find(([, re]) => re.test(text))?.[0] ?? null;
  function normalizeActivity(name, title = "") {
    if (Object.hasOwn(ACTIVITIES, name)) return name;
    const t = `${name ?? ""} ${title}`.toLowerCase().replace(/[^a-z]/g, "");
    if (/long(run|jog)/.test(t)) return "long_run";
    if (/run|jog/.test(t)) return "run";
    if (/walk|hik/.test(t)) return "walk";
    if (/strength|weight|gym|lift/.test(t)) return "strength";
    if (/yoga/.test(t)) return "yoga";
    if (/cycl|bik|ride|spin/.test(t)) return "ride";
    if (/swim/.test(t)) return "swim";
    if (/stretch|mobility|flexib/.test(t)) return "stretch";
    if (/elliptical|crosstrainer/.test(t)) return "elliptical";
    return /rest/.test(t) ? "rest" : null;
  }
  var PARTS = [
    [/\bbefore (?:work|breakfast)\b|\bfirst thing\b/, { lo: 360, hi: 540, special: "before work", am: true }],
    [/\bafter work\b/, { lo: 1020, hi: 1320, special: "after work", pm: true }],
    [/\bbefore lunch\b/, { lo: 540, hi: 720, special: "before lunch", am: true }],
    [/\bafter lunch\b/, { lo: 780, hi: 1020, special: "after lunch", pm: true }],
    [/\bbefore dinner\b/, { lo: 900, hi: 1110, special: "before dinner", pm: true }],
    [/\bafter dinner\b/, { lo: 1170, hi: 1320, special: "after dinner", pm: true }],
    [/\b(?:lunch(?:time|\s+break)?|midday|noon)\b/, { lo: 690, hi: 810, special: "at lunch", meals: false }],
    [/\bmorning\b/, { lo: 360, hi: 720, part: "morning", am: true }],
    [/\bafternoon\b/, { lo: 720, hi: 1020, part: "afternoon", pm: true }],
    [/\b(?:evening|tonight|night)\b/, { lo: 1020, hi: 1320, part: "evening", pm: true }]
  ];
  var CLOCK = /\b(after|before|by|at|around|about|from)\s+(\d{1,2})(?::(\d\d))?\s*(am|pm|a\.m\.?|p\.m\.?)?(?![\d:]|\s*(?:min|hours?\b|hrs?\b|st\b|nd\b|rd\b|th\b|k\b|days?\b|weeks?\b|more\b|miles?\b|km\b))/;
  var BARE_CLOCK = /\b(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/;
  function clock(minutes) {
    const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
    return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  }
  function hourOf(word, h, suffix, part) {
    if (h > 12 || suffix) return suffix && /^p/.test(suffix) ? h % 12 + 12 : suffix ? h % 12 : h;
    if (h === 12) return 12;
    if (part?.am) return h;
    if (part?.pm) return h + 12;
    return (word === "after" || word === "from" ? h <= 8 : h <= 4) ? h + 12 : h;
  }
  function parseHint(text, nowMs, { bareNumber = false } = {}) {
    const t = text.toLowerCase(), today0 = dayStart(nowMs), week0 = weekStart(nowMs);
    const hint = { day: null, span: 1, lo: null, hi: null, pad: false, exact: false, meals: true, clockLabel: null, special: null, part: null, past: /\byesterday\b/.test(t) };
    const weekend = t.match(/\b(next\s+)?weekend\b/);
    if (weekend) {
      const sat = week0 + 5 * D + (weekend[1] ? 7 * D : 0);
      hint.day = Math.max(sat, today0);
      hint.span = (sat + 2 * D - hint.day) / D;
    } else if (/\bnext week\b/.test(t)) {
      hint.day = week0 + 7 * D;
      hint.span = 7;
    } else if (/\bthis week\b/.test(t)) {
      hint.day = today0;
      hint.span = (week0 + 7 * D - today0) / D;
    } else hint.day = parseDay(t, nowMs);
    const part = PARTS.find(([re]) => re.test(t))?.[1] ?? null;
    if (part) Object.assign(hint, { lo: part.lo, hi: part.hi, special: part.special ?? null, part: part.part ?? null, meals: part.meals ?? true });
    let c = t.match(CLOCK), word = c?.[1];
    if (!c) {
      c = t.match(BARE_CLOCK);
      if (c) {
        c = [c[0], "at", c[1], c[2], c[3]];
        word = "at";
      }
    }
    if (!c && bareNumber) {
      const n = t.match(/^\s*(?:the\s+)?(\d{1,2})(?::(\d\d))?\s*$/);
      if (n) {
        c = [n[0], "at", n[1], n[2], void 0];
        word = "at";
      }
    }
    if (c && +c[2] <= 23 && +(c[3] ?? 0) <= 59) {
      const m = hourOf(word, +c[2], c[4], part) * 60 + +(c[3] ?? 0);
      if (word === "after" || word === "from") Object.assign(hint, { lo: m, hi: m >= 1200 ? AWAKE_END : part && part.hi > m ? part.hi : WINDOW[1], clockLabel: `after ${clock(m)}`, special: null });
      else if (word === "before" || word === "by") Object.assign(hint, { lo: part && part.lo < m ? part.lo : WINDOW[0], hi: m, clockLabel: `before ${clock(m)}`, special: null });
      else if (word === "at") Object.assign(hint, { lo: m, hi: m, pad: true, exact: true, meals: false, clockLabel: `at ${clock(m)}`, special: null });
      else Object.assign(hint, { lo: Math.max(m - 30, 0), hi: m + 30, pad: true, meals: false, clockLabel: `around ${clock(m)}`, special: null });
    }
    hint.timed = hint.lo !== null;
    hint.any = hint.timed || hint.day !== null;
    return hint;
  }
  var POSSESSIVE = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this (?:morning|afternoon|evening))'s\b/;
  function findTarget(part, whole, ctx, dayFromPart) {
    const act = detectActivity(part) ?? detectActivity(whole), poss = whole.match(POSSESSIVE);
    const day = poss ? parseDay(poss[1], ctx.nowMs) : dayFromPart ? parseDay(part, ctx.nowMs) : null;
    const live2 = ctx.blocks.filter((b) => !b.cancelled && !b.allDay && ms(b.end) > ctx.nowMs).sort((a, b) => ms(a.start) - ms(b.start));
    if (!act && day === null) {
      const one = ctx.primary ? live2.find((b) => b.id === ctx.primary) : live2.length === 1 ? live2[0] : null;
      return one ? { block: one } : { missing: `I am not sure which workout you mean. Name it, for example "Sunday's long run".` };
    }
    const pool = day === null ? live2 : live2.filter((b) => dayStart(ms(b.start)) === day);
    let found = pool;
    if (act && !generic(part) && !(part !== whole && !detectActivity(part) && generic(whole))) {
      found = pool.filter((b) => b.activity === act);
      if (!found.length && act === "run") found = pool.filter((b) => b.activity === "long_run");
    }
    if (found.length) return { block: found[0] };
    const what = act && !generic(whole) ? ACTIVITIES[act].noun : "workout", an = /^[aeiou]/.test(what) ? "an" : "a";
    return { missing: `I could not find ${an} ${what}${day !== null ? ` ${ctx.onDay(day)}` : ""} in your plan.` };
  }
  var CANCEL = /\b(?:skip(?:ping)?|cancel|drop|delete|remove|scrap|call off|(?:can'?t|cannot|won'?t) (?:make|do|run|go)|too tired for)\b|^no\s/;
  var MANY = /\b(?:every|each|daily|twice|\d+ times|(?:two|three|four|five) times|everything|all my)\b/;
  var SWAP = /\b(?:swap|switch)\b/;
  var DAYS_OFF = /\b(an?|one|two|three|\d)\s+days?\s+(later|earlier|sooner)\b/;
  var RESIZE = /\b(?:shorten|lengthen|extend|trim|longer|shorter|cut short)\b/;
  var MAKE = /\b(?:make|cut|change)\b/;
  var ADD_TO = /\badd\s+(?:another\s+)?[\w\s-]*?(?:minutes?|mins?|hours?)\s+(?:to|onto)\b|\b\d+\s+(?:more|extra)\s+min/;
  var MOVE = /\b(?:move|push|shift|reschedule|bump|slide|change|delay|postpone|bring|instead)\b/;
  var SOFT = /\b(?:not (?:that|so) (early|late)|too (early|late))\b/;
  var DIRECTION = /\b(later|earlier|sooner|back|forward)\b/;
  var RACE = /\b(?:race|marathon|half[- ]marathon|triathlon|parkrun)\b|\b(?:my|i have a|i've got a|signed up for a)\s+(?:5k|10k)\b/;
  var RELATIVE = /\b(?:back|forward|up)\s+(?:by\s+)?(?:\d+|an?|half|one|two)\b|\b(?:minutes?|mins?|hours?|hrs?)\s+(?:later|earlier|sooner)\b|\bby\s+(?:\d+|an?|half|one|two)\s/;
  var BARE_NO = /^(?:i|i'm|my|we|it|the|that|this|he|she|they|you)\b|\b(?:is|are|love|like|hate|enjoy)\b/;
  var STRONG = /\b(?:find|schedule|book|block|fit|squeeze in|carve out|set aside|make time|time for|put|plan|add|pencil in|slot in)\b/;
  var WEAK = /\b(?:need to|have to|want to|wanna|can you|could you|help me|remind|go for|go to|hit the|i'd like to|i would like to|let's|i should|gotta|need a|want a|when can)\b/;
  var PAST = /\b(?:yesterday|last (?:night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|ran|walked|swam|rode|did|went|felt|finished|completed)\b/;
  var QUESTION = /^(?:what|why|who|where|how (?:many|much|far|long|fast|do|did|is|was|should)|is|are|was|were|does|did|should)\b/;
  var NOT_A_REQUEST = `I can plan workouts: try "find me 45 minutes for a run after 6" or "move Sunday's long run to the afternoon".`;
  var none = (message = NOT_A_REQUEST) => ({ kind: "none", message });
  function destination(t, ctx) {
    let cutAt = -1;
    for (const m of t.matchAll(/\b(?:to|till|until|for)\b/g)) if (parseHint(t.slice(m.index + m[0].length), ctx.nowMs, { bareNumber: true }).any) cutAt = m.index;
    if (cutAt >= 0) {
      const tail2 = t.slice(cutAt).replace(/^\w+\s*/, "");
      return { source: t.slice(0, cutAt), split: true, tail: tail2, hint: parseHint(tail2, ctx.nowMs, { bareNumber: true }) };
    }
    const tail = t.replace(POSSESSIVE, " ").replace(/\binstead of .*$/, " ");
    return { source: t, split: false, tail, hint: parseHint(tail, ctx.nowMs) };
  }
  function read(request, ctx) {
    const t = String(request ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    if (!t) return none();
    if (ctx.awaiting === "race" && !RACE.test(t)) {
      const day = parseDay(t, ctx.nowMs);
      if (day !== null) return { kind: "race", day };
    }
    const act = detectActivity(t), names = Boolean(act) || POSSESSIVE.test(t) || /\b(?:it|that|this one)\b/.test(t);
    if (MANY.test(t)) return none("I plan one workout at a time, and repeats are not supported yet.");
    if (SWAP.test(t)) return none("I cannot swap two workouts yet. Move them one at a time.");
    if (CANCEL.test(t)) {
      if (!names) return none(`I can only skip workouts. Name one, for example "skip Thursday's strength".`);
      const tg = findTarget(t, t, ctx, true);
      return tg.block ? { kind: "cancel", target: tg.block.id } : none(tg.missing);
    }
    const minutes = parseMinutes(t);
    if (!/\bmake (?:time|room|space)\b/.test(t) && (RESIZE.test(t) || ADD_TO.test(t) || MAKE.test(t) && minutes !== null && names)) {
      const tg = findTarget(t, t, ctx, true);
      if (!tg.block) return none(tg.missing);
      const less = /\b(?:shorten|trim|shorter|cut short|fewer|less)\b/.test(t), more = /\b(?:lengthen|extend|longer|more|extra)\b/.test(t) || ADD_TO.test(t);
      const relative = ADD_TO.test(t) || /\bby\s+(?:\d|an?\s|half)/.test(t) || /\b(?:minutes?|mins?|hours?)\s+(?:longer|shorter|more|less)\b/.test(t) || minutes === null;
      if (relative) return { kind: "resize", target: tg.block.id, delta: (less ? -1 : 1) * (minutes ?? 15) };
      if (!less && !more && !MAKE.test(t)) return none();
      return { kind: "resize", target: tg.block.id, minutes };
    }
    const soft = t.match(SOFT), direction = t.match(DIRECTION)?.[1];
    if (MOVE.test(t) && names || soft || direction && names && !STRONG.test(t) && (ctx.primary || POSSESSIVE.test(t))) {
      const dest = destination(t, ctx), tg = findTarget(dest.source, t, ctx, dest.split);
      if (!tg.block) return none(tg.missing);
      const move = { kind: "move", target: tg.block.id, hint: dest.hint, relative: null, soft: null };
      const length = parseMinutes(dest.tail);
      const off = t.match(DAYS_OFF);
      if (off) move.relative = (off[2] === "later" ? 1 : -1) * ({ a: 1, an: 1, one: 1, two: 2, three: 3 }[off[1]] ?? +off[1]) * 1440;
      else if (soft) move.soft = (soft[1] ?? soft[2]) === "early" ? "later" : "earlier";
      else if (RELATIVE.test(t) && length !== null) move.relative = (/\b(?:earlier|sooner|forward|up)\b/.test(t) ? -1 : 1) * length;
      else if (direction && !dest.hint.any) move.soft = /earlier|sooner|forward/.test(direction) ? "earlier" : "later";
      return move;
    }
    if (RACE.test(t) && !PAST.test(t) && !QUESTION.test(t)) return { kind: "race", day: parseDay(t, ctx.nowMs) };
    if (PAST.test(t) || QUESTION.test(t)) return none();
    const hint = parseHint(t, ctx.nowMs), words = t.split(" ").length;
    const strong = STRONG.test(t), asked = strong || WEAK.test(t) || words <= 10 && !BARE_NO.test(t) && (hint.any || minutes !== null);
    if (act && asked && /\b(?:and|then|plus)\b/.test(t) && new Set(SPOKEN.filter(([, re]) => re.test(t)).map(([key]) => key)).size > 1) return none("I plan one workout at a time. Ask for the first one, then the next.");
    if (act && asked) return { kind: "add", activity: act, title: generic(t) ? "Workout" : ACTIVITIES[act].title, minutes: minutes ?? ACTIVITIES[act].minutes, hint };
    return none();
  }

  // src/planner/intent.mjs
  var DATE = "^\\d{4}-\\d{2}-\\d{2}$";
  var TIME = "^([01]\\d|2[0-3]):[0-5]\\d$";
  var PARTS2 = { morning: { lo: 360, hi: 720 }, afternoon: { lo: 720, hi: 1020 }, evening: { lo: 1020, hi: 1320 } };
  var INTENT_SCHEMA = {
    type: "object",
    description: "One change to the workout plan. The engine proposes; nothing is saved until the person confirms.",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["add", "move", "resize", "cancel", "race"], description: "add: a new workout (needs activity). move, resize, cancel: change one workout (needs targetWorkoutId; resize also needs minutes or distanceKm). race: plan back from a race day (needs raceDate)." },
      activity: { type: "string", enum: Object.keys(ACTIVITIES), description: 'What to add. "rest" is a full rest day. "other" is anything not in the list; give it a title.' },
      title: { type: "string", minLength: 1, maxLength: 60, description: 'For add: a short name to show, for example "Climbing". Left out, the activity name is used.' },
      minutes: { type: "integer", minimum: 5, maximum: 240, description: "Length in minutes. Left out, the usual length for the activity is used." },
      sessionId: { type: "string", minLength: 1, description: "For add: the id of the recommended session this places. It comes back on the proposed block." },
      targetWorkoutId: { type: "string", minLength: 1, description: "The id of the workout to move, resize or cancel, from the workouts given or from the proposal on screen." },
      day: { type: "string", pattern: DATE, description: "Local day, YYYY-MM-DD, today or later. For move: the day to move to." },
      after: { type: "string", pattern: TIME, description: "Start no earlier than this local time, HH:MM (24 hour)." },
      exact: { type: "boolean", description: "true: start exactly at `after` (needs `after`), as for an accepted suggestion. Only a real event or another workout moves it; meal times do not." },
      before: { type: "string", pattern: TIME, description: "End no later than this local time, HH:MM (24 hour)." },
      partOfDay: { type: "string", enum: Object.keys(PARTS2), description: "morning is 06:00 to 12:00, afternoon 12:00 to 17:00, evening 17:00 to 22:00." },
      raceDate: { type: "string", pattern: DATE, description: "Local race day, YYYY-MM-DD, after today." },
      distanceKm: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Distance of a run instead of minutes; turned into minutes with the person's usual pace." }
    }
  };
  var CODES = { exact: "BadExact", title: "BadTitle", sessionId: "BadSessionId", kind: "BadKind", activity: "BadActivity", minutes: "BadMinutes", targetWorkoutId: "BadTarget", day: "BadDay", after: "BadTime", before: "BadTime", partOfDay: "BadPartOfDay", raceDate: "BadRaceDate", distanceKm: "BadDistance" };
  var SAY = {
    kind: "The kind of change must be add, move, resize, cancel or race.",
    activity: `I do not know that activity. I can plan: ${Object.keys(ACTIVITIES).join(", ")}.`,
    exact: "The exact flag must be true or false.",
    title: "The title must be a text of 1 to 60 characters.",
    sessionId: "The session id must be a non-empty text.",
    minutes: "The length must be a whole number of minutes from 5 to 240.",
    targetWorkoutId: "The workout to change must be named by its id.",
    day: "The day must be a real date written as YYYY-MM-DD.",
    after: 'The "after" time must be written as HH:MM, from 00:00 to 23:59.',
    before: 'The "before" time must be written as HH:MM, from 00:00 to 23:59.',
    partOfDay: "The part of the day must be morning, afternoon or evening.",
    raceDate: "The race date must be a real date written as YYYY-MM-DD.",
    distanceKm: "The distance must be more than 0 and at most 100 kilometres."
  };
  var bad = fail;
  function fits(value, rule) {
    if (rule.type === "string" && typeof value !== "string") return false;
    if (rule.type === "boolean" && typeof value !== "boolean") return false;
    if (rule.type === "integer" && !Number.isInteger(value)) return false;
    if (rule.type === "number" && !(typeof value === "number" && Number.isFinite(value))) return false;
    if (rule.enum && !rule.enum.includes(value)) return false;
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
    if (rule.minLength !== void 0 && value.length < rule.minLength) return false;
    if (rule.maxLength !== void 0 && value.length > rule.maxLength) return false;
    if (rule.minimum !== void 0 && value < rule.minimum) return false;
    if (rule.maximum !== void 0 && value > rule.maximum) return false;
    return !(rule.exclusiveMinimum !== void 0 && value <= rule.exclusiveMinimum);
  }
  var dayOf = (text) => {
    const t = Date.parse(`${text}T00:00:00.000Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === text ? t : null;
  };
  var minutesOf = (text) => +text.slice(0, 2) * 60 + +text.slice(3);
  function fromIntent(raw, ctx) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("BadIntent", "The intent must be an object with a kind.");
    const x = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === void 0) continue;
      const rule = INTENT_SCHEMA.properties[key];
      if (!rule) throw bad("UnknownField", `I do not know the field "${key}".`);
      if (!fits(value, rule)) throw bad(CODES[key], SAY[key]);
      x[key] = value;
    }
    if (!x.kind) throw bad("BadKind", SAY.kind);
    const today = dayStart(ctx.nowMs), notes = [];
    if (x.kind === "race") {
      if (!x.raceDate) throw bad("MissingRaceDate", "I need the race date to plan back from it.");
      const day = dayOf(x.raceDate);
      if (day === null) throw bad("BadRaceDate", SAY.raceDate);
      if (day <= today) throw bad("PastRaceDate", "The race date must be after today.");
      return { intent: { kind: "race", day }, notes };
    }
    let target = null;
    if (x.kind !== "add") {
      if (!x.targetWorkoutId) throw bad("MissingTarget", "I need to know which workout to change.");
      target = ctx.blocks.find((b) => b.id === x.targetWorkoutId && !b.cancelled);
      if (!target) throw bad("UnknownTarget", `There is no workout with the id "${x.targetWorkoutId}" in the plan.`);
    } else if (!x.activity) throw bad("MissingActivity", "I need to know which activity to add.");
    if (target?.allDay && x.kind !== "cancel") throw bad("BadTarget", "A rest day can only be cancelled or dragged to another day.");
    if (x.kind === "cancel") return { intent: { kind: "cancel", target: target.id }, notes };
    const activity = x.kind === "add" ? x.activity : target.activity;
    let minutes = x.minutes ?? null;
    if (minutes === null && x.distanceKm !== void 0) {
      const runs = activity === "run" || activity === "long_run";
      if (runs && ctx.pace) {
        minutes = Math.min(240, Math.max(10, Math.round(x.distanceKm * ctx.pace / 5) * 5));
        notes.push(`${x.distanceKm} km at your usual pace is about ${minutes} minutes.`);
      } else if (x.kind === "add") notes.push(`I do not know your pace for that, so I used the usual ${ACTIVITIES[activity].minutes} minutes.`);
      else throw bad("MissingMinutes", "I do not know your pace for that, so I need the new length in minutes.");
    }
    if (x.kind === "resize") {
      if (minutes === null) throw bad("MissingMinutes", "I need the new length in minutes.");
      return { intent: { kind: "resize", target: target.id, minutes }, notes };
    }
    const hint = { day: null, span: 1, lo: null, hi: null, pad: false, exact: false, meals: true, clockLabel: null, special: null, part: null, past: false };
    if (x.day) {
      hint.day = dayOf(x.day);
      if (hint.day === null) throw bad("BadDay", SAY.day);
      if (hint.day < today) throw bad("PastDay", "That day has already passed.");
    }
    const part = x.partOfDay ? PARTS2[x.partOfDay] : null, after = x.after ? minutesOf(x.after) : null, before = x.before ? minutesOf(x.before) : null;
    if (part) Object.assign(hint, { lo: part.lo, hi: part.hi, part: x.partOfDay });
    if (after !== null) Object.assign(hint, { lo: after, hi: after >= 1200 ? AWAKE_END : part && part.hi > after ? part.hi : WINDOW[1], clockLabel: `after ${clock(after)}` });
    if (before !== null) Object.assign(hint, { lo: after ?? (part && part.lo < before ? part.lo : WINDOW[0]), hi: before, clockLabel: after !== null ? `between ${clock(after)} and ${clock(before)}` : `before ${clock(before)}` });
    if (x.exact && after === null) throw bad("MissingTime", 'An exact start needs the time in "after".');
    const alone = after !== null && before === null && !part, weekday2 = hint.day === null ? null : (new Date(hint.day).getUTCDay() + 6) % 7;
    const usual = alone && (ctx.usual ?? []).some((u) => u.dow === weekday2 && u.hour * 60 === after && (u.activity === activity || activity === "long_run" && u.activity === "run"));
    if (x.exact || alone && (x.sessionId || usual)) Object.assign(hint, { lo: after, hi: after, pad: true, exact: true, meals: false, part: null, clockLabel: `at ${clock(after)}` });
    const length = minutes ?? (x.kind === "add" ? ACTIVITIES[activity].minutes : (ms(target.end) - ms(target.start)) / 6e4);
    if (part && after !== null && after >= part.hi || part && before !== null && before <= part.lo) throw bad("BadTimeRange", `That time is not in the ${x.partOfDay}.`);
    if (hint.lo !== null && !hint.exact && hint.hi - hint.lo < length && activity !== "rest") throw bad("BadTimeRange", `${length} minutes do not fit between those times.`);
    hint.timed = hint.lo !== null;
    hint.any = hint.timed || hint.day !== null;
    if (x.kind === "move") return { intent: { kind: "move", target: target.id, hint, relative: null, soft: null }, notes };
    if (hint.day === null && activity === "rest") hint.day = today;
    return { intent: { kind: "add", activity, title: x.title?.trim() || ACTIVITIES[activity].title, minutes: minutes ?? ACTIVITIES[activity].minutes, hint, ...x.sessionId ? { sessionId: x.sessionId } : {} }, notes };
  }

  // src/planner/engine.mjs
  var RACE_RUNS = [[90, 45, 30], [75, 40, 30], [60, 30, 20], [45, 30, 20]];
  var RACE_NAMES = [["Last long run", "long_run"], ["Easy run", "run"], ["Easy run", "run"]];
  var MONTHS2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  var join = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  var overlap = (a, b) => ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start);
  var live = (blocks) => blocks.filter((b) => !b.cancelled && !b.allDay);
  var dayOf2 = (b) => dayStart(ms(b.start));
  var weekday = (t) => cap(DAYS[(new Date(t).getUTCDay() + 6) % 7]);
  var at = (t) => clock(minOfDay(t));
  var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function world(input) {
    if (!input || typeof input !== "object") throw fail("BadInput");
    const z = makeZone(input), nowMs = z.nowWall;
    const span = (x) => {
      const start = z.wall(x?.start), minutes = Number(x?.minutes);
      const end = z.wall(x?.end) ?? (start && minutes > 0 ? iso(ms(start) + minutes * MIN) : null);
      return start && end && ms(end) > ms(start) ? { start, end } : null;
    };
    const events = [], blocks = [];
    for (const e of Array.isArray(input.events) ? input.events : []) {
      const s = span(e);
      if (s) events.push({ id: String(e.id), title: String(e.title ?? "Event"), ...s });
    }
    for (const x of Array.isArray(input.workouts) ? input.workouts : []) {
      const s = span(x);
      if (!s) continue;
      const activity = normalizeActivity(x.activity, x.title ?? "");
      if (!activity) throw fail("BadActivity", `A workout has an activity I do not know: ${String(x.activity).slice(0, 40)}.`);
      blocks.push({ id: String(x.id), title: String(x.title ?? ACTIVITIES[activity].title), activity, ...s, was: s, ...x.group ? { group: String(x.group) } : {}, ...x.sessionId ? { sessionId: String(x.sessionId) } : {}, ...activity === "rest" ? { allDay: true } : {} });
    }
    const usual = [];
    for (const raw of Array.isArray(input.memory?.slots) ? input.memory.slots : []) {
      const ok = raw && Object.hasOwn(ACTIVITIES, raw.activity) && Number.isInteger(raw.weekday) && raw.weekday >= 0 && raw.weekday <= 6 && Number.isInteger(raw.hour) && raw.hour >= 0 && raw.hour <= 23;
      if (ok) usual.push({ activity: raw.activity, dow: raw.weekday, hour: raw.hour });
    }
    usual.sort((a, b) => a.hour - b.hour);
    const declined = (Array.isArray(input.memory?.declined) ? input.memory.declined : []).map(String);
    const today = dayStart(nowMs), p = Number(input.memory?.paceMinPerKm), pace = p >= 2 && p <= 20 ? p : null;
    const dayWord = (t) => {
      const n = (dayStart(t) - today) / D;
      return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 && n < 7 ? weekday(t) : `${weekday(t)} ${MONTHS2[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`;
    };
    const onDay = (t) => /^to/.test(dayWord(t)) ? dayWord(t) : `on ${dayWord(t)}`;
    return { z, nowMs, today, from: ceilTo(nowMs), events, blocks, usual, declined, pace, now: input.now, dayWord, onDay };
  }
  function restore(w, plan2) {
    if (!plan2 || typeof plan2 !== "object" || !Array.isArray(plan2.proposed)) throw fail("BadPlan");
    const blocks = w.blocks.map((b) => ({ ...b }));
    for (const p of plan2.proposed) {
      const start = w.z.wall(p?.start), end = w.z.wall(p?.end);
      if (!start || !end) continue;
      if (p.status === "new") blocks.push({ id: String(p.id), title: String(p.title), activity: String(p.activity), start, end, isNew: true, reason: p.reason, ...p.sessionId ? { sessionId: String(p.sessionId) } : {}, ...p.activity === "rest" ? { allDay: true } : {} });
      else {
        const b = blocks.find((x) => x.id === String(p.id));
        if (b) Object.assign(b, { start, end, reason: p.reason, ...p.status === "cancelled" ? { cancelled: true } : {} });
      }
    }
    const s = plan2.state && typeof plan2.state === "object" ? plan2.state : {};
    const st = { kind: s.kind ?? "none", primary: s.primary ?? null, pending: s.pending ?? null, declined: [.../* @__PURE__ */ new Set([...s.declined ?? [], ...w.declined])], chain: s.chain ?? null, limit: s.limit ?? null, race: s.race ?? null, awaiting: s.awaiting ?? null };
    return { blocks, st };
  }
  function whenPhrase(w, s, hint, fellBack) {
    const word = w.dayWord(s), part = !fellBack && hint?.part && !hint.clockLabel ? hint.part : null;
    const evening = hint?.part === "evening" && word === "today" && !fellBack;
    const day = evening ? "tonight" : part ? word === "today" ? `this ${part}` : word === "tomorrow" ? `tomorrow ${part}` : `on ${word} ${part}` : w.onDay(s);
    return [fellBack ? null : hint?.clockLabel ?? hint?.special, day].filter(Boolean).join(" ");
  }
  var range = (w, b) => b.allDay ? w.dayWord(ms(b.start)) : `${w.dayWord(ms(b.start))}, ${at(ms(b.start))} to ${at(ms(b.end))}`;
  function explain(w, busy, s, length, hint, fellBack) {
    if (hint?.exact && !fellBack) return `Free ${whenPhrase(w, s, hint, false)}, as you asked.`;
    const head = `${fellBack ? "Next" : "First"} free ${length / MIN} minutes ${whenPhrase(w, s, hint, fellBack)}`;
    const before = [...w.events, ...live(busy)].find((x) => ms(x.end) === s);
    if (before) return `${head}; your ${before.title} ends at ${at(s)}.`;
    const meal = hint?.meals !== false && MEALS.find((m) => m[1] === minOfDay(s));
    return meal ? `${head}; kept clear of ${meal[2]}.` : `${head}.`;
  }
  function place(w, solver3, busy, length, hint, activity) {
    const o = { events: w.events, blocks: busy };
    if (!hint.timed && !hint.past) {
      const mine = w.usual.filter((u) => u.activity === activity || activity === "long_run" && u.activity === "run");
      const first = hint.day ?? w.today, days = hint.day !== null ? hint.span : 7;
      for (let d = first; mine.length && d < first + days * D; d += D) for (const u of mine) {
        const s2 = d + u.hour * H;
        if (u.dow === (new Date(d).getUTCDay() + 6) % 7 && s2 >= w.from && isFree(s2, s2 + length, { ...o, meals: false })) return { s: s2, why: `Your usual ${weekday(s2)} ${at(s2)} time for a ${ACTIVITIES[activity].noun} is free.`, note: null };
      }
    }
    let s = null;
    if (hint.any && !hint.past) {
      const first = hint.day ?? w.today, limit = first + (hint.day !== null ? hint.span : 7) * D;
      const window = hint.timed ? [hint.lo, hint.hi + (hint.pad ? length / MIN : 0)] : WINDOW;
      s = solver3.finder(Math.max(w.from, first), length, { ...o, window, limit, meals: hint.meals });
      if (s !== null) return { s, why: explain(w, busy, s, length, hint, false), note: null };
    }
    if (hint.timed && !hint.past) s = solver3.finder(Math.max(w.from, (hint.day ?? w.today) + hint.lo * MIN), length, o);
    s ??= solver3.finder(Math.max(w.from, hint.day ?? w.from), length, o) ?? solver3.finder(w.from, length, o);
    if (s === null) return null;
    const note = hint.past ? "That day has already passed, so I picked the next free time." : hint.any ? "Nothing fits at that time, so I picked the next free time." : null;
    return { s, why: explain(w, busy, s, length, hint, hint.any), note };
  }
  function related(before, after, id, declined) {
    const me0 = before.find((b) => b.id === id), me1 = after.find((b) => b.id === id), out = [];
    const near = (a, b) => {
      const hard = a.activity === "strength" ? [a, b] : [b, a], gap = (dayOf2(hard[1]) - dayOf2(hard[0])) / D;
      return gap === 0 || gap === 1;
    };
    for (const b of live(after)) {
      if (b.id === id || declined.includes(b.id)) continue;
      const pair = me1.activity === "strength" && b.activity === "long_run" || me1.activity === "long_run" && b.activity === "strength";
      if (me1.group && b.group === me1.group) out.push({ id: b.id, linked: true });
      else if (pair && near(me1, b) && !near(me0, b)) out.push({ id: b.id, linked: false });
    }
    return out.sort((a, b) => ms(after.find((x) => x.id === a.id).start) - ms(after.find((x) => x.id === b.id).start));
  }
  function question(blocks, pend) {
    const title = (id) => blocks.find((b) => b.id === id)?.title ?? "that workout", items = pend.items;
    const names = join([title(pend.blockId), ...items.map(title)]);
    const text = pend.linked ? `${names} are part of the same plan. Move them together?` : `${title(pend.blockId)} now lands next to ${join(items.map(title))}. Move them together?`;
    const answers = items.length === 1 ? [{ id: "all", label: `Yes, move ${title(items[0])} too` }, { id: "none", label: "No, just this one" }] : [{ id: "all", label: "Move all" }, { id: `only:${items[0]}`, label: `Only ${title(items[0])}` }, { id: "none", label: "No, just this one" }];
    return { text, answers };
  }
  function settle(w, st, blocks, id, notes) {
    const me = blocks.find((b) => b.id === id), chain = st.chain ?? [], i = chain.indexOf(id);
    const exists = (x) => blocks.some((b) => b.id === x && !b.cancelled);
    const followers = i >= 0 ? chain.slice(i + 1).filter(exists) : [];
    const clash = live(blocks).filter((b) => b.id !== id && !followers.includes(b.id) && overlap(b, me)).sort((a, b) => ms(a.start) - ms(b.start)).map((b) => b.id);
    if (!followers.length && !clash.length) return blocks;
    const r = cascade(live(blocks), [id, ...clash, ...followers], { events: w.events, limit: i >= 0 && st.limit ? ms(st.limit) : Infinity, chained: new Set(followers) });
    const placed = new Map(r.blocks.map((b) => [b.id, b]));
    if (r.unplaced.length) notes.push(`There is no room for ${join(r.unplaced.map((x) => blocks.find((b) => b.id === x).title))} after this change.`);
    return blocks.filter((b) => !(r.unplaced.includes(b.id) && b.isNew)).map((b) => {
      const p = placed.get(b.id);
      if (!p?.moved) return b;
      const { moved, ...rest } = p;
      return { ...rest, reason: followers.includes(b.id) ? `Moved to stay after ${me.title}.` : `Moved to make room for ${me.title}.` };
    });
  }
  function applyMove(w, st, blocks, id, s, why, notes) {
    const me = blocks.find((b) => b.id === id), delta = s - ms(me.start);
    const again = st.pending?.blockId === id ? st.pending : null;
    if (st.pending && !again) st.declined = [.../* @__PURE__ */ new Set([...st.declined, st.pending.blockId, ...st.pending.items])];
    st.pending = null;
    const moved = blocks.map((b) => b.id === id ? { ...b, start: iso(s), end: iso(s + dur(b)), reason: why } : b);
    const next = settle(w, st, moved, id, notes);
    const settled = new Set(next.filter((b) => b.id !== id && b.start !== moved.find((x) => x.id === b.id).start).map((b) => b.id));
    const rel = again ? again.items.map((x) => ({ id: x, linked: again.linked })) : related(blocks, next, id, st.declined).filter((r) => !settled.has(r.id));
    if (rel.length && (delta || again)) st.pending = { blockId: id, delta: delta + (again?.delta ?? 0), items: rel.map((r) => r.id), linked: rel.every((r) => r.linked) };
    st.primary = id;
    return next;
  }
  function doAdd(w, st, blocks, intent, solver3, notes) {
    const n = blocks.filter((b2) => /^new-\d+$/.test(b2.id)).reduce((m, b2) => Math.max(m, +b2.id.slice(4)), 0) + 1, id = `new-${n}`;
    if (intent.activity === "rest") {
      const day = Math.max(intent.hint.day ?? w.today, w.today), same = live(blocks).filter((b2) => dayOf2(b2) === day);
      if (same.length) notes.push(`You still have ${join(same.map((b2) => b2.title))} that day; say "skip" to drop it.`);
      st.primary = id;
      return { blocks: [...blocks, { id, title: intent.title ?? "Rest day", activity: "rest", start: iso(day), end: iso(day + D), allDay: true, isNew: true, reason: "A full day with no workout.", ...intent.sessionId ? { sessionId: intent.sessionId } : {} }], message: `Rest day ${w.dayWord(day)}.` };
    }
    const found = place(w, solver3, blocks, intent.minutes * MIN, intent.hint, intent.activity);
    if (!found) return { blocks, message: "I could not find free time in the next 30 days." };
    if (found.note) notes.push(found.note);
    const b = { id, title: intent.title, activity: intent.activity, start: iso(found.s), end: iso(found.s + intent.minutes * MIN), isNew: true, reason: found.why, ...intent.sessionId ? { sessionId: intent.sessionId } : {} };
    st.primary = id;
    return { blocks: [...blocks, b], message: `${b.title} ${range(w, b)}.` };
  }
  function doMove(w, st, blocks, intent, solver3, notes) {
    const me = blocks.find((b) => b.id === intent.target), length = dur(me), others = blocks.filter((b) => b.id !== me.id);
    const o = { events: w.events, blocks: others }, s0 = ms(me.start), day = Math.max(dayOf2(me), w.today), hint = { ...intent.hint };
    const open = (s2) => s2 >= w.from && isFree(s2, s2 + length, { ...o, meals: false });
    let s = null, why = null;
    if (intent.relative) {
      const want = s0 + intent.relative * MIN, size = Math.abs(intent.relative);
      const how = `${size % 1440 ? plural(size, "minute") : plural(size / 1440, "day")} ${intent.relative > 0 ? "later" : "earlier"}`;
      if (open(want)) {
        s = want;
        why = `${cap(how)}, as you asked.`;
      } else {
        s = solver3.finder(Math.max(want, w.from), length, o);
        why = s === null ? null : `${cap(how)} is taken, so this is the next free time after it.`;
      }
    } else if (intent.soft) {
      const lo = minOfDay(s0), window = intent.soft === "later" ? [Math.max(lo + 60, 540), WINDOW[1]] : [Math.max(WINDOW[0], lo - 180), lo];
      s = solver3.finder(Math.max(w.from, day), length, { ...o, window, limit: day + D });
      if (s !== null) why = `First free ${length / MIN} minutes ${intent.soft} ${w.onDay(s)}.`;
      else {
        s = intent.soft === "later" ? solver3.finder(Math.max(ms(me.end), w.from), length, o) : null;
        if (s !== null) {
          why = `Next free ${length / MIN} minutes ${w.onDay(s)}.`;
          notes.push("Nothing later fits that day, so I picked the next free time.");
        }
      }
    } else if (hint.any) {
      if (hint.day === null) {
        hint.day = day;
        hint.span = 1;
      }
      const same = hint.day + minOfDay(s0) * MIN;
      if (!hint.timed && hint.span === 1 && same !== s0 && open(same)) {
        s = same;
        why = `Same time ${w.onDay(s)}; that time is free.`;
      } else {
        const found = place({ ...w, usual: [] }, solver3, others, length, hint, me.activity);
        if (found) {
          s = found.s;
          why = found.why;
          if (found.note) notes.push(found.note);
        }
      }
    } else {
      s = solver3.finder(Math.max(ms(me.end), w.from), length, o);
      if (s !== null) why = `Next free ${length / MIN} minutes after the old time.`;
    }
    if (s === null) return { blocks, message: `I could not find another time for ${me.title}.` };
    if (s === s0) return { blocks, message: `${me.title} is already at that time.` };
    const next = applyMove(w, st, blocks, me.id, s, why, notes), now = next.find((b) => b.id === me.id);
    return { blocks: next, message: `${me.title} moves to ${range(w, now)}.` };
  }
  function doResize(w, st, blocks, intent, solver3, notes) {
    const me = blocks.find((b) => b.id === intent.target), old = dur(me) / MIN;
    const minutes = Math.min(240, Math.max(10, Math.round((intent.minutes ?? old + intent.delta) / 5) * 5));
    if (minutes === old) return { blocks, message: `${me.title} is already ${old} minutes.` };
    const length = minutes * MIN, others = blocks.filter((b) => b.id !== me.id), day = dayOf2(me);
    let s = ms(me.start), why = `Now ${minutes} minutes instead of ${old}; same start.`;
    if (!isFree(s, s + length, { events: w.events, meals: false })) {
      s = solver3.finder(Math.max(w.from, day), length, { events: w.events, blocks: others, limit: day + D });
      if (s === null) return { blocks, message: `There is no room to make ${me.title} ${minutes} minutes ${w.onDay(day)}.` };
      why = `Now ${minutes} minutes instead of ${old}; moved to ${at(s)} so it fits.`;
    }
    const sized = blocks.map((b) => b.id === me.id ? { ...b, start: iso(s), end: iso(s + length), reason: why } : b);
    st.primary = me.id;
    return { blocks: settle(w, st, sized, me.id, notes), message: `${me.title} ${w.dayWord(s)} is now ${minutes} minutes.` };
  }
  function doCancel(w, st, blocks, intent) {
    const me = blocks.find((b) => b.id === intent.target);
    st.primary = null;
    if (st.pending && (st.pending.blockId === me.id || st.pending.items.includes(me.id))) st.pending = null;
    if (me.isNew) return { blocks: blocks.filter((b) => b.id !== me.id), message: `Okay, ${me.title} is off the plan.` };
    const next = blocks.map((b) => b.id === me.id ? { ...b, start: b.was.start, end: b.was.end, cancelled: true, reason: "Skipped; nothing else moves." } : b);
    return { blocks: next, message: `${me.title} ${w.dayWord(ms(me.was.start))} is skipped.` };
  }
  function doRace(w, st, blocks, intent, solver3, notes) {
    const keep = blocks.filter((b) => !/^race-/.test(b.id));
    if (intent.day === null) {
      st.awaiting = "race";
      return { blocks: keep, message: "When is your race?", ask: { text: "When is your race?", answers: [] } };
    }
    const race = intent.day, rest = race - D, name = `${weekday(race)} ${MONTHS2[new Date(race).getUTCMonth()]} ${new Date(race).getUTCDate()}`;
    Object.assign(st, { awaiting: null, pending: null, chain: [], limit: iso(rest), race: iso(race), primary: null });
    const plan2 = { deadline: rest, from: race - 8 * D, variants: RACE_RUNS, apart: true };
    const placed = rest > w.from ? solver3.steps(plan2, { events: w.events, blocks: live(keep), now: iso(w.nowMs) }) : [];
    const out = [...keep];
    for (const [i, p] of placed.entries()) {
      const days = (race - dayStart(p.s)) / D, [title, activity] = RACE_NAMES[i];
      out.push({ id: `race-${i + 1}`, title, activity, start: iso(p.s), end: iso(p.s + p.minutes * MIN), isNew: true, reason: `${i ? "Easy run to stay fresh" : "Last long run"}, ${plural(days, "day")} before the race.` });
      st.chain.push(`race-${i + 1}`);
    }
    if (rest >= w.today) out.push({ id: "race-rest", title: "Rest day", activity: "rest", start: iso(rest), end: iso(race), allDay: true, isNew: true, reason: `Rest the day before the race on ${name}.` });
    if (placed.length < RACE_NAMES.length) notes.push(placed.length ? `Only ${placed.length} of ${RACE_NAMES.length} runs fit before the race.` : "There is no time left for a run before the race.");
    else if (placed.some((p, i) => p.minutes !== RACE_RUNS[0][i])) notes.push("Time is tight, so I shortened the runs.");
    return { blocks: out, message: `Race on ${name}: ${plural(placed.length, "run")}${rest >= w.today ? " and a rest day the day before" : ""}.` };
  }
  function doDrag(w, st, blocks, change, notes) {
    const me = blocks.find((b) => b.id === String(change.id ?? change.blockId)), raw = ms(w.z.wall(change.start) ?? "");
    if (!me || me.cancelled) return { blocks, message: "That item is not part of this plan." };
    if (!Number.isFinite(raw)) throw fail("BadChange");
    if (me.allDay) {
      const day = dayStart(raw);
      return { blocks: blocks.map((b) => b.id === me.id ? { ...b, start: iso(day), end: iso(day + D), reason: "Moved by you." } : b), message: `${me.title} moves to ${w.dayWord(day)}.` };
    }
    const length = dur(me), want = Math.round(raw / (15 * MIN)) * 15 * MIN;
    const inChain = (st.chain ?? []).includes(me.id), limit = inChain && st.limit ? ms(st.limit) : Infinity;
    if (want + length > limit) return { blocks, message: `${me.title} has to end before the rest day.` };
    let s = want, why = "Moved by you.";
    if (!isFree(s, s + length, { events: w.events, meals: false })) {
      const hit = w.events.find((e) => s < ms(e.end) && s + length > ms(e.start));
      s = greedyFinder(want, length, { events: w.events, meals: false, window: [WINDOW[0], AWAKE_END], limit: Math.min(limit, want + 30 * D) });
      if (s === null) return { blocks, message: `There is no free time there for ${me.title}.` };
      why = `${hit.title} is at that time, so this is the next free time after it.`;
    }
    const next = applyMove(w, st, blocks, me.id, s, why, notes), now = next.find((b) => b.id === me.id);
    return { blocks: next, message: `${me.title} moves to ${range(w, now)}.` };
  }
  function doAnswer(w, st, blocks, change) {
    const pend = st.pending, id = String(change.answerId ?? change.id ?? "");
    if (!pend) return { blocks, message: "There is no open question." };
    const ok = id === "all" ? pend.items : pend.items.filter((x) => id === `only:${x}`);
    if (!ok.length && id !== "none") throw fail("BadChange");
    st.pending = null;
    st.declined = [.../* @__PURE__ */ new Set([...st.declined, ...ok.length ? pend.items.filter((x) => !ok.includes(x)) : [pend.blockId, ...pend.items]])];
    if (!ok.length) return { blocks, message: "Okay, I left the other workouts where they are." };
    const me = blocks.find((b) => b.id === pend.blockId), rest = blocks.filter((b) => b.cancelled || b.allDay);
    const shifted = shiftConfirmed(live(blocks), pend, ok, w.events).map(({ moved, ...b }) => moved ? { ...b, reason: `Moved together with ${me.title}, as you confirmed.` } : b);
    const by = new Map([...shifted, ...rest].map((b) => [b.id, b]));
    return { blocks: blocks.map((b) => by.get(b.id)), message: `${join(ok.map((x) => by.get(x).title))} ${ok.length > 1 ? "move" : "moves"} too.` };
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  function statusOf(b) {
    if (b.isNew) return "new";
    if (b.cancelled) return "cancelled";
    if (dur(b) !== ms(b.was.end) - ms(b.was.start)) return "resized";
    return b.start !== b.was.start ? "moved" : null;
  }
  function finish(w, st, blocks, kind, done, notes, replaces) {
    const proposed = [];
    for (const b of blocks) {
      const status = statusOf(b);
      if (status) proposed.push({ id: b.id, ...b.sessionId ? { sessionId: b.sessionId } : {}, activity: b.activity, title: b.title, start: w.z.local(b.start), end: w.z.local(b.end), minutes: b.allDay ? 0 : dur(b) / MIN, status, reason: b.reason ?? "Changed in this plan." });
    }
    proposed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
    const ask = st.pending ? question(blocks, st.pending) : done.ask ?? null;
    const message = [done.message, ...notes].filter(Boolean).join(" ");
    const state = { kind, primary: st.primary, pending: st.pending, declined: st.declined, chain: st.chain, limit: st.limit, race: st.race, awaiting: st.awaiting };
    const out = { ok: true, kind: ask ? "question" : kind, message, proposed, ...ask ? { question: ask } : {}, undoToken: `u-${hash(JSON.stringify([w.now, kind, proposed, ask]))}`, ...replaces ? { replaces } : {}, state };
    const changed = new Set(proposed.map((p) => p.id));
    return { out, check: { blocks, events: w.events, deadline: st.limit ? ms(st.limit) : null, chain: st.chain ?? [], changed } };
  }
  function apply(w, st, blocks, intent, solver3, notes) {
    switch (intent.kind) {
      case "add":
        return doAdd(w, st, blocks, intent, solver3, notes);
      case "move":
        return doMove(w, st, blocks, intent, solver3, notes);
      case "resize":
        return doResize(w, st, blocks, intent, solver3, notes);
      case "cancel":
        return doCancel(w, st, blocks, intent);
      case "race":
        return doRace(w, st, blocks, intent, solver3, notes);
      default:
        return { blocks, message: intent.message };
    }
  }
  var reader = (w, st, blocks) => ({ nowMs: w.nowMs, blocks, primary: st.primary, awaiting: st.awaiting, onDay: w.onDay });
  function understand(w, st, blocks, source, notes) {
    if (source.intent !== void 0 && source.intent !== null) {
      const got = fromIntent(source.intent, { nowMs: w.nowMs, blocks, pace: w.pace, usual: w.usual });
      notes.push(...got.notes);
      return got.intent;
    }
    return read(source.text, reader(w, st, blocks));
  }
  function planWith(input, solver3) {
    const w = world(input);
    if (typeof input.request !== "string" && (input.intent === void 0 || input.intent === null)) throw fail("BadRequest");
    const st = { kind: "none", primary: null, pending: null, declined: w.declined, chain: null, limit: null, race: null, awaiting: null }, early = [], notes = [];
    const intent = understand(w, st, w.blocks, { intent: input.intent, text: input.request }, early);
    const done = apply(w, st, w.blocks, intent, solver3, notes);
    return finish(w, st, done.blocks, intent.kind, done, [...notes, ...early], null);
  }
  function replanWith(input, solver3) {
    const w = world(input), { blocks, st } = restore(w, input.plan), change = input.change, notes = [];
    if (!change || typeof change !== "object") throw fail("BadChange");
    const isNew = (id) => blocks.some((b) => b.id === id && b.isNew), keeps = st.kind === "add" || st.kind === "race";
    let done, kind = st.kind;
    if (change.type === "drag") {
      done = doDrag(w, st, blocks, change, notes);
      kind = keeps && isNew(String(change.id ?? change.blockId)) ? st.kind : "move";
    } else if (change.type === "answer") done = doAnswer(w, st, blocks, change);
    else if (change.type === "text" && (typeof change.text === "string" || change.intent !== void 0 && change.intent !== null)) {
      const intent = understand(w, st, blocks, change, notes);
      if (st.pending && intent.kind !== "none" && intent.kind !== "move") {
        st.declined = [.../* @__PURE__ */ new Set([...st.declined, st.pending.blockId, ...st.pending.items])];
        st.pending = null;
      }
      kind = intent.kind === "none" || keeps && intent.target && isNew(intent.target) ? st.kind : intent.kind;
      done = apply(w, st, blocks, intent, solver3, notes);
      if (intent.kind === "none") {
        const r = finish(w, st, done.blocks, kind, done, notes, input.plan.undoToken ?? null);
        r.out.kind = "none";
        return r;
      }
    } else throw fail("BadChange");
    return finish(w, st, done.blocks, kind, done, notes, input.plan.undoToken ?? null);
  }

  // src/planner/check.mjs
  var overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start);
  function violations(blocks, { events = [], deadline = null, chain = [] } = {}) {
    const out = [], ids = /* @__PURE__ */ new Set();
    for (const b of blocks) {
      const s = ms(b.start), e = ms(b.end);
      if (typeof b.id !== "string" || ids.has(b.id) || !Number.isFinite(s) || !Number.isFinite(e) || e < s || e === s && !b.allDay) out.push({ code: "shape", block: b.id });
      ids.add(b.id);
    }
    if (out.length) return out;
    const real2 = blocks.filter((b) => !b.cancelled && !b.allDay);
    for (const b of real2) for (const ev of events) if (overlaps(b, ev)) out.push({ code: "overlap-event", block: b.id, event: ev.id });
    for (let i = 0; i < real2.length; i++) for (let j = i + 1; j < real2.length; j++) if (overlaps(real2[i], real2[j])) out.push({ code: "overlap-block", block: real2[i].id, other: real2[j].id });
    const steps2 = chain.map((id) => real2.find((b) => b.id === id)).filter(Boolean);
    for (const [i, b] of steps2.entries()) {
      if (deadline !== null && ms(b.end) > deadline) out.push({ code: "deadline", block: b.id });
      if (i && ms(b.start) < ms(steps2[i - 1].end)) out.push({ code: "order", block: b.id, after: steps2[i - 1].id });
    }
    return out;
  }

  // src/planner/approaches/hybrid.mjs
  var problems = ({ check }) => violations(check.blocks, check).filter((v) => check.changed.has(v.block) || check.changed.has(v.other)).map((v) => v.code);
  function pick(run) {
    const first = run(rules_default), bad2 = problems(first);
    if (!bad2.length) return { ...first.out, state: { ...first.out.state, used: "rules" } };
    const second = run(search_default);
    return { ...second.out, state: { ...second.out.state, used: "search" } };
  }
  var plan = (input) => pick((solver3) => planWith(input, solver3));
  var replan = (input) => pick((solver3) => replanWith(input, solver3));
  var hybrid_default = { plan, replan };

  // src/phone/entry.mjs
  var call = (argsJson, fn) => {
    let args;
    try {
      args = JSON.parse(argsJson);
    } catch {
      return JSON.stringify(errorOf(fail("BadJSON")));
    }
    try {
      return JSON.stringify(fn(args));
    } catch (e) {
      return JSON.stringify(errorOf(e));
    }
  };
  var calendarPlan = (argsJson) => call(argsJson, hybrid_default.plan);
  var calendarReplan = (argsJson) => call(argsJson, hybrid_default.replan);
  var calendarIntentSchema = () => JSON.stringify(INTENT_SCHEMA);
  Object.assign(globalThis, { calendarPlan, calendarReplan, calendarIntentSchema });
})();
