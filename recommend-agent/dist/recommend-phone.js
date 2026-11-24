(() => {
  // src/pytime.mjs
  var US_MIN = 6e7;
  var US_HOUR = 36e8;
  var US_DAY = 864e8;
  var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var InputError = class extends Error {
    constructor(code) {
      super(code);
      this.name = "InputError";
      this.code = code;
    }
  };
  var mod = (a, b) => (a % b + b) % b;
  var p2 = (n) => String(n).padStart(2, "0");
  var DT = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d{1,6})\d*)?)?\s*(Z|z|[+-]\d\d(?::?\d\d)?)$/;
  var DAY = /^(\d{4})-(\d\d)-(\d\d)$/;
  function parseDay(v) {
    const m = typeof v === "string" ? DAY.exec(v) : null;
    if (!m) throw new InputError("bad_date");
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (dayISO(ms / 864e5) !== v) throw new InputError("bad_date");
    return ms / 864e5;
  }
  function parseDT(v) {
    if (v && typeof v === "object" && Number.isFinite(v.mic) && Number.isFinite(v.off)) return v;
    const m = typeof v === "string" ? DT.exec(v.trim()) : null;
    if (!m) throw new InputError("bad_datetime");
    let off = 0;
    if (m[8] !== "Z" && m[8] !== "z") {
      const d = m[8].replace(":", "");
      off = (d[0] === "-" ? -1 : 1) * (+d.slice(1, 3) * 60 + +(d.slice(3, 5) || 0));
    }
    const day = parseDay(`${m[1]}-${m[2]}-${m[3]}`);
    const mic = day * US_DAY + +m[4] * US_HOUR + +m[5] * US_MIN + +(m[6] || 0) * 1e6 + +(m[7] || "").padEnd(6, "0") - off * US_MIN;
    return { mic, off };
  }
  var local = (dt) => dt.mic + dt.off * US_MIN;
  var dayOf = (dt) => Math.floor(local(dt) / US_DAY);
  var hourOf = (dt) => Math.floor(mod(local(dt), US_DAY) / US_HOUR);
  var minuteOf = (dt) => Math.floor(mod(local(dt), US_HOUR) / US_MIN);
  var weekdayOf = (day) => mod(day + 3, 7);
  var dayISO = (day) => new Date(day * 864e5).toISOString().slice(0, 10);
  var atDay = (day, off, hour = 0, minute = 0) => ({ mic: day * US_DAY + hour * US_HOUR + minute * US_MIN - off * US_MIN, off });
  var addUs = (dt, mic) => ({ mic: dt.mic + mic, off: dt.off });
  function isoDT(dt, z = false) {
    const l = local(dt);
    const inDay = mod(l, US_DAY);
    const sec = Math.floor(mod(inDay, US_MIN) / 1e6);
    const micro = mod(inDay, 1e6);
    const a = Math.abs(dt.off);
    const offset = z && dt.off === 0 ? "Z" : `${dt.off < 0 ? "-" : "+"}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
    return `${dayISO(Math.floor(l / US_DAY))}T${p2(Math.floor(inDay / US_HOUR))}:${p2(Math.floor(mod(inDay, US_HOUR) / US_MIN))}:${p2(sec)}${micro ? `.${String(micro).padStart(6, "0")}` : ""}${offset}`;
  }
  function clock(hour, minute = 0) {
    const h = mod(hour, 12) === 0 ? 12 : mod(hour, 12);
    return `${h}${minute ? `:${p2(minute)}` : ""} ${mod(hour, 24) < 12 ? "AM" : "PM"}`;
  }
  var hhmm = (dt) => `${p2(hourOf(dt))}:${p2(minuteOf(dt))}`;

  // src/pynum.mjs
  function pyRound(x, n = 0) {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
    const [int, frac] = Math.abs(x).toFixed(100).split(".");
    const keep = frac.slice(0, n);
    const rest = frac.slice(n);
    let digits = BigInt(int + keep);
    const half = `5${"0".repeat(rest.length - 1)}`;
    if (rest > half || rest === half && digits % 2n === 1n) digits += 1n;
    const s = digits.toString().padStart(n + 1, "0");
    const out = Number(n ? `${s.slice(0, s.length - n)}.${s.slice(s.length - n)}` : s);
    return x < 0 ? -out : out;
  }
  function pySum(values) {
    let total = 0;
    let c = 0;
    for (const x of values) {
      const t = total + x;
      c += Math.abs(total) >= Math.abs(x) ? total - t + x : x - t + total;
      total = t;
    }
    return c && Number.isFinite(c) ? total + c : total;
  }
  var f64 = new Float64Array(1);
  var u64 = new BigUint64Array(f64.buffer);
  function parts(x) {
    f64[0] = x;
    const bits = u64[0];
    const e = Number(bits >> 52n & 0x7ffn);
    const m = bits & 0xfffffffffffffn;
    const mant = e === 0 ? m : m | 1n << 52n;
    return { mant: bits >> 63n ? -mant : mant, exp: (e === 0 ? 1 : e) - 1075 };
  }
  function scale(x, e) {
    for (; e > 0; e -= 1) x *= 2;
    for (; e < 0; e += 1) x *= 0.5;
    return x;
  }
  function pyMean(values) {
    const ps = values.map(parts);
    const emin = Math.min(...ps.map((p) => p.exp));
    let sum = 0n;
    for (const p of ps) sum += p.mant << BigInt(p.exp - emin);
    if (sum === 0n) return 0;
    const neg = sum < 0n;
    const a = neg ? -sum : sum;
    const n = BigInt(values.length);
    const k = Math.max(0, 70 + n.toString(2).length - a.toString(2).length);
    let q = (a << BigInt(k)) / n;
    if ((a << BigInt(k)) % n !== 0n) q |= 1n;
    const out = scale(Number(q), emin - k);
    return neg ? -out : out;
  }
  function pyMedian(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  var pyFloat = (x) => Number.isInteger(x) ? `${x}.0` : String(x);

  // data/workout_ideas/running.json
  var running_default = {
    ideas: [
      {
        id: "idea-last-long-run",
        title: "Last long run",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "taper",
        when: "14 days out",
        quote: "Do your last long run. Keep it steady, not heroic.",
        sourceTitle: "Half Marathon Taper: 2-Week Plan Before Race Day",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-short-tempo-run-or-reduced-interval-session",
        title: "Short tempo run or reduced interval session",
        kind: "other",
        activityType: "Running",
        minutes: null,
        intensity: "moderate",
        phase: "taper",
        when: "10 to 12 days out",
        quote: "Do your last real workout, such as a short tempo run or reduced interval session.",
        sourceTitle: "Half Marathon Taper: 2-Week Plan Before Race Day",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-relaxed-strides",
        title: "Relaxed strides",
        kind: "strides",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "race week",
        when: "3 to 4 days out",
        quote: "Add a few relaxed strides if your legs feel good.",
        sourceTitle: "Half Marathon Taper: 2-Week Plan Before Race Day",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-very-short-shakeout-jog",
        title: "Very short shakeout jog",
        kind: "shakeout",
        activityType: "Running",
        minutes: null,
        intensity: "very easy",
        phase: "race week",
        when: "Day before",
        quote: "Rest or do a very short shakeout jog. Nothing that leaves fatigue behind.",
        sourceTitle: "Half Marathon Taper: 2-Week Plan Before Race Day",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-strides",
        title: "Strides",
        kind: "strides",
        activityType: "Running",
        minutes: null,
        intensity: "moderate",
        phase: "taper",
        when: "2-3 times during race week",
        quote: "Strides (4-6 x 20-30 seconds) 2-3 times",
        sourceTitle: "Taper Week Strategies 2026: Complete Guide to Pre-Race Tapering for Peak Performance",
        source: "RunBikeCalc"
      },
      {
        id: "idea-shakeout-jog",
        title: "Shakeout jog",
        kind: "shakeout",
        activityType: "Running",
        minutes: 15,
        intensity: "very easy",
        phase: "race week",
        when: "day before the race",
        quote: "Shakeout jog day before (15-20 min easy)",
        sourceTitle: "Taper Week Strategies 2026: Complete Guide to Pre-Race Tapering for Peak Performance",
        source: "RunBikeCalc"
      },
      {
        id: "idea-light-stretching-and-mobility-work",
        title: "Light stretching and mobility work",
        kind: "mobility",
        activityType: "Other",
        minutes: null,
        intensity: "very easy",
        phase: "taper",
        when: "during taper",
        quote: "Light stretching and mobility work",
        sourceTitle: "Taper Week Strategies 2026: Complete Guide to Pre-Race Tapering for Peak Performance",
        source: "RunBikeCalc"
      },
      {
        id: "idea-short-strides",
        title: "Short strides",
        kind: "strides",
        activityType: "Running",
        minutes: null,
        intensity: "moderate",
        phase: "race week",
        when: "final 2-3 days",
        quote: "Short strides (4x20 sec) with long rest",
        sourceTitle: "Taper Week Strategies 2026: Complete Guide to Pre-Race Tapering for Peak Performance",
        source: "RunBikeCalc"
      },
      {
        id: "idea-foam-rolling-and-dynamic-stretching",
        title: "Foam Rolling and Dynamic Stretching",
        kind: "mobility",
        activityType: "Other",
        minutes: 15,
        intensity: "very easy",
        phase: "race week",
        when: "Monday",
        quote: "Spend 15 minutes on a foam roller or do some light dynamic stretching.",
        sourceTitle: "How to Train the Week Before a Half Marathon: Taper Tips",
        source: "Sport2gether"
      },
      {
        id: "idea-sharpening-run-with-strides",
        title: "Sharpening Run with Strides",
        kind: "strides",
        activityType: "Running",
        minutes: 25,
        intensity: "moderate",
        phase: "race week",
        when: "Tuesday",
        quote: 'Run 20\u201330 minutes total. Include 3 or 4 "strides"\u2014these are 20-second accelerations where you reach about 90% of your max speed.',
        sourceTitle: "How to Train the Week Before a Half Marathon: Taper Tips",
        source: "Sport2gether"
      },
      {
        id: "idea-easy-maintenance-run",
        title: "Easy Maintenance Run",
        kind: "easy run",
        activityType: "Running",
        minutes: 25,
        intensity: "very easy",
        phase: "race week",
        when: "Wednesday",
        quote: "20\u201330 minutes at a very relaxed, conversational pace.",
        sourceTitle: "How to Train the Week Before a Half Marathon: Taper Tips",
        source: "Sport2gether"
      },
      {
        id: "idea-pre-race-shakeout",
        title: "Pre-Race Shakeout",
        kind: "shakeout",
        activityType: "Running",
        minutes: 12,
        intensity: "very easy",
        phase: "race week",
        when: "Saturday",
        quote: "A 10\u201315 minute shakeout run followed by 2 light strides.",
        sourceTitle: "How to Train the Week Before a Half Marathon: Taper Tips",
        source: "Sport2gether"
      },
      {
        id: "idea-4-x-200m-speed-runs",
        title: "4 x 200m speed runs",
        kind: "strides",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "taper",
        when: "Tuesday of Week 11 (2 weeks before race)",
        quote: "Sprint at 3K pace to feel the rapid leg turnover rhythm",
        sourceTitle: "Half Marathon Taper Strategy for the Final 2 Weeks: Preserving Your Leg Speed - \u904B\u52D5\u77E5\u8B58\uFF5CCT Yeh \u516C\u8DEF\u8ECA\u57FA\u5730",
        source: "CT Yeh"
      },
      {
        id: "idea-6-x-100m-strides",
        title: "6 x 100m strides",
        kind: "strides",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "race week",
        when: "Tuesday of Week 12 (Race Week)",
        quote: "Gradually accelerate to 90% of top speed, then decelerate naturally",
        sourceTitle: "Half Marathon Taper Strategy for the Final 2 Weeks: Preserving Your Leg Speed - \u904B\u52D5\u77E5\u8B58\uFF5CCT Yeh \u516C\u8DEF\u8ECA\u57FA\u5730",
        source: "CT Yeh"
      },
      {
        id: "idea-3-km-at-goal-pace",
        title: "3 km at goal pace",
        kind: "other",
        activityType: "Running",
        minutes: null,
        intensity: "moderate",
        phase: "race week",
        when: "Wednesday of Week 12 (Race Week)",
        quote: "Insert 2\u20133 km at half marathon goal pace into easy runs to confirm \u201Cyour body remembers that rhythm\u201D",
        sourceTitle: "Half Marathon Taper Strategy for the Final 2 Weeks: Preserving Your Leg Speed - \u904B\u52D5\u77E5\u8B58\uFF5CCT Yeh \u516C\u8DEF\u8ECA\u57FA\u5730",
        source: "CT Yeh"
      },
      {
        id: "idea-light-cross-training",
        title: "Light cross-training",
        kind: "cross-training",
        activityType: "Yoga",
        minutes: null,
        intensity: "very easy",
        phase: "taper",
        when: "During the taper period",
        quote: "Substitute light cross-training (swimming, yoga) for the urge to run more",
        sourceTitle: "Half Marathon Taper Strategy for the Final 2 Weeks: Preserving Your Leg Speed - \u904B\u52D5\u77E5\u8B58\uFF5CCT Yeh \u516C\u8DEF\u8ECA\u57FA\u5730",
        source: "CT Yeh"
      },
      {
        id: "idea-overhead-squats",
        title: "Overhead Squats",
        kind: "mobility",
        activityType: "FunctionalStrengthTraining",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before a run",
        quote: "Start with 1 set x 10 reps.",
        sourceTitle: "The Perfect Running Warm-Up: 5 Pre-Run Mobility Exercises",
        source: "TrainingPeaks"
      },
      {
        id: "idea-knee-bends",
        title: "Knee Bends",
        kind: "mobility",
        activityType: "FunctionalStrengthTraining",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before a run",
        quote: "Start with 8-10 reps and build to 15 reps for each leg.",
        sourceTitle: "The Perfect Running Warm-Up: 5 Pre-Run Mobility Exercises",
        source: "TrainingPeaks"
      },
      {
        id: "idea-front-lunge",
        title: "Front Lunge",
        kind: "mobility",
        activityType: "FunctionalStrengthTraining",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before a run",
        quote: "Start with 1 set x 3-5 reps if lunges aren't part of your regular routine.",
        sourceTitle: "The Perfect Running Warm-Up: 5 Pre-Run Mobility Exercises",
        source: "TrainingPeaks"
      },
      {
        id: "idea-side-lunge",
        title: "Side Lunge",
        kind: "mobility",
        activityType: "FunctionalStrengthTraining",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before a run",
        quote: "If you haven't been doing side lunges, start with 1 set x 3-5 reps.",
        sourceTitle: "The Perfect Running Warm-Up: 5 Pre-Run Mobility Exercises",
        source: "TrainingPeaks"
      },
      {
        id: "idea-pre-race-easy-jog",
        title: "Pre-Race Easy Jog",
        kind: "easy run",
        activityType: "Running",
        minutes: 10,
        intensity: "very easy",
        phase: "race week",
        when: "before the race",
        quote: "Begin with a very easy jog for 10 minutes to raise core temperature without tiring yourself out.",
        sourceTitle: "The Importance of the Pre-Race Warm-Up: A Routine to Activate the Body and Calm the Mind",
        source: "Runlovers"
      },
      {
        id: "idea-dynamic-mobility-and-drills",
        title: "Dynamic Mobility and Drills",
        kind: "mobility",
        activityType: "Running",
        minutes: 5,
        intensity: "easy",
        phase: "race week",
        when: "before the race",
        quote: "Follow with 5 minutes of dynamic mobility and drills to \u201Cwake up\u201D joints and tendons specifically.",
        sourceTitle: "The Importance of the Pre-Race Warm-Up: A Routine to Activate the Body and Calm the Mind",
        source: "Runlovers"
      },
      {
        id: "idea-race-pace-strides",
        title: "Race Pace Strides",
        kind: "strides",
        activityType: "Running",
        minutes: 5,
        intensity: "moderate",
        phase: "race week",
        when: "before the race",
        quote: "Finish with 3\u20135 minutes of strides at race pace to \u201Ctrick\u201D your nervous system into readiness.",
        sourceTitle: "The Importance of the Pre-Race Warm-Up: A Routine to Activate the Body and Calm the Mind",
        source: "Runlovers"
      },
      {
        id: "idea-dynamic-leg-swings",
        title: "Dynamic leg swings",
        kind: "mobility",
        activityType: "Other",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before runs",
        quote: "10 to 15 front-to-back swings and 10 to 15 side-to-side swings per leg.",
        sourceTitle: "The Best Mobility Drills for Runners Who Want Fewer Injuries - Fitness Warrior Nation",
        source: "Fitness Warrior Nation"
      },
      {
        id: "idea-ankle-circles",
        title: "Ankle circles",
        kind: "mobility",
        activityType: "Other",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "before runs if your calves and ankles feel stiff",
        quote: "10 to 15 controlled circles each direction per ankle.",
        sourceTitle: "The Best Mobility Drills for Runners Who Want Fewer Injuries - Fitness Warrior Nation",
        source: "Fitness Warrior Nation"
      },
      {
        id: "idea-hip-flexor-stretch",
        title: "Hip flexor stretch",
        kind: "mobility",
        activityType: "Other",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "after a run or on recovery days",
        quote: "20 to 30 seconds per side after a run or on recovery days.",
        sourceTitle: "The Best Mobility Drills for Runners Who Want Fewer Injuries - Fitness Warrior Nation",
        source: "Fitness Warrior Nation"
      },
      {
        id: "idea-cat-cow",
        title: "Cat-cow",
        kind: "mobility",
        activityType: "Other",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "after long sitting and hard training",
        quote: "8 to 12 slow cycles.",
        sourceTitle: "The Best Mobility Drills for Runners Who Want Fewer Injuries - Fitness Warrior Nation",
        source: "Fitness Warrior Nation"
      },
      {
        id: "idea-10-minute-mobility-routine",
        title: "10-Minute Mobility Routine",
        kind: "mobility",
        activityType: "Yoga",
        minutes: 10,
        intensity: "easy",
        phase: "any",
        when: "Before running or on rest days",
        quote: "Try this practical 10-minute mobility routine for runners to loosen stiff hips and ankles.",
        sourceTitle: "Mobility Exercises for Runners: 10-Minute Routine",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-wall-ankle-rocks",
        title: "Wall Ankle Rocks",
        kind: "mobility",
        activityType: "Yoga",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "Before running or strength training",
        quote: "Stiff ankles or heels lifting during squats: Start With Wall ankle rocks.",
        sourceTitle: "Mobility Exercises for Runners: 10-Minute Routine",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-standing-hip-circles-and-90-90-hip-switches",
        title: "Standing Hip Circles and 90/90 Hip Switches",
        kind: "mobility",
        activityType: "Yoga",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "Before running or during a separate session",
        quote: "Hips feel stiff after sitting: Start With Standing hip circles and 90/90 hip switches.",
        sourceTitle: "Mobility Exercises for Runners: 10-Minute Routine",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-couch-stretch",
        title: "Couch Stretch",
        kind: "mobility",
        activityType: "Yoga",
        minutes: null,
        intensity: "easy",
        phase: "any",
        when: "After running or on rest days",
        quote: "Tightness through the front of the hip: Start With Couch stretch.",
        sourceTitle: "Mobility Exercises for Runners: 10-Minute Routine",
        source: "Runner's Blueprint"
      },
      {
        id: "idea-test-new-shoes-on-a-long-run",
        title: "Test new shoes on a long run",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "on one of your long-ish runs",
        quote: "Test them out early, on one of your long-ish runs, to make sure they indeed will work for you.",
        sourceTitle: "r/Marathon_Training on Reddit: How soon should I break in my new running shoes before a marathon?",
        source: "Reddit"
      },
      {
        id: "idea-short-test-runs-for-new-shoes",
        title: "Short test runs for new shoes",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "before the marathon",
        quote: "Try them on a few short runs and then on one of your final long runs just to make sure they don\u2019t start hurting in like hour 2.5.",
        sourceTitle: "r/Marathon_Training on Reddit: How soon should I break in my new running shoes before a marathon?",
        source: "Reddit"
      },
      {
        id: "idea-taper-run-in-new-shoes",
        title: "Taper run in new shoes",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "taper",
        when: "during your taper",
        quote: "I\u2019d wear them during your taper to make sure they don\u2019t hurt your feet",
        sourceTitle: "r/Marathon_Training on Reddit: How soon should I break in my new running shoes before a marathon?",
        source: "Reddit"
      },
      {
        id: "idea-long-run-in-race-shoes",
        title: "Long run in race shoes",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "on one of your final long runs",
        quote: "I give them at least one long run or approx ~2.5 - 3 hours.",
        sourceTitle: "r/Marathon_Training on Reddit: How soon should I break in my new running shoes before a marathon?",
        source: "Reddit"
      },
      {
        id: "idea-long-runs-in-new-race-shoes",
        title: "Long runs in new race shoes",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "4\u20136 weeks before race day",
        quote: "Buy new race shoes 4\u20136 weeks before race day and use them for all your long runs to accumulate break-in miles safely.",
        sourceTitle: "How Long to Break In Running Shoes? Miles, Not Days",
        source: "RunnersConnect"
      },
      {
        id: "idea-shoe-rotation-for-foam-recovery",
        title: "Shoe rotation for foam recovery",
        kind: "other",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "24\u201348 hours between runs",
        quote: "Alternating between two pairs during break-in gives each shoe time to recover between sessions.",
        sourceTitle: "How Long to Break In Running Shoes? Miles, Not Days",
        source: "RunnersConnect"
      },
      {
        id: "idea-blister-prevention-routine",
        title: "Blister prevention routine",
        kind: "other",
        activityType: "Other",
        minutes: null,
        intensity: "very easy",
        phase: "new shoes",
        when: "During break-in",
        quote: "Synthetic or merino wool socks, anti-chafing balm, and 24\u201348 hour recovery between runs cut blister risk significantly during break-in.",
        sourceTitle: "How Long to Break In Running Shoes? Miles, Not Days",
        source: "RunnersConnect"
      },
      {
        id: "idea-wear-new-shoes-around-the-house",
        title: "Wear new shoes around the house",
        kind: "other",
        activityType: "Walking",
        minutes: 180,
        intensity: "very easy",
        phase: "new shoes",
        when: "When you first get your new shoes",
        quote: "Wear them around the house for at least three hours a day.",
        sourceTitle: "How to Break in New Running Shoes: Easy Tips for a Comfy Fit",
        source: "My Elite Feet"
      },
      {
        id: "idea-short-walks-in-new-shoes",
        title: "Short walks in new shoes",
        kind: "walk",
        activityType: "Walking",
        minutes: 15,
        intensity: "very easy",
        phase: "new shoes",
        when: "Once your shoes feel comfortable at home",
        quote: "These 10-15 minute walks help your feet adjust gradually.",
        sourceTitle: "How to Break in New Running Shoes: Easy Tips for a Comfy Fit",
        source: "My Elite Feet"
      },
      {
        id: "idea-shorter-runs-at-half-distance",
        title: "Shorter runs at half distance",
        kind: "easy run",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "After a few days of short walks",
        quote: "After a few days, progress to shorter runs and cover about half your usual distance.",
        sourceTitle: "How to Break in New Running Shoes: Easy Tips for a Comfy Fit",
        source: "My Elite Feet"
      },
      {
        id: "idea-alternate-old-and-new-shoes",
        title: "Alternate old and new shoes",
        kind: "other",
        activityType: "Running",
        minutes: null,
        intensity: "easy",
        phase: "new shoes",
        when: "During the break-in period",
        quote: "Switch things up by alternating between your old shoes and your new running shoes.",
        sourceTitle: "How to Break in New Running Shoes: Easy Tips for a Comfy Fit",
        source: "My Elite Feet"
      }
    ]
  };

  // src/data.mjs
  var workoutIdeas = () => running_default.ideas ?? [];

  // src/memory.mjs
  var ACTIVITIES = ["run", "long_run", "walk", "strength", "yoga", "ride", "elliptical", "swim", "stretch", "rest", "other"];
  var INTENSITIES = ["easy", "steady", "hard"];
  var ACTIVE = ["saved", "confirmed"];
  var STOPPED = ["rejected", "stopped"];
  var FROM_HEALTH = {
    Running: "run",
    Walking: "walk",
    Cycling: "ride",
    Elliptical: "elliptical",
    Yoga: "yoga",
    Swimming: "swim",
    FunctionalStrengthTraining: "strength",
    TraditionalStrengthTraining: "strength",
    CoreTraining: "strength",
    Pilates: "stretch",
    Flexibility: "stretch",
    Cooldown: "stretch",
    MindAndBody: "stretch"
  };
  var own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
  var LABELS = { HighIntensityIntervalTraining: "HIIT", Hiking: "hike", Rowing: "rowing", CrossTraining: "cross-training" };
  var norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var activityOf = (healthType) => typeof healthType === "string" && healthType ? own(FROM_HEALTH, healthType) ?? "other" : null;
  var labelOf = (healthType) => own(LABELS, healthType) ?? String(healthType).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  var baseActivity = (activity) => activity === "long_run" ? "run" : activity;
  var isRun = (activity) => baseActivity(activity) === "run";
  function readMemory(memory) {
    if (memory === void 0 || memory === null) return { given: false, rows: [], keys: [], stoppedKeys: [], slots: [], stoppedSlots: [], first: () => null };
    if (typeof memory !== "object" || !Array.isArray(memory.rows)) throw new InputError("bad_memory");
    const valid = memory.rows.filter((r) => r && typeof r === "object" && typeof r.key === "string" && r.key);
    const rows = valid.filter((r) => r.state === void 0 || r.state === null || ACTIVE.includes(r.state));
    const stoppedKeys = [...new Set(valid.filter((r) => STOPPED.includes(r.state)).map((r) => r.key))];
    const keys = [...new Set(rows.map((r) => r.key))].filter((k) => !stoppedKeys.includes(k));
    const slots = [];
    const stoppedSlots = [];
    for (const r of valid) {
      const d = r.kind === "usual_slot" && r.data && typeof r.data === "object" ? r.data : null;
      const stopped = stoppedKeys.includes(r.key);
      if (!d || !stopped && !(rows.includes(r) && keys.includes(r.key)) || !ACTIVITIES.includes(d.activity) || !Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) continue;
      if (!Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23) continue;
      (stopped ? stoppedSlots : slots).push({
        key: r.key,
        weekday: d.weekday,
        activity: baseActivity(d.activity),
        hour: d.hour,
        minutes: Number.isFinite(d.minutes) && d.minutes > 0 ? d.minutes : null,
        label: d.activity === "other" && typeof d.label === "string" && d.label.trim() ? d.label.trim() : null,
        weeksSeen: d.weeksSeen ?? null,
        weeksTotal: d.weeksTotal ?? null,
        statement: typeof r.statement === "string" ? r.statement : ""
      });
    }
    const first = (kind) => rows.find((r) => r.kind === kind && keys.includes(r.key) && r.data && typeof r.data === "object") ?? null;
    return { given: true, rows: rows.filter((r) => keys.includes(r.key)), keys, stoppedKeys, slots, stoppedSlots, first };
  }
  function slotMatches(slot, healthType) {
    const activity = activityOf(healthType);
    if (activity === null || slot.activity !== activity) return false;
    return activity !== "other" || slot.label === null || [norm(healthType), norm(labelOf(healthType))].includes(norm(slot.label));
  }
  function slotFor(mem, weekday, healthType) {
    let hit = null;
    for (const s of mem.slots) if (s.weekday === weekday && slotMatches(s, healthType)) hit = s;
    return hit;
  }
  function readStopped(list, mem) {
    if (list !== void 0 && list !== null && !Array.isArray(list)) throw new InputError("bad_stopped");
    const out = [];
    const add = (x) => {
      if (!out.some((y) => y.activity === x.activity && y.weekday === x.weekday && y.hour === x.hour)) out.push(x);
    };
    for (const x of mem.stoppedSlots) add({ key: x.key, activity: x.activity, weekday: x.weekday, hour: x.hour, label: x.label });
    for (const x of list ?? []) {
      if (!x || typeof x !== "object" || !ACTIVITIES.includes(x.activity) || !Number.isInteger(x.weekday) || x.weekday < 0 || x.weekday > 6) continue;
      if (!Number.isInteger(x.hour) || x.hour < 0 || x.hour > 23) continue;
      add({ key: typeof x.key === "string" && x.key ? x.key : null, activity: baseActivity(x.activity), weekday: x.weekday, hour: x.hour, label: x.activity === "other" && typeof x.label === "string" && x.label.trim() ? x.label.trim() : null });
    }
    return out;
  }
  var isStopped = (stopped, activity, weekday, hour) => stopped.some((x) => x.activity === baseActivity(activity) && x.weekday === weekday && x.hour === hour);

  // src/history.mjs
  var KEEP = ["id", "activityType", "start", "end", "avgHeartRate", "effort", "distanceKm", "indoor"];
  function readHistory(history, now) {
    if (!history || typeof history !== "object") throw new InputError("missing_history");
    return [historyWorkouts(history, now), historyDaily(history, now)];
  }
  function historyWorkouts(doc, now) {
    const out = [];
    for (const raw of doc.workouts ?? []) {
      const w = {};
      for (const k of KEEP) w[k] = raw[k] ?? null;
      const start = parseDT(raw.start);
      const end = parseDT(raw.end);
      if (end.mic <= now.mic) {
        const minutes = Number.isFinite(raw.durationMin) && raw.durationMin > 0 ? raw.durationMin : (end.mic - start.mic) / 1e6 / 60;
        out.push({ ...w, start, end, durationMin: minutes });
      }
    }
    return out.map((w, i) => [w, i]).sort((a, b) => a[0].start.mic - b[0].start.mic || a[1] - b[1]).map(([w]) => w);
  }
  function historyDaily(doc, now) {
    const out = [];
    (doc.daily ?? []).forEach((d, i) => {
      const day = parseDay(d.date);
      if (day < dayOf(now)) out.push([{ sleepMin: d.sleepMin ?? null, restingHeartRate: d.restingHeartRate ?? null, date: day }, i]);
    });
    return out.sort((a, b) => a[0].date - b[0].date || a[1] - b[1]).map(([d]) => d);
  }

  // src/condition.mjs
  var KM_PER_MILE = 1.609344;
  var DEFAULT_LIFE_KM = 650;
  var WORN_AT = 0.6;
  var REPLACE_AT = 0.85;
  var runs = (workouts) => workouts.filter((w) => w.activityType === "Running" && (w.durationMin ?? 0) >= 10);
  function condition(workouts, shoes, now, lifeKm = DEFAULT_LIFE_KM) {
    const counted = runs(workouts).filter((w) => dayOf(w.start) >= shoes.boughtOn && w.end.mic <= now.mic);
    const dist = counted.map((w) => w.distanceKm || 0);
    const runKm = pySum(dist);
    const km = shoes.startMiles * KM_PER_MILE + runKm;
    const share = km / lifeKm;
    const kmText = dist.some((d) => d) ? pyFloat(pyRound(runKm, 1)) : "0";
    return {
      km: pyRound(km, 1),
      miles: pyRound(km / KM_PER_MILE),
      lifeKm,
      percentLife: pyRound(share * 100),
      status: share >= REPLACE_AT ? "replace" : share >= WORN_AT ? "worn" : "fresh",
      runsCounted: counted.length,
      why: `${pyRound(shoes.startMiles)} mi on the pair before tracking plus ${kmText} km from ${counted.length} logged runs since ${dayISO(shoes.boughtOn)}: ${pyRound(share * 100)}% of a ${lifeKm} km life.`
    };
  }

  // src/rules.mjs
  var REST_WEEKDAYS = [2, 5, 6];
  var SESSION_MIN = 20;
  var SESSION_MAX = 25;
  var WINDOW_FROM = "12:00";
  var WINDOW_TO = "20:30";
  var MORNING_FROM = "06:00";
  var SLOT_MIN = 30;
  var ALWAYS_THERE = ["floor", "wall"];
  var EQUIPMENT = ["backpack", "chair", "table", "sofa", "book", "step", "floor", "wall"];
  var DEFAULT_EQUIPMENT = ["backpack", "chair", "table", "sofa", "book", "step"];
  var DAY_KINDS = ["home", "out", "rest"];
  var MOVEMENT_STATES = ["untried", "can", "cannot"];
  var MIN_LENGTH = 10;
  var MAX_LENGTH = 90;
  var ID = /^[a-z0-9_]{1,48}$/;
  var bad = () => new InputError("bad_rules");
  var whole = (v, fallback) => v === void 0 || v === null ? fallback : v;
  function minutesOf(text) {
    const m = typeof text === "string" ? /^(\d\d):(\d\d)$/.exec(text) : null;
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return +m[1] * 60 + +m[2];
  }
  var clockText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  function readWeekdays(list) {
    const days = whole(list, REST_WEEKDAYS);
    if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw bad();
    return [...new Set(days)].sort((a, b) => a - b);
  }
  function readLength(length) {
    const min = whole(length?.min, SESSION_MIN);
    const max = whole(length?.max, SESSION_MAX);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < MIN_LENGTH || max < min || max > MAX_LENGTH) throw bad();
    return { min, max };
  }
  function readWindow(window, mornings) {
    const from = minutesOf(whole(window?.from, WINDOW_FROM));
    const to = minutesOf(whole(window?.to, WINDOW_TO));
    if (from === null || to === null || to < from) throw bad();
    return { from: mornings ? Math.min(from, minutesOf(MORNING_FROM)) : from, to };
  }
  function readIds(list) {
    const ids = whole(list, []);
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string" && ID.test(x))) throw bad();
    return [...new Set(ids)];
  }
  function readStates(map) {
    const states = whole(map, {});
    if (typeof states !== "object" || Array.isArray(states)) throw bad();
    for (const [id, state] of Object.entries(states)) if (!ID.test(id) || !MOVEMENT_STATES.includes(state)) throw bad();
    return { ...states };
  }
  function readRules(raw) {
    if (raw === void 0 || raw === null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) throw bad();
    const mornings = raw.mornings === true;
    const owned = readIds(whole(raw.equipment, DEFAULT_EQUIPMENT));
    if (!owned.every((x) => EQUIPMENT.includes(x))) throw bad();
    return {
      restWeekdays: readWeekdays(raw.restWeekdays),
      session: readLength(raw.sessionMinutes),
      window: readWindow(raw.window, mornings),
      mornings,
      equipment: [.../* @__PURE__ */ new Set([...owned, ...ALWAYS_THERE])].sort(),
      avoid: readIds(raw.avoid),
      movements: readStates(raw.movements)
    };
  }
  function rulesView(rules) {
    return {
      restWeekdays: rules.restWeekdays,
      sessionMinutes: rules.session,
      window: { from: clockText(rules.window.from), to: clockText(rules.window.to) },
      mornings: rules.mornings,
      equipment: rules.equipment,
      avoid: rules.avoid
    };
  }
  function readDayKinds(raw) {
    const out = /* @__PURE__ */ new Map();
    if (raw === void 0 || raw === null) return out;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new InputError("bad_day_kinds");
    for (const [iso, kind] of Object.entries(raw)) {
      if (!DAY_KINDS.includes(kind)) throw new InputError("bad_day_kinds");
      let day;
      try {
        day = parseDay(iso);
      } catch {
        throw new InputError("bad_day_kinds");
      }
      out.set(day, kind);
    }
    return out;
  }
  function kindOf(rules, given, day) {
    if (rules.restWeekdays.includes(weekdayOf(day))) return "rest";
    return given.get(day) ?? "home";
  }
  var dayKindsView = (rules, given, firstDay, days) => Array.from({ length: days }, (_, i) => ({ day: dayISO(firstDay + i), kind: kindOf(rules, given, firstDay + i) }));

  // src/homeweek.mjs
  var LEAD_MIN = 60;
  var TODAY_END_HOUR = 22;
  var FALLBACK_GAP_MIN = 90;
  var MAX_FALLBACKS = 2;
  var ROUND_MIN = 5;
  var SPLIT_DAYS = 4;
  var FOCUS = ["full", "lower", "upper", "full_lower", "full_upper"];
  var FOCUS_WORDS = { full: "full-body", lower: "lower-body", upper: "upper-body", full_lower: "full-body, more legs", full_upper: "full-body, more upper body" };
  function homeContext({ now, calendar, rules, dayKinds, carry = [] }) {
    return { now, today: dayOf(now), off: now.off, calendar: [...calendar].sort((x, y) => x.start.mic - y.start.mic), rules, given: dayKinds, carry };
  }
  function stretchesOn(h, day) {
    if (kindOf(h.rules, h.given, day) !== "home") return [];
    const isToday = day === h.today;
    let from = atDay(day, h.off, 0, h.rules.window.from).mic;
    if (isToday) from = Math.max(from, h.now.mic + LEAD_MIN * US_MIN);
    let to = atDay(day, h.off, 0, h.rules.window.to + h.rules.session.max).mic;
    if (isToday) to = Math.min(to, atDay(day, h.off, TODAY_END_HOUR).mic);
    const out = [];
    const push = (a, b) => {
      if (b - a >= SLOT_MIN * US_MIN) out.push({ a, b });
    };
    for (const busy of h.calendar) {
      if (busy.end.mic <= from || busy.start.mic >= to) continue;
      push(from, Math.min(busy.start.mic, to));
      from = Math.max(from, busy.end.mic);
    }
    if (from < to) push(from, to);
    return out;
  }
  var roundUp = (mic) => Math.ceil(mic / (ROUND_MIN * US_MIN)) * ROUND_MIN * US_MIN;
  function nextStart(h, day, stretches, after) {
    const length = h.rules.session.max * US_MIN;
    const latest = atDay(day, h.off, 0, h.rules.window.to).mic;
    let best = null;
    for (const s of stretches) {
      const t = roundUp(Math.max(after, s.a));
      if (t <= latest && t + length <= s.b && (best === null || t < best)) best = t;
    }
    return best;
  }
  function startsOn(h, day) {
    const stretches = stretchesOn(h, day);
    const first = nextStart(h, day, stretches, -Infinity);
    if (first === null) return { first: null, fallbacks: [] };
    const fallbacks = [];
    let previous = first;
    while (fallbacks.length < MAX_FALLBACKS) {
      const t = nextStart(h, day, stretches, previous + FALLBACK_GAP_MIN * US_MIN);
      if (t === null) break;
      fallbacks.push(t);
      previous = t;
    }
    return { first, fallbacks };
  }
  function splitOf(days) {
    if (days.length >= SPLIT_DAYS) return days.map((_, i) => i % 2 === 0 ? "lower" : "upper");
    const focus = days.map(() => "full");
    if (days.length !== 3) return focus;
    for (let i = 0; i + 1 < days.length; i += 1) {
      if (days[i + 1] === days[i] + 1 && focus[i] === "full" && focus[i + 1] === "full") {
        focus[i] = "full_lower";
        focus[i + 1] = "full_upper";
        i += 1;
      }
    }
    return focus;
  }
  function withCarry(days, focus, carry) {
    const missed = carry.filter((f) => FOCUS.includes(f));
    if (!missed.length) return focus;
    if (["lower", "upper"].includes(missed[0]) && days.length >= 2) {
      const other = missed[0] === "lower" ? "upper" : "lower";
      return days.map((_, i) => i % 2 === 0 ? missed[0] : other);
    }
    return [...missed, ...focus].slice(0, days.length);
  }
  function homeWeek(h, days = 7) {
    const rows = [];
    for (let i = 0; i < days; i += 1) {
      const day = h.today + i;
      const kind = kindOf(h.rules, h.given, day);
      rows.push({ day, kind, focus: null, ...kind === "home" ? startsOn(h, day) : { first: null, fallbacks: [] } });
    }
    const training = rows.filter((r) => r.first !== null);
    const focus = withCarry(training.map((r) => r.day), splitOf(training.map((r) => r.day)), h.carry);
    training.forEach((r, i) => {
      r.focus = focus[i];
    });
    const homeDays = rows.filter((r) => r.kind === "home").length;
    let note = null;
    if (training.length === 0) note = "There is no day at home with time to train this week, so nothing is planned.";
    else if (training.length === 1) note = "This week has only one day at home with time to train, so it works the whole body once.";
    return { days: rows, homeDays, trainingDays: training.length, note };
  }
  function homeWeekView(h, week) {
    const at = (mic) => isoDT({ mic, off: h.off });
    return {
      days: week.days.map((r) => ({
        day: dayISO(r.day),
        weekday: WEEKDAY_NAMES[weekdayOf(r.day)],
        kind: r.kind,
        focus: r.focus,
        first: r.first === null ? null : at(r.first),
        fallbacks: r.fallbacks.map(at)
      })),
      homeDays: week.homeDays,
      trainingDays: week.trainingDays,
      note: week.note
    };
  }

  // src/workouts.mjs
  var DAYS = 7;
  var TODAY_LEAD_MIN = 60;
  var TODAY_END_HOUR2 = 22;
  var LOAD_GROWTH = 1.1;
  var ACWR_MAX = 1.3;
  var SLEEP_DROP_MIN = 30;
  var RHR_RISE = 3;
  var TAPER_DAYS = 10;
  var WORN_RUN_MAX_MIN = 45;
  var BREAK_IN_MIN = 30;
  var MIN_SESSION = 20;
  var LONG_RUN_MIN = 60;
  var HARD_EFFORT = 6;
  var EASY_EFFORT = 4;
  var NOUN = {
    Running: "run",
    Cycling: "bike ride",
    Elliptical: "elliptical session",
    Walking: "walk",
    Yoga: "yoga",
    FunctionalStrengthTraining: "strength session",
    TraditionalStrengthTraining: "strength session"
  };
  var COUNT = [null, "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
  var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  var nounOf = (activity) => NOUN[activity] ?? String(activity).toLowerCase();
  var wordOf = (s) => NOUN[s.usualActivity ?? s.activityType] ?? s.label ?? labelOf(s.usualActivity ?? s.activityType);
  function effort(w) {
    if (w.effort) return Number(w.effort);
    const hr = w.avgHeartRate;
    return hr ? Math.max(1, Math.min(10, 1 + (hr - 90) / 10)) : 5;
  }
  var intensityOf = (e) => e >= HARD_EFFORT ? "hard" : e <= EASY_EFFORT ? "easy" : "steady";
  function signals(ws, days, now) {
    const load = (rows) => pySum(rows.map((w) => effort(w) * w.durationMin));
    const load7 = load(ws.filter((w) => w.start.mic >= now.mic - 7 * US_DAY));
    const avg28 = load(ws.filter((w) => w.start.mic >= now.mic - 28 * US_DAY)) / 4;
    const cap = Math.min(LOAD_GROWTH * Math.max(load7, avg28), ACWR_MAX * avg28);
    const avg = (rows, key) => {
      const vals = rows.filter((r) => r[key]).map((r) => r[key]);
      return vals.length ? pyRound(pyMean(vals), 1) : null;
    };
    const today = dayOf(now);
    const d7 = days.filter((d) => d.date >= today - 7);
    const d28 = days.filter((d) => d.date >= today - 28);
    const sig = {
      load7: pyRound(load7),
      loadWeeklyAvg28: pyRound(avg28),
      loadRatio: avg28 ? pyRound(load7 / avg28, 2) : null,
      loadCap: pyRound(cap),
      sleep7Min: avg(d7, "sleepMin"),
      sleep28Min: avg(d28, "sleepMin"),
      rhr7: avg(d7, "restingHeartRate"),
      rhr28: avg(d28, "restingHeartRate")
    };
    const tired = [];
    if (sig.sleep7Min && sig.sleep28Min && sig.sleep7Min < sig.sleep28Min - SLEEP_DROP_MIN) {
      tired.push(`sleep down ${pyRound(sig.sleep28Min - sig.sleep7Min)} min/night`);
    }
    if (sig.rhr7 && sig.rhr28 && sig.rhr7 > sig.rhr28 + RHR_RISE) tired.push(`resting HR up ${pyFloat(pyRound(sig.rhr7 - sig.rhr28, 1))} bpm`);
    sig.readiness = tired.length ? `ease off: ${tired.join(", ")}` : "normal";
    return sig;
  }
  var tiredSignals = (sig) => [
    ...sig.readiness.includes("sleep down") ? ["sleep"] : [],
    ...sig.readiness.includes("resting HR up") ? ["resting_hr"] : []
  ];
  function usualWeek(ws, now) {
    const byDay = /* @__PURE__ */ new Map();
    for (const w of ws) {
      if (w.start.mic < now.mic - 28 * US_DAY) continue;
      const wd = weekdayOf(dayOf(w.start));
      if (!byDay.has(wd)) byDay.set(wd, []);
      byDay.get(wd).push(w);
    }
    const week = /* @__PURE__ */ new Map();
    for (const [wd, rows] of byDay) {
      if (new Set(rows.map((r) => dayOf(r.start))).size < 2) continue;
      const counts = /* @__PURE__ */ new Map();
      for (const r of rows) counts.set(r.activityType, (counts.get(r.activityType) ?? 0) + 1);
      let act = null;
      for (const [a, n] of counts) if (act === null || n > counts.get(act)) act = a;
      const same = rows.filter((r) => r.activityType === act);
      week.set(wd, {
        activityType: act,
        minutes: pyRound(pyMedian(same.map((r) => r.durationMin))),
        hour: pyRound(pyMedian(same.map((r) => hourOf(r.start)))),
        effort: pyMean(same.map(effort)),
        label: same[same.length - 1].label ?? ""
      });
    }
    return week;
  }
  var NEW_HISTORY_DAYS = 14;
  var NEW_MAX_SESSIONS = 3;
  var finite = (v) => Number.isFinite(v) ? v : null;
  function sessionLimit(ws, week, now, mem) {
    const perWeek = finite(mem?.first("weekly_volume")?.data?.workoutsPerWeek);
    if (perWeek !== null && perWeek >= 0) return Math.min(DAYS, Math.ceil(perWeek) + 1);
    if (mem?.slots.length) return Math.min(DAYS, Math.max(new Set(mem.slots.map((x) => x.weekday)).size, week.size) + 1);
    const first = ws.reduce((min, w) => Math.min(min, w.start.mic), Infinity);
    return ws.length && (now.mic - first) / US_DAY >= NEW_HISTORY_DAYS ? Math.min(DAYS, week.size + 1) : NEW_MAX_SESSIONS;
  }
  var HIGH_LOAD_RATIO = 1.1;
  function minutesBudget(ws, now, mem, week = /* @__PURE__ */ new Map()) {
    const load = mem?.first("load")?.data;
    const last7 = finite(load?.minutes7d);
    let usual = finite(mem?.first("weekly_volume")?.data?.minutesPerWeek);
    if (!(usual > 0)) usual = last7 !== null && load?.ratioToUsual > 0 ? last7 / load.ratioToUsual : null;
    let ratio = usual !== null ? finite(load?.ratioToUsual) ?? (last7 !== null ? last7 / usual : null) : null;
    if (usual === null && ws.length) {
      const minutes = (days) => pySum(ws.filter((w) => w.start.mic >= now.mic - days * US_DAY).map((w) => w.durationMin));
      usual = minutes(28) / 4;
      ratio = usual > 0 ? minutes(7) / usual : null;
    }
    if (usual === null) return { usual: null, ratio: null, limit: null };
    const high = ratio !== null && ratio > HIGH_LOAD_RATIO;
    const sum = (rows) => rows.reduce((total, x) => total + (x.minutes ?? 0), 0);
    const usualWeekMinutes = Math.max(sum(mem?.slots ?? []), sum([...week.values()]));
    const limit = high ? pyRound(usual) : Math.max(pyRound(usual * LOAD_GROWTH), usualWeekMinutes);
    return { usual: pyRound(usual), ratio: ratio === null ? null : pyRound(ratio, 2), limit: Math.max(MIN_SESSION, limit) };
  }
  function longDay(week) {
    let best = null;
    for (const [wd, s] of week) if (s.activityType === "Running" && (best === null || s.minutes > week.get(best).minutes)) best = wd;
    return best;
  }
  function parseRequest(a) {
    if (!a || typeof a !== "object") throw new InputError("bad_request");
    const now = parseDT(a.now);
    const day = (v) => v === void 0 || v === null ? null : parseDay(String(v).slice(0, 10));
    const shoes = a.shoes ? { boughtOn: day(a.shoes.boughtOn), startMiles: Number(a.shoes.startMiles ?? 0) } : null;
    if (shoes && (shoes.boughtOn === null || !Number.isFinite(shoes.startMiles))) throw new InputError("bad_shoes");
    const busy = (a.busy ?? a.calendar ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === "string" ? b.title : null }));
    const carry = Array.isArray(a.carry) ? a.carry.filter((f) => FOCUS.includes(f)) : [];
    return {
      now,
      shoes,
      newPairArrives: day(a.newPairArrives),
      raceDate: day(a.raceDate),
      busy,
      memory: a.memory ?? null,
      history: a.history ?? null,
      stopped: a.stopped ?? null,
      rules: readRules(a.rules),
      dayKinds: readDayKinds(a.dayKinds),
      carry
    };
  }
  var HOME_EFFORT = 5;
  function homeBuild(req, base) {
    const h = homeContext({ now: req.now, calendar: req.busy, rules: req.rules, dayKinds: req.dayKinds, carry: req.carry });
    const week = homeWeek(h);
    const minutes = req.rules.session.max;
    const sessions = week.days.filter((d) => d.focus !== null).map((d) => {
      const start = { mic: d.first, off: req.now.off };
      return {
        date: d.day,
        activityType: "TraditionalStrengthTraining",
        usualActivity: "TraditionalStrengthTraining",
        minutes,
        effort: HOME_EFFORT,
        hour: hourOf(start),
        start,
        end: addUs(start, minutes * US_MIN),
        tags: [{ code: "home_day", focus: d.focus }],
        fallbacks: d.fallbacks.map((mic) => ({ mic, off: req.now.off }))
      };
    });
    base.sig.plannedLoad = pyRound(pySum(sessions.map((s) => s.effort * s.minutes)));
    return { ...base, sessions, signals: base.sig, home: homeWeekView(h, week) };
  }
  function build(req, firstDay = 0) {
    const { now } = req;
    const [ws, days] = readHistory(req.history, now);
    const historySource = "phone";
    const sig = signals(ws, days, now);
    const mem = readMemory(req.memory);
    const stopped = readStopped(req.stopped, mem);
    const week = usualWeek(ws, now);
    const cond = req.shoes ? condition(ws, req.shoes, now) : null;
    const worn = Boolean(cond && cond.status === "replace");
    const long = longDay(week);
    const hasBike = ws.some((w) => w.activityType === "Cycling");
    const tired = tiredSignals(sig);
    if (req.rules) return homeBuild(req, { sig, condition: cond, memory: mem, memorySource: mem.given ? "phone" : null, historySource, week, long });
    let eased = false;
    let brokenIn = 0;
    const sessions = [];
    for (let i = firstDay; i < firstDay + DAYS; i += 1) {
      const day = dayOf(now) + i;
      const wd = weekdayOf(day);
      if (req.raceDate !== null && day === req.raceDate) {
        sessions.push({ date: day, activityType: "Running", usualActivity: "Running", minutes: 0, hour: 8, tags: [{ code: "race_day" }], race: true });
        continue;
      }
      if (req.raceDate !== null && day === req.raceDate - 1) continue;
      const usual = week.get(wd);
      if (!usual) continue;
      const slot = slotFor(mem, wd, usual.activityType);
      if (i === 0 && atDay(day, now.off, slot ? slot.hour : usual.hour).mic < now.mic + TODAY_LEAD_MIN * US_MIN) continue;
      if (isStopped(stopped, activityOf(usual.activityType), wd, slot ? slot.hour : usual.hour)) continue;
      const s = {
        date: day,
        activityType: usual.activityType,
        usualActivity: usual.activityType,
        minutes: usual.minutes,
        effort: usual.effort,
        hour: slot ? slot.hour : usual.hour,
        tags: [],
        usual: usual.label,
        label: slot ? slot.label : null
      };
      if (slot) {
        s.basedOn = [slot.key];
        s.tags.push({ code: "memory_slot", hour: s.hour });
      }
      if (wd === long) s.tags.push({ code: "long_run" });
      const daysToRace = req.raceDate !== null ? req.raceDate - day : null;
      if (daysToRace !== null && daysToRace > 0 && daysToRace <= TAPER_DAYS && s.activityType === "Running") {
        s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes * (wd === long ? 0.6 : 0.8)));
        s.tags.push({ code: "taper", daysToRace });
      }
      if (sig.readiness !== "normal" && (!eased || firstDay === 0 && i <= 1) && s.effort >= HARD_EFFORT) {
        s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes * 0.8));
        s.effort = Math.min(s.effort, EASY_EFFORT);
        s.tags.push({ code: "ease_off", signals: tired });
        eased = true;
      }
      if (s.activityType === "Running") {
        const arrived = req.newPairArrives !== null && day > req.newPairArrives;
        if (worn && !arrived && s.minutes > WORN_RUN_MAX_MIN) {
          s.activityType = hasBike ? "Cycling" : "Elliptical";
          s.tags.push({ code: "worn_shoes_swap", percentLife: cond.percentLife, to: s.activityType });
        } else if (arrived && brokenIn < 2) {
          s.minutes = Math.min(s.minutes, BREAK_IN_MIN);
          s.effort = Math.min(s.effort, EASY_EFFORT);
          s.tags.push({ code: "break_in" });
          brokenIn += 1;
        }
      }
      sessions.push(s);
    }
    if (firstDay === 0) {
      const limit = sessionLimit(ws, week, now, mem);
      let kept = 0;
      for (let i = 0; i < sessions.length; i += 1) {
        if (sessions[i].race) continue;
        kept += 1;
        if (kept > limit) {
          sessions.splice(i, 1);
          i -= 1;
        }
      }
    }
    const load = (rows) => pySum(rows.filter((s) => !s.race).map((s) => s.effort * s.minutes));
    const planned = load(sessions);
    if (planned > sig.loadCap && sig.loadCap > 0) {
      const flex = sessions.filter((s) => !s.race && !s.tags.some((t) => t.code === "long_run"));
      const excess = planned - sig.loadCap;
      const flexLoad = load(flex) || 1;
      for (const s of flex) {
        const cut = s.minutes * Math.min(0.5, excess / flexLoad);
        if (cut >= 1) {
          s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes - cut));
          s.tags.push({ code: "load_trim" });
        }
      }
    }
    if (sig.loadCap > 0) {
      for (; ; ) {
        if (load(sessions) <= sig.loadCap) break;
        const open = sessions.filter((s) => !s.race && s.minutes > MIN_SESSION);
        const flex = open.filter((s) => !s.tags.some((t) => t.code === "long_run"));
        const pool = flex.length ? flex : open;
        if (!pool.length) break;
        let longest = pool[0];
        for (const s of pool) if (s.minutes > longest.minutes) longest = s;
        longest.minutes -= 1;
        if (!longest.tags.some((t) => t.code === "load_trim")) longest.tags.push({ code: "load_trim" });
      }
    }
    if (firstDay === 0) {
      const { limit } = minutesBudget(ws, now, mem, week);
      const total = () => sessions.reduce((sum, s) => sum + (s.race ? 0 : s.minutes), 0);
      while (limit !== null && total() > limit) {
        const open = sessions.filter((s) => !s.race && s.minutes > MIN_SESSION);
        const flex = open.filter((s) => !s.tags.some((t) => t.code === "long_run"));
        const pool = flex.length ? flex : open;
        if (pool.length) {
          let longest = pool[0];
          for (const s of pool) if (s.minutes > longest.minutes) longest = s;
          longest.minutes -= 1;
          if (!longest.tags.some((t) => t.code === "load_trim")) longest.tags.push({ code: "load_trim" });
        } else {
          const booked = sessions.filter((s) => !s.race);
          if (booked.length <= 1) break;
          const last = sessions.lastIndexOf(booked[booked.length - 1]);
          sessions.splice(last, 1);
        }
      }
    }
    sig.plannedLoad = pyRound(load(sessions));
    for (const s of sessions) {
      const length = Math.max(s.minutes, 1) * US_MIN;
      let start = atDay(s.date, now.off, s.hour);
      let end = addUs(start, length);
      for (const b of req.busy) {
        if (b.start.mic < end.mic && start.mic < b.end.mic) {
          start = { mic: b.end.mic, off: now.off };
          end = addUs(start, length);
          s.tags.push({ code: "calendar_moved", to: clock(hourOf(start), minuteOf(start)) });
        }
      }
      if (hourOf(end) >= 21 && !s.race) s.tags.push({ code: "no_free_slot" });
      s.start = start;
      s.end = end;
    }
    const before = sessions.length;
    for (let i = sessions.length - 1; i >= 0; i -= 1) {
      const s = sessions[i];
      if (!s.race && isStopped(stopped, activityOf(s.activityType), weekdayOf(s.date), hourOf(s.start))) sessions.splice(i, 1);
    }
    if (sessions.length !== before) sig.plannedLoad = pyRound(load(sessions));
    const tooLate = sessions.findIndex((s) => !s.race && s.date === dayOf(now) && s.end.mic > atDay(s.date, now.off, TODAY_END_HOUR2).mic);
    if (tooLate >= 0) {
      sessions.splice(tooLate, 1);
      sig.plannedLoad = pyRound(load(sessions));
    }
    return { sessions, signals: sig, condition: cond, memory: mem, memorySource: mem.given ? "phone" : null, historySource, week, long };
  }
  var TIRED_WORDS = { sleep: "you have been sleeping less than usual", resting_hr: "your resting heart rate is higher than usual" };
  var tiredWords = (list) => list.map((k) => TIRED_WORDS[k]).filter(Boolean).join(" and ") || "your body needs a lighter day";
  function wording(tag, s) {
    const weekday = WEEKDAY_NAMES[weekdayOf(s.date)];
    const noun = wordOf(s);
    const machine = tag.to === "Cycling" ? "bike" : "elliptical";
    switch (tag.code) {
      case "usual":
        return { whole: `Your usual ${weekday} ${noun}.` };
      case "memory_slot":
        return { whole: `Your usual ${weekday} ${clock(tag.hour)} ${noun}.` };
      case "long_run":
        return { part: "the longest of your week", whole: "It is your longest run of the week." };
      case "taper":
        return { part: `kept shorter because your race is ${plural(tag.daysToRace, "day")} away` };
      case "ease_off":
        return { part: `kept short and easy because ${tiredWords(tag.signals ?? [])}` };
      case "worn_shoes_swap":
        return { part: `moved to the ${machine} because your running shoes are nearly worn out`, whole: `Your running shoes are nearly worn out, so this one moves to the ${machine}.` };
      case "break_in":
        return { whole: "A short, easy run to break in your new shoes." };
      case "load_trim":
        return { part: "kept short so this week stays close to your normal" };
      case "calendar_moved":
        return { part: `moved to ${tag.to} because your calendar is busy before that` };
      case "no_free_slot":
        return { whole: "It ends late because the rest of that day is full, so skip it if that is too late." };
      case "race_day":
        return { whole: "Race day. Rest and fuel." };
      case "home_day":
        return { whole: `${weekday} is a day at home, so it has a ${FOCUS_WORDS[tag.focus] ?? "full-body"} strength session.` };
      default:
        return { whole: "" };
    }
  }
  function sessionReasons(s) {
    const tags = s.tags.length ? s.tags : [{ code: "usual" }];
    const weekday = WEEKDAY_NAMES[weekdayOf(s.date)];
    const noun = wordOf(s);
    return tags.map((t, i) => {
      const w = wording(t, s);
      const text = i === 0 && w.part ? `Your usual ${weekday} ${noun}, ${w.part}.` : w.whole ?? `${w.part.slice(0, 1).toUpperCase()}${w.part.slice(1)}.`;
      return { code: t.code, text };
    });
  }
  var sentence = (reasons) => [...new Set(reasons.map((r) => r.text))].join(" ");
  var SAFE_KINDS = ["strides", "shakeout", "mobility", "drills", "walk"];
  var DEFAULT_MIN = { strides: 6, shakeout: 15, mobility: 10, drills: 10, walk: 15 };
  var ADDON_EFFORT = 3;
  var MAX_SUGGESTIONS = 2;
  function phases(req, plan, firstDay) {
    const ph = /* @__PURE__ */ new Set(["any"]);
    const first = dayOf(req.now) + firstDay;
    if (req.raceDate !== null && req.raceDate - first > 0 && req.raceDate - first <= TAPER_DAYS) {
      ph.add("taper");
      ph.add("race week");
    }
    if (plan.condition && plan.condition.status === "replace") ph.add("worn shoes");
    if (req.newPairArrives !== null) ph.add("new shoes");
    return ph;
  }
  function why(idea, req) {
    const out = req.raceDate !== null ? req.raceDate - dayOf(req.now) : null;
    const lead = {
      taper: out !== null ? `Your race is ${out} days out` : "You're tapering",
      "race week": out !== null ? `Race week: your race is ${out} days out` : "Race week",
      "new shoes": req.newPairArrives !== null ? `Your new pair arrives ${WEEKDAYS[weekdayOf(req.newPairArrives)]}` : "New shoes",
      "worn shoes": "Your shoes are worn out",
      any: "An easy add-on"
    }[idea.phase];
    const when = idea.when.slice(0, 1).toLowerCase() + idea.when.slice(1).replace(/\.+$/, "");
    return `${lead}; ${idea.source} suggests it ${when}. Optional, and it fits in your week.`;
  }
  function suggestions(req, plan, ids, firstDay = 0) {
    const sig = plan.signals;
    let headroom = sig.loadCap - sig.plannedLoad;
    const ph = phases(req, plan, firstDay);
    const worn = Boolean(plan.condition && plan.condition.status === "replace");
    const runs2 = plan.sessions.map((s, i) => [ids[i], s]).filter(([, s]) => s.activityType === "Running" && !s.race);
    const rank = (x) => (x.phase === "any" ? 2 : 0) + (x.kind === "mobility" ? 1 : 0);
    const ideas = workoutIdeas().map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
    const out = [];
    const used = /* @__PURE__ */ new Set();
    for (const idea of ideas) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const { kind } = idea;
      if (!SAFE_KINDS.includes(kind) || idea.intensity === "hard" || !ph.has(idea.phase) || used.has(kind)) continue;
      const minutes = Math.trunc(idea.minutes || DEFAULT_MIN[kind]);
      if (minutes > 30 || ADDON_EFFORT * minutes > headroom) continue;
      let attach = null;
      if (["strides", "shakeout", "drills"].includes(kind)) {
        let ok = runs2.filter(([, s]) => !(worn && req.newPairArrives !== null && s.date <= req.newPairArrives) && !(worn && req.newPairArrives === null));
        if (kind === "shakeout" && req.raceDate !== null) ok = ok.filter(([, s]) => s.date === req.raceDate - 2);
        if (!ok.length) continue;
        attach = kind === "strides" ? ok[ok.length - 1] : ok[0];
      }
      out.push({
        id: idea.id,
        title: idea.title,
        kind,
        activityType: idea.activityType,
        minutes,
        when: attach ? `after your ${WEEKDAYS[weekdayOf(attach[1].date)]} run` : idea.when,
        attachTo: attach ? attach[0] : null,
        why: why(idea, req),
        source: { title: idea.sourceTitle, name: idea.source },
        quote: idea.quote,
        optional: true
      });
      used.add(kind);
      headroom -= ADDON_EFFORT * minutes;
    }
    return out;
  }
  function citations(s) {
    const codes = s.tags.map((t) => t.code);
    const want = [...codes.includes("taper") ? ["taper"] : [], ...codes.includes("worn_shoes_swap") ? ["worn shoes"] : [], ...codes.includes("break_in") ? ["new shoes"] : []];
    const out = [];
    for (const phase of want) {
      const hit = workoutIdeas().find((i) => i.phase === phase || phase === "worn shoes" && i.kind === "cross-training");
      if (hit) out.push({ source: `${hit.sourceTitle} (${hit.source})`, passage: hit.quote });
    }
    return out;
  }
  function summaryReasons(plan) {
    const sig = plan.signals;
    const out = [];
    if (plan.home) {
      const n = plan.home.trainingDays;
      out.push({ code: "home_week", text: plan.home.note ?? `This week has ${plural(n, "day")} at home with time to train, so ${plural(n, "strength session")}.` });
      return out;
    }
    if (!plan.sessions.length) out.push({ code: "no_history", text: "Nothing is planned yet because there is not enough recent history to see your usual week." });
    else if (sig.loadRatio === null) out.push({ code: "load_unknown", text: "This week follows your usual pattern." });
    else if (sig.loadRatio < 0.9) {
      const trimmed = plan.sessions.some((s) => s.tags.some((t) => t.code === "load_trim"));
      out.push({ code: "load_light", text: trimmed ? "Last week was lighter than usual, so this week builds back up gently." : "A lighter week than usual, so there is room to build." });
    } else if (sig.loadRatio > 1.1) out.push({ code: "load_heavy", text: "A heavier week than usual, so this week stays close to your normal." });
    else out.push({ code: "load_normal", text: "Last week was close to your normal, so this week keeps your usual pattern." });
    const tired = tiredSignals(sig);
    if (tired.length) out.push({ code: "readiness_ease", text: `Take it easier for now, because ${tiredWords(tired)}.` });
    const swaps = plan.sessions.filter((s) => s.tags.some((t) => t.code === "worn_shoes_swap")).length;
    if (swaps) out.push({ code: "worn_shoes", text: `${swaps === 1 ? "One long run moves" : `${COUNT[swaps] ?? "Several"} long runs move`} off the road while your shoes are worn out.` });
    return out;
  }
  var actionId = (s) => `wk-${dayISO(s.date)}-${s.activityType.toLowerCase()}`;
  var p22 = (n) => String(n).padStart(2, "0");
  function toSession(s, reasons) {
    const base = activityOf(s.activityType);
    if (s.race || base === null) return null;
    const activity = base === "run" && s.minutes >= LONG_RUN_MIN && s.tags.some((t) => t.code === "long_run") ? "long_run" : base;
    return {
      id: `ses-${dayISO(s.date)}-${activity}-${p22(hourOf(s.start))}${p22(minuteOf(s.start))}`,
      day: dayISO(s.date),
      start: isoDT({ mic: Math.floor(s.start.mic / 1e6) * 1e6, off: s.start.off }),
      // whole seconds, as the shared session shape asks
      minutes: s.minutes,
      activity,
      intensity: intensityOf(s.effort),
      reason: sentence(reasons),
      basedOn: s.basedOn ?? []
    };
  }
  function recommendWeek(args, firstDay = 0) {
    const req = parseRequest(args);
    const plan = build(req, firstDay);
    const ids = plan.sessions.map(actionId);
    const createdAt = isoDT(req.now);
    const sessions = [];
    const reasonsById = {};
    const notes = [];
    const actions = plan.sessions.map((s, i) => {
      const reasons = sessionReasons(s);
      const session = toSession(s, reasons);
      if (session) {
        sessions.push(session);
        reasonsById[session.id] = reasons;
      }
      if (s.race) notes.push({ day: dayISO(s.date), code: "race_day", text: reasons[0].text });
      return {
        id: ids[i],
        kind: s.race ? "note" : "addWorkout",
        sessionId: session ? session.id : null,
        title: s.race ? "Race day" : `Planned a ${s.minutes}-minute ${nounOf(s.activityType)}`,
        planItemId: ids[i],
        after: s.race ? null : { start: isoDT(s.start), end: isoDT(s.end), activityType: s.activityType },
        reason: sentence(reasons),
        reasons,
        points: s.race ? null : 10,
        createdAt,
        rules: s.tags.map((t) => t.code),
        basedOn: s.basedOn ?? [],
        intensity: s.race ? null : intensityOf(s.effort),
        evidence: citations(s)
      };
    });
    const summary = summaryReasons(plan);
    return {
      sessions,
      reasons: reasonsById,
      notes,
      summary: sentence(summary),
      summaryReasons: summary,
      signals: plan.signals,
      actions,
      suggestions: suggestions(req, plan, ids, firstDay),
      memoryUsed: [...new Set(sessions.flatMap((x) => x.basedOn))],
      memorySource: plan.memorySource,
      historySource: plan.historySource,
      live: false,
      source: "rules",
      condition: plan.condition,
      ...plan.home ? { homeWeek: plan.home } : {}
    };
  }

  // src/plan.mjs
  var MIN_MINUTES = 10;
  var MAX_MINUTES = 180;
  var LOAD_SLACK = 1.1;
  var DAY_START_HOUR = 6;
  var DAY_END_HOUR = 21;
  var TAPER_RUN_MAX_MIN = 45;
  var EFFORT_OF = { easy: 3, steady: 5, hard: 7 };
  var NOUN2 = { run: "run", long_run: "long run", walk: "walk", strength: "strength session", yoga: "yoga", ride: "ride", elliptical: "elliptical session", swim: "swim", stretch: "stretch", rest: "rest", other: "session" };
  var TIRED_WORDS2 = { sleep: "you have been sleeping less than usual", resting_hr: "your resting heart rate is higher than usual" };
  var RACE_GOAL = /race|marathon|\b\d+ ?k\b|triathlon/i;
  var finite2 = (v) => Number.isFinite(v) ? v : null;
  function longestStreak(weekdays) {
    const on = new Set(weekdays);
    if (on.size >= 7) return 7;
    let best = 0;
    for (let start = 0; start < 7; start += 1) {
      let n = 0;
      while (n < 7 && on.has((start + n) % 7)) n += 1;
      best = Math.max(best, n);
    }
    return best;
  }
  function situation(ctx) {
    if (!ctx || typeof ctx !== "object") throw new InputError("bad_context");
    let now = parseDT(ctx.now);
    const tz = typeof ctx.tz === "string" && /^[+-]\d\d:?\d\d$/.test(ctx.tz) ? parseDT(`2000-01-01T00:00:00${ctx.tz}`).off : null;
    if (tz !== null) now = { mic: now.mic, off: tz };
    const today = dayOf(now);
    const day = (v) => v === void 0 || v === null ? null : parseDay(String(v).slice(0, 10));
    const mem = readMemory(ctx.memory);
    const calendar = (ctx.calendar ?? ctx.busy ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === "string" ? b.title : null }));
    const stopped = readStopped(ctx.stopped, mem);
    const stoppedKeys = [.../* @__PURE__ */ new Set([...mem.stoppedKeys, ...stopped.map((x) => x.key).filter(Boolean), ...Array.isArray(ctx.stoppedKeys) ? ctx.stoppedKeys.filter((k) => typeof k === "string") : []])];
    const s = { now, today, mem, calendar, stopped, stoppedKeys, memoryKeys: mem.keys.filter((k) => !stoppedKeys.includes(k)), ws: null, week: /* @__PURE__ */ new Map(), long: null };
    const slots = mem.slots.filter((x) => !stoppedKeys.includes(x.key));
    if (ctx.history) {
      const [ws, days] = readHistory(ctx.history, now);
      const sig = signals(ws, days, now);
      const week = usualWeek(ws, now);
      s.ws = ws;
      s.long = longDay(week);
      for (const [wd, u] of week) {
        const act = activityOf(u.activityType);
        const slot = [...slots].reverse().find((x) => x.weekday === wd && slotMatches(x, u.activityType));
        s.week.set(wd, { activity: act, minutes: u.minutes, hour: slot ? slot.hour : u.hour, effort: u.effort, key: slot ? slot.key : null, label: act === "other" ? slot && slot.label || labelOf(u.activityType) : null });
      }
      Object.assign(s, { unit: "effort-minutes", load7: sig.load7, loadUsual: sig.loadWeeklyAvg28, loadCap: sig.loadCap > 0 ? sig.loadCap : null, tired: tiredSignals(sig) });
      s.usualDays = s.week.size;
      s.streak = s.week.size ? Math.max(3, longestStreak([...s.week.keys()])) : 6;
      s.maxSessions = sessionLimit(ws, week, now, mem);
      s.minutes = minutesBudget(ws, now, mem, week);
    } else {
      for (const x of slots) s.week.set(x.weekday, { activity: x.activity, minutes: x.minutes, hour: x.hour, effort: null, key: x.key, label: x.label });
      const runs2 = [...s.week].filter(([, u]) => u.activity === "run" && u.minutes !== null);
      for (const [wd, u] of runs2) if (s.long === null || u.minutes > s.week.get(s.long).minutes) s.long = wd;
      const load = mem.first("load")?.data;
      const volume = mem.first("weekly_volume")?.data;
      const sleep = mem.first("sleep")?.data;
      const rhr = mem.first("resting_hr")?.data;
      const load7 = finite2(load?.minutes7d);
      const usual = load7 !== null && load?.ratioToUsual > 0 ? load7 / load.ratioToUsual : finite2(volume?.minutesPerWeek);
      s.tired = [];
      if (finite2(sleep?.hours7d) !== null && finite2(sleep?.hours28d) !== null && sleep.hours7d * 60 < sleep.hours28d * 60 - SLEEP_DROP_MIN) s.tired.push("sleep");
      if (finite2(rhr?.bpm7d) !== null && finite2(rhr?.bpm28d) !== null && rhr.bpm7d > rhr.bpm28d + RHR_RISE) s.tired.push("resting_hr");
      const cap = usual !== null && usual > 0 ? pyRound(Math.min(LOAD_GROWTH * Math.max(load7 ?? 0, usual), ACWR_MAX * usual)) : null;
      Object.assign(s, { unit: "minutes", load7: load7 === null ? null : pyRound(load7), loadUsual: usual === null ? null : pyRound(usual), loadCap: cap });
      const perWeek = finite2(volume?.workoutsPerWeek);
      s.usualDays = perWeek !== null ? Math.ceil(perWeek) : s.week.size || null;
      s.streak = perWeek !== null && perWeek > 6 ? 7 : 6;
      s.maxSessions = sessionLimit([], s.week, now, mem);
      s.minutes = minutesBudget([], now, mem, s.week);
    }
    s.shoe = null;
    const gear = mem.rows.find((r) => r.kind === "gear" && r.data && /shoe/i.test(String(r.data.item ?? "")) && Number.isFinite(r.data.km));
    let shoe = null;
    if (ctx.shoes && typeof ctx.shoes === "object" && s.ws && ctx.shoes.boughtOn) {
      const c = condition(s.ws, { boughtOn: day(ctx.shoes.boughtOn), startMiles: Number(ctx.shoes.startMiles ?? 0) }, now);
      shoe = { status: c.status, percentLife: c.percentLife, miles: c.miles };
    } else {
      const miles = ctx.shoes && Number.isFinite(Number(ctx.shoes.miles ?? ctx.shoes.startMiles)) ? Number(ctx.shoes.miles ?? ctx.shoes.startMiles) : gear ? gear.data.km / KM_PER_MILE : null;
      if (miles !== null) {
        const share = miles * KM_PER_MILE / DEFAULT_LIFE_KM;
        shoe = { status: share >= REPLACE_AT ? "replace" : share >= WORN_AT ? "worn" : "fresh", percentLife: pyRound(share * 100), miles: pyRound(miles) };
      }
    }
    if (shoe) s.shoe = { ...shoe, longestRunMin: shoe.status === "replace" ? WORN_RUN_MAX_MIN : null };
    s.newPairArrives = day(ctx.newPairArrives ?? ctx.shoes?.newPairArrives);
    const goal = mem.rows.find((r) => r.kind === "goal" && r.data && RACE_GOAL.test(String(r.data.what ?? "")) && /^\d{4}-\d\d-\d\d/.test(String(r.data.date ?? "")));
    s.raceDate = day(ctx.raceDate ?? (goal ? goal.data.date : null));
    applyRules(s, ctx);
    return s;
  }
  function applyRules(s, ctx) {
    s.rules = readRules(ctx.rules);
    if (!s.rules) return;
    s.dayKinds = readDayKinds(ctx.dayKinds);
    s.home = homeContext({ now: s.now, calendar: s.calendar, rules: s.rules, dayKinds: s.dayKinds, carry: Array.isArray(ctx.carry) ? ctx.carry : [] });
    s.homeWeek = homeWeek(s.home);
    const n = s.homeWeek.trainingDays;
    const minutes = n * s.rules.session.max;
    s.maxSessions = Math.max(s.maxSessions, n);
    if (s.minutes.limit !== null) s.minutes = { ...s.minutes, limit: Math.max(s.minutes.limit, minutes) };
    if (s.loadCap !== null) s.loadCap = Math.max(s.loadCap, s.unit === "minutes" ? minutes : minutes * EFFORT_OF.steady);
    s.streak = DAYS;
  }
  function freeOn(s, dayNum) {
    if (s.rules) return stretchesOn(s.home, dayNum).map((x) => ({ day: dayISO(dayNum), start: isoDT({ mic: x.a, off: s.now.off }), end: isoDT({ mic: x.b, off: s.now.off }) }));
    const today = dayNum === s.today;
    let from = Math.max(atDay(dayNum, s.now.off, DAY_START_HOUR).mic, today ? s.now.mic + TODAY_LEAD_MIN * US_MIN : 0);
    const to = atDay(dayNum, s.now.off, today ? TODAY_END_HOUR2 : DAY_END_HOUR).mic;
    const out = [];
    const push = (a, b) => {
      if (b - a >= MIN_SESSION * US_MIN) out.push({ day: dayISO(dayNum), start: isoDT({ mic: a, off: s.now.off }), end: isoDT({ mic: b, off: s.now.off }) });
    };
    for (const b of [...s.calendar].sort((x, y) => x.start.mic - y.start.mic)) {
      if (b.end.mic <= from || b.start.mic >= to) continue;
      push(from, Math.min(b.start.mic, to));
      from = Math.max(from, b.end.mic);
    }
    if (from < to) push(from, to);
    return out;
  }
  var readinessText = (tired) => tired.length ? `Take it easier for now, because ${tired.map((k) => TIRED_WORDS2[k]).join(" and ")}.` : "Sleep and resting heart rate look normal.";
  function planContext(ctx) {
    const s = situation(ctx);
    const usual = [...s.week].filter(([, u]) => u.activity !== null).sort((a, b) => a[0] - b[0]).map(([wd, u]) => ({
      weekday: wd,
      weekdayName: WEEKDAYS[wd],
      activity: u.activity === "run" && wd === s.long && u.minutes >= LONG_RUN_MIN ? "long_run" : u.activity,
      minutes: u.minutes,
      hour: u.hour,
      intensity: u.effort === null ? u.activity === "other" ? "steady" : null : intensityOf(u.effort),
      basedOn: u.key ? [u.key] : [],
      ...u.activity === "other" ? { label: u.label ?? null } : {}
    }));
    const freeSlots = [];
    for (let i = 0; i < DAYS; i += 1) freeSlots.push(...freeOn(s, s.today + i));
    const daysAway = s.raceDate !== null ? s.raceDate - s.today : null;
    return {
      now: isoDT(s.now),
      window: { from: dayISO(s.today), to: dayISO(s.today + DAYS - 1), earliestStart: isoDT({ mic: s.now.mic + TODAY_LEAD_MIN * US_MIN, off: s.now.off }) },
      usualWeek: usual,
      usualDaysPerWeek: s.usualDays,
      maxSessions: s.maxSessions,
      mostDaysInARow: s.streak,
      usualMinutes: s.minutes.usual,
      minutesRatio: s.minutes.ratio,
      maxMinutes: s.minutes.limit,
      loadUnit: s.unit,
      loadThisWeek: s.load7,
      loadUsual: s.loadUsual,
      loadCap: s.loadCap,
      readiness: { status: s.tired.length ? "ease_off" : "normal", signals: s.tired, text: readinessText(s.tired) },
      freeSlots,
      shoe: s.shoe ? { ...s.shoe, newPairArrives: s.newPairArrives !== null ? dayISO(s.newPairArrives) : null } : null,
      race: s.raceDate !== null ? { date: dayISO(s.raceDate), daysAway, taper: daysAway > 0 && daysAway <= TAPER_DAYS + DAYS, restDay: dayISO(s.raceDate - 1) } : null,
      newPairArrives: s.newPairArrives !== null ? dayISO(s.newPairArrives) : null,
      stoppedKeys: s.stoppedKeys,
      memoryKeys: s.memoryKeys,
      stoppedSlots: s.stopped.map((x) => ({ weekday: x.weekday, weekdayName: WEEKDAYS[x.weekday], activity: x.activity, hour: x.hour, ...x.activity === "other" ? { label: x.label } : {} })),
      usuallyHardDays: [...s.week].filter(([, u]) => u.effort !== null && u.effort >= HARD_EFFORT).map(([wd]) => wd).sort((a, b) => a - b),
      activities: ACTIVITIES,
      intensities: INTENSITIES,
      limits: { minMinutes: MIN_MINUTES, maxMinutes: MAX_MINUTES, shortestSession: MIN_SESSION, wornShoeRunMin: WORN_RUN_MAX_MIN, breakInRunMin: BREAK_IN_MIN },
      ...s.rules ? {
        rules: rulesView(s.rules),
        days: dayKindsView(s.rules, s.dayKinds, s.today, DAYS),
        homeWeek: homeWeekView(s.home, s.homeWeek)
      } : {}
    };
  }
  var ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
  var dayWords = (iso) => `${WEEKDAY_NAMES[weekdayOf(parseDay(iso))]} the ${ordinal(Number(iso.slice(8, 10)))}`;
  var timeWords = (iso) => clock(Number(iso.slice(11, 13)), Number(iso.slice(14, 16)));
  var PLURAL = { run: "runs", long_run: "long runs", walk: "walks", strength: "strength sessions", yoga: "yoga", ride: "rides", elliptical: "elliptical sessions", swim: "swims", stretch: "stretching", rest: "rest" };
  var nameOf = (u) => u.activity === "other" ? u.label || "another activity" : NOUN2[u.activity];
  function planBrief(args) {
    const c = planContext(args?.context ?? args);
    const lines = [];
    const today = c.window.from;
    lines.push(`Plan from today, ${dayWords(today)}, through ${dayWords(c.window.to)}; today nothing starts before ${timeWords(c.window.earliestStart)} or ends after ${clock(TODAY_END_HOUR2)}.`);
    lines.push("Use only activities the app knows, and give each session a day, a start time and a length.");
    lines.push(`Every session lasts between ${MIN_MINUTES} and ${MAX_MINUTES} minutes, and no two sessions overlap.`);
    const groups = /* @__PURE__ */ new Map();
    for (const u of c.usualWeek) {
      const id = `${nameOf(u)}|${u.hour}|${u.minutes}|${u.intensity}`;
      if (!groups.has(id)) groups.set(id, { u, days: [] });
      groups.get(id).days.push(u.weekdayName);
    }
    for (const { u, days } of groups.values()) {
      lines.push(`Usual: ${nameOf(u)} ${days.join(", ")} at ${clock(u.hour)}${u.minutes ? `, ${u.minutes} minutes` : ""}${u.intensity ? `, ${u.intensity}` : ""}.`);
    }
    if (!groups.size) lines.push("No usual week is known yet, so keep this one light.");
    lines.push(`${c.usualDaysPerWeek ? `Usually ${c.usualDaysPerWeek} training ${c.usualDaysPerWeek === 1 ? "day" : "days"} a week; at` : "At"} most ${c.mostDaysInARow} training days in a row before a rest day.`);
    if (c.loadCap !== null) {
      lines.push(c.loadUnit === "minutes" ? `The whole week can hold about ${c.loadCap} minutes of training.` : `The whole week can hold about ${Math.floor(c.loadCap / EFFORT_OF.steady)} minutes at a steady effort; hard minutes count for more, easy ones for less.`);
    }
    lines.push(`At most ${c.maxSessions} training ${c.maxSessions === 1 ? "session" : "sessions"} this week.`);
    if (c.maxMinutes !== null) lines.push(`At most ${c.maxMinutes} minutes of training this week${c.minutesRatio !== null && c.minutesRatio > HIGH_LOAD_RATIO ? ", because the last 7 days were heavier than usual" : ""}.`);
    const hard = c.usuallyHardDays.map((wd) => WEEKDAY_NAMES[wd]);
    lines.push(`Hard days go back to back only on days that are both usually hard${hard.length ? ` (usually hard: ${hard.join(", ")})` : ""}.`);
    const tired = c.readiness.signals;
    if (tired.length) {
      const cause = tired.length === 2 ? "Sleep has been short and resting heart rate is up" : tired[0] === "sleep" ? "Sleep has been short lately" : "Resting heart rate is up";
      lines.push(`${cause}: nothing hard today or tomorrow.`);
    } else lines.push("Sleep and resting heart rate look normal.");
    if (c.race && c.race.daysAway >= 0) {
      const last = parseDay(c.window.to);
      const raceDay = parseDay(c.race.date);
      if (raceDay - 1 <= last) lines.push(`Race ${dayWords(c.race.date)}: nothing else that day${c.race.daysAway >= 1 ? `, and rest on ${dayWords(c.race.restDay)}` : ""}.`);
      if (c.race.daysAway > 1 && raceDay - parseDay(today) <= TAPER_DAYS + DAYS - 1) {
        lines.push(`With the race ${c.race.daysAway} days away, runs in the ${TAPER_DAYS} days before it stay at about four fifths of their usual length, the longest run at three fifths.`);
      }
    }
    const arrives = c.newPairArrives;
    if (c.shoe && c.shoe.status === "replace") lines.push(`The running shoes are nearly worn out: no run longer than ${WORN_RUN_MAX_MIN} minutes${arrives ? ` until the new pair arrives on ${dayWords(arrives)}` : ""}.`);
    if (arrives) lines.push(`The first two runs after the new pair arrives on ${dayWords(arrives)} are easy and at most ${BREAK_IN_MIN} minutes.`);
    if (c.rules) rulesBrief(c, lines);
    const byDay = /* @__PURE__ */ new Map();
    for (const f of c.freeSlots) {
      if (!byDay.has(f.day)) byDay.set(f.day, []);
      byDay.get(f.day).push(`${timeWords(f.start)} to ${timeWords(f.end)}`);
    }
    for (let d = parseDay(today); d <= parseDay(c.window.to); d += 1) {
      const free = byDay.get(dayISO(d));
      const kind = c.days?.find((x) => x.day === dayISO(d))?.kind;
      if (kind === "rest" || kind === "out") {
        lines.push(`${dayWords(dayISO(d))} is ${kind === "rest" ? "a rest day by the person's rules" : "a day out"}: plan nothing.`);
        continue;
      }
      lines.push(free ? `Free on ${dayWords(dayISO(d))}: ${free.join(", ")}.` : `Nothing is free on ${dayWords(dayISO(d))}.`);
    }
    lines.push("Say a session comes from a habit only when that habit is in the memory you were given.");
    for (const x of c.stoppedSlots) lines.push(`Do not plan ${x.activity === "other" ? x.label || "sessions" : PLURAL[x.activity]} on ${WEEKDAY_NAMES[x.weekday]} at ${clock(x.hour)}.`);
    if (c.stoppedKeys.length) lines.push("Do not bring back any habit that was stopped.");
    return { lines };
  }
  var listWords = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
  var ruleClock = (text) => clock(Number(text.slice(0, 2)), Number(text.slice(3, 5)));
  function rulesBrief(c, lines) {
    const r = c.rules;
    const never = r.restWeekdays.map((wd) => WEEKDAY_NAMES[wd]);
    lines.push(`The person's own rules: never plan on ${never.length ? `${listWords(never)}, or on ` : ""}a day they are out.`);
    lines.push(`Every day at home with time to train has exactly one strength session of ${r.sessionMinutes.min} to ${r.sessionMinutes.max} minutes, starting between ${ruleClock(r.window.from)} and ${ruleClock(r.window.to)}.`);
    for (const d of c.homeWeek.days) {
      if (d.focus) lines.push(`${dayWords(d.day)} is at home: a ${FOCUS_WORDS[d.focus]} strength session, first free at ${timeWords(d.first)}.`);
    }
    if (c.homeWeek.note) lines.push(c.homeWeek.note);
  }
  function readSession(a, index, s) {
    if (!a || typeof a !== "object") return { index, error: "invalid_session" };
    try {
      const basedOn = Array.isArray(a.basedOn) ? a.basedOn.filter((k) => typeof k === "string") : [];
      let start;
      let minutes;
      let raw;
      let activity;
      if (a.after && typeof a.after === "object") {
        start = parseDT(a.after.start);
        minutes = (parseDT(a.after.end).mic - start.mic) / US_MIN;
        raw = a.after.activityType;
        activity = activityOf(raw);
      } else {
        raw = a.activity;
        activity = ACTIVITIES.includes(raw) ? raw : null;
        minutes = Number(a.minutes);
        const t = typeof a.start === "string" ? /^(\d{1,2}):(\d\d)$/.exec(a.start.trim()) : null;
        if (t) {
          if (+t[1] > 23 || +t[2] > 59) return { index, error: "invalid_session" };
          start = atDay(parseDay(a.day), s.now.off, +t[1], +t[2]);
        } else start = parseDT(a.start);
        if (!t && a.day !== void 0 && a.day !== null && parseDay(a.day) !== dayOf(start)) return { index, error: "invalid_session" };
      }
      if (!Number.isFinite(minutes) || minutes < 0) return { index, error: "invalid_session" };
      start = { mic: start.mic, off: s.now.off };
      const intensity = a.intensity === "moderate" ? "steady" : a.intensity ?? null;
      if (intensity !== null && !INTENSITIES.includes(intensity)) return { index, error: "invalid_session" };
      const day = dayOf(start);
      const usual = s.week.get(weekdayOf(day));
      const usualEffort = usual && usual.effort !== null ? usual.effort : null;
      const effort2 = intensity === null ? activity === "other" ? EFFORT_OF.steady : usualEffort ?? EFFORT_OF.steady : usualEffort !== null && intensityOf(usualEffort) === intensity ? usualEffort : EFFORT_OF[intensity];
      return { index, id: typeof a.id === "string" ? a.id : null, start, end: addUs(start, minutes * US_MIN), day, minutes, activity, raw, effort: effort2, basedOn };
    } catch (e) {
      if (e instanceof InputError) return { index, error: "invalid_session" };
      throw e;
    }
  }
  var dayName = (day) => WEEKDAY_NAMES[weekdayOf(day)];
  var what = (x) => `${dayName(x.day)}'s ${NOUN2[x.activity] ?? "session"}`;
  var listOf = (args) => args?.plan?.sessions ?? args?.plan?.actions ?? args?.sessions ?? args?.actions;
  function checkPlan(args) {
    const s = situation(args?.context);
    const list = listOf(args);
    if (!Array.isArray(list)) throw new InputError("bad_plan");
    const found = [];
    const add = (code, x, text, fix) => found.push({ code, text, fix, action: x ? x.index : null, sessionId: x && x.id ? x.id : null });
    const items = [];
    list.forEach((a, index) => {
      if (a && a.kind === "note" && !a.after) return;
      const x = readSession(a, index, s);
      if (x.error) add(x.error, { index, id: typeof a?.id === "string" ? a.id : null }, "This session could not be read: it needs a day, a start time, an activity and minutes.", "send day (YYYY-MM-DD), start (ISO 8601 with offset), activity, minutes");
      else if (x.activity === null) add("unknown_activity", x, `"${String(x.raw)}" is not an activity this app knows.`, `use one of: ${ACTIVITIES.join(", ")}`);
      else if (x.activity !== "rest") items.push(x);
    });
    items.sort((a, b) => a.start.mic - b.start.mic || a.index - b.index);
    const windowEnd = atDay(s.today + DAYS, s.now.off).mic;
    const earliest = s.now.mic + TODAY_LEAD_MIN * US_MIN;
    const todayEnd = atDay(s.today, s.now.off, TODAY_END_HOUR2).mic;
    for (const x of items) {
      if (x.minutes < MIN_MINUTES) add("bad_duration", x, `${what(x)} is shorter than ${MIN_MINUTES} minutes.`, `lengthen to \u2265${MIN_MINUTES} min`);
      else if (x.minutes > MAX_MINUTES) add("bad_duration", x, `${what(x)} is longer than ${MAX_MINUTES} minutes.`, `shorten to \u2264${MAX_MINUTES} min`);
      if (x.start.mic < s.now.mic) add("outside_window", x, `${what(x)} is in the past.`, `move to ${hhmm({ mic: earliest, off: s.now.off })} or later`);
      else if (x.start.mic >= windowEnd) add("outside_window", x, `${what(x)} is outside the ${DAYS} days that start today.`, `move to ${dayISO(s.today + DAYS - 1)} or earlier`);
      else if (x.start.mic < earliest) add("outside_window", x, `${what(x)} starts too soon to get ready for.`, `move to ${hhmm({ mic: earliest, off: s.now.off })} or later`);
      else if (x.day === s.today && x.end.mic > todayEnd) add("outside_window", x, `${what(x)} would end too late tonight.`, `end by ${TODAY_END_HOUR2}:00 or move to tomorrow`);
      const busy = s.calendar.find((b) => b.start.mic < x.end.mic && x.start.mic < b.end.mic);
      if (busy) add("calendar_conflict", x, `${what(x)} overlaps ${busy.title ? `"${busy.title}"` : "something"} on your calendar.`, `move after ${hhmm({ mic: busy.end.mic, off: s.now.off })}`);
      if (isStopped(s.stopped, x.activity, weekdayOf(x.day), hourOf(x.start))) {
        const hit = s.stopped.find((y) => y.activity === (x.activity === "long_run" ? "run" : x.activity) && y.weekday === weekdayOf(x.day) && y.hour === hourOf(x.start));
        add("stopped_slot", x, `You asked me not to plan ${dayName(x.day)} ${clock(hit.hour)} ${hit.activity === "other" ? hit.label || "sessions" : PLURAL[hit.activity]}.`, "move to another hour or remove this session");
      }
      for (const key of x.basedOn) {
        if (s.stoppedKeys.includes(key)) add("stopped_memory_key", x, `${what(x)} leans on a habit you asked to stop.`, "remove this session");
        else if (!s.memoryKeys.includes(key)) add("unknown_memory_key", x, `${what(x)} cites a memory that is not there.`, "remove that key from basedOn");
      }
    }
    items.forEach((x, i) => {
      const next = items[i + 1];
      if (next && next.start.mic < x.end.mic) add("overlap", next, `${what(next)} starts before ${what(x)} ends.`, `move after ${hhmm(x.end)}`);
    });
    const loadOf = (x) => s.unit === "minutes" ? x.minutes : x.effort * x.minutes;
    const planned = pySum(items.map(loadOf));
    if (s.loadCap !== null && planned > s.loadCap * LOAD_SLACK && items.some((x) => x.minutes > MIN_SESSION)) {
      const perMinute = s.unit === "minutes" ? 1 : planned / Math.max(1, pySum(items.map((x) => x.minutes)));
      add("load_over_cap", null, "This week adds up to more than your body is used to.", `shorten the week by ${Math.ceil((planned - s.loadCap) / perMinute)} min in total`);
    }
    if (s.tired.length) {
      for (const x of items) {
        if (x.day <= s.today + 1 && x.effort >= HARD_EFFORT) add("hard_when_tired", x, `${what(x)} is a hard one, and ${s.tired.map((k) => TIRED_WORDS2[k]).join(" and ")}.`, "make it easy");
      }
    }
    if (s.raceDate !== null) {
      const runMinutes = [...s.week.values()].filter((u) => u.activity === "run" && u.minutes !== null).map((u) => u.minutes);
      for (const x of items) {
        const toRace = s.raceDate - x.day;
        if (toRace === 0) add("race_day_session", x, "Race day is for the race alone.", "remove this session");
        else if (toRace === 1) add("no_rest_before_race", x, "The day before your race is a rest day.", "remove this session");
        else if (toRace > 0 && toRace <= TAPER_DAYS && isRun(x.activity)) {
          const wd = weekdayOf(x.day);
          const usual = s.week.get(wd);
          const base = usual && usual.activity === "run" && usual.minutes !== null ? usual.minutes * (wd === s.long ? 0.6 : 0.8) : runMinutes.length ? pyMedian(runMinutes) * 0.8 : null;
          const limit = base === null ? TAPER_RUN_MAX_MIN : Math.max(MIN_SESSION, pyRound(base));
          if (x.minutes > limit) add("taper_too_long", x, `${what(x)} is too long this close to your race.`, `shorten to \u2264${limit} min`);
        }
      }
    }
    let brokenIn = 0;
    for (const x of items) {
      if (!isRun(x.activity)) continue;
      const arrived = s.newPairArrives !== null && x.day > s.newPairArrives;
      if (s.shoe && s.shoe.status === "replace" && !arrived && x.minutes > WORN_RUN_MAX_MIN) {
        add("worn_shoes_long_run", x, `${what(x)} is too long for shoes this worn.`, `shorten to \u2264${WORN_RUN_MAX_MIN} min or switch to ride`);
      } else if (arrived && brokenIn < 2) {
        if (x.minutes > BREAK_IN_MIN) add("break_in_too_long", x, `${what(x)} is too long for a first run in new shoes.`, `shorten to \u2264${BREAK_IN_MIN} min`);
        if (x.effort > EASY_EFFORT) add("break_in_not_easy", x, `${what(x)} should be easy while your new shoes break in.`, "make it easy");
        brokenIn += 1;
      }
    }
    if (items.length > s.maxSessions) {
      const extra = items.length - s.maxSessions;
      add("too_many_sessions", null, `This week has ${items.length} sessions, and ${s.maxSessions} is the most that fits you for now.`, `remove ${extra} ${extra === 1 ? "session" : "sessions"}`);
    }
    const totalMinutes = items.reduce((sum, x) => sum + x.minutes, 0);
    if (s.minutes.limit !== null && totalMinutes > s.minutes.limit) {
      add("too_many_minutes", null, `This week adds up to ${pyRound(totalMinutes)} minutes, and ${s.minutes.limit} is the most that fits you for now.`, `shorten the week by ${Math.ceil(totalMinutes - s.minutes.limit)} min in total`);
    }
    const days = [...new Set(items.map((x) => x.day))].sort((a, b) => a - b);
    let run = 0;
    days.forEach((d, i) => {
      run = i && d === days[i - 1] + 1 ? run + 1 : 1;
      if (run === s.streak + 1) add("too_many_days_in_a_row", items.find((it) => it.day === d), `${dayName(d)} would be day ${run} in a row without a rest.`, "remove this session or move it after a rest day");
    });
    const hardDays = /* @__PURE__ */ new Map();
    for (const x of items) if (x.effort >= HARD_EFFORT && !hardDays.has(x.day)) hardDays.set(x.day, x);
    const usuallyHard = (d) => {
      const u = s.week.get(weekdayOf(d));
      return Boolean(u && u.effort !== null && u.effort >= HARD_EFFORT);
    };
    for (const [d, x] of hardDays) {
      if (hardDays.has(d - 1) && !(usuallyHard(d) && usuallyHard(d - 1))) add("back_to_back_hard", x, `${what(x)} is hard and so is the day before.`, "make it easy or move it a day later");
    }
    if (s.rules) checkRules(s, items, add);
    found.sort((a, b) => (a.action ?? 1e9) - (b.action ?? 1e9));
    const where = (v) => ({ ...v.action === null ? {} : { action: v.action }, ...v.sessionId ? { sessionId: v.sessionId } : {} });
    return {
      pass: found.length === 0,
      violations: found.map((v) => ({ code: v.code, text: v.text, ...v.sessionId ? { sessionId: v.sessionId } : {} })),
      hints: found.map((v) => ({ code: v.code, ...where(v), fix: v.fix })),
      load: { unit: s.unit, planned: pyRound(planned), cap: s.loadCap }
    };
  }
  function checkRules(s, items, add) {
    const r = s.rules;
    const at = (minutes) => clock(Math.floor(minutes / 60), minutes % 60);
    for (const x of items) {
      const kind = kindOf(r, s.dayKinds, x.day);
      if (kind === "rest") add("rest_day_rule", x, `${dayName(x.day)} is a day you never train.`, "remove this session");
      else if (kind === "out") add("out_day_rule", x, `You are out on ${dayName(x.day)}, so nothing is planned that day.`, "remove this session");
      else if (x.activity === "strength") {
        const minute = (x.start.mic - atDay(x.day, s.now.off).mic) / US_MIN;
        if (minute < r.window.from || minute > r.window.to) add("outside_rule_hours", x, `${what(x)} starts outside the hours you allow.`, `start between ${at(r.window.from)} and ${at(r.window.to)}`);
        if (x.minutes < r.session.min || x.minutes > r.session.max) add("session_length_rule", x, `${what(x)} is not ${r.session.min} to ${r.session.max} minutes long.`, `make it ${r.session.max} min`);
      }
    }
    for (const d of s.homeWeek.days) {
      if (d.first === null || items.some((x) => x.day === d.day && x.activity === "strength")) continue;
      add(
        "home_day_missing",
        null,
        `${dayName(d.day)} is a day at home, and every day at home has a workout.`,
        `add a ${r.session.max}-minute strength session on ${dayISO(d.day)} at ${hhmm({ mic: d.first, off: s.now.off })}`
      );
    }
  }
  function explainAction(args) {
    const action = args?.action ?? args?.session;
    if (!action || typeof action !== "object") throw new InputError("bad_action");
    const mem = readMemory(args.memory);
    const basedOn = Array.isArray(action.basedOn) ? action.basedOn.filter((k) => typeof k === "string") : [];
    const reasons = Array.isArray(action.reasons) ? action.reasons.map((r) => r?.text).filter((t) => typeof t === "string" && t) : [];
    const parts2 = reasons.length ? [...new Set(reasons)] : [typeof action.reason === "string" && action.reason ? action.reason : "This session is part of your usual week."];
    const memory = basedOn.map((key) => {
      if (mem.stoppedKeys.includes(key)) return { key, found: false, text: "You asked to stop this habit, so it will not be suggested again." };
      const slot = mem.slots.find((x) => x.key === key);
      const row = mem.rows.find((r) => r.key === key);
      if (slot) {
        const seen = Number.isInteger(slot.weeksSeen) && Number.isInteger(slot.weeksTotal) ? `, seen in ${slot.weeksSeen} of the last ${slot.weeksTotal} weeks` : "";
        const habit = slot.activity === "other" ? slot.label ?? "a session" : `a ${NOUN2[slot.activity]}`;
        return { key, found: true, text: `It comes from a habit in your memory: ${habit} on ${WEEKDAY_NAMES[slot.weekday]}s around ${clock(slot.hour)}${seen}.` };
      }
      if (row) return { key, found: true, text: typeof row.statement === "string" && row.statement ? `It comes from your memory: ${row.statement}` : "It comes from your memory." };
      return { key, found: false, text: "The habit it came from is no longer in your memory." };
    });
    return { text: [...parts2, ...memory.map((x) => x.text)].join(" "), basedOn, memory };
  }
  function checkWeek(args) {
    const list = listOf(args);
    if (!Array.isArray(list)) throw new InputError("bad_plan");
    const first = list.find((a) => a && typeof (a.after?.start ?? a.start) === "string" && (a.after?.start ?? a.start).length > 5);
    const now = parseDT(args.now ?? first?.after?.start ?? first?.start ?? "1970-01-01T00:00:00Z");
    const s = { now, week: /* @__PURE__ */ new Map() };
    const calendar = (args.calendar ?? args.busy ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === "string" ? b.title : null }));
    const items = [];
    list.forEach((a, index) => {
      if (a && a.kind === "note" && !a.after) return;
      const x = readSession(a, index, s);
      if (!x.error && x.activity !== "rest") items.push(x);
    });
    items.sort((a, b) => a.start.mic - b.start.mic || a.index - b.index);
    const conflicts = [];
    const at = (mic) => isoDT({ mic, off: now.off });
    items.forEach((x, i) => {
      for (const b of calendar) {
        if (b.start.mic < x.end.mic && x.start.mic < b.end.mic) {
          conflicts.push({
            code: "calendar_conflict",
            action: x.index,
            id: x.id,
            title: b.title,
            start: at(b.start.mic),
            end: at(b.end.mic),
            text: `${what(x)} overlaps ${b.title ? `"${b.title}"` : "something"} on your calendar.`,
            fix: `move after ${hhmm({ mic: b.end.mic, off: now.off })}`
          });
        }
      }
      const next = items[i + 1];
      if (next && next.start.mic < x.end.mic) {
        conflicts.push({
          code: "overlap",
          action: next.index,
          id: next.id,
          title: null,
          start: at(x.start.mic),
          end: at(x.end.mic),
          text: `${what(next)} starts before ${what(x)} ends.`,
          fix: `move after ${hhmm(x.end)}`
        });
      }
    });
    return { conflicts };
  }

  // data/movements.json
  var movements_default = {
    version: 1,
    note: "Every movement Evergreen may plan, with one set of words for each. Units are reps and seconds only. Backpack load is in kilograms: 1 litre of water weighs 1 kg.",
    movements: [
      {
        id: "sit_to_stand",
        name: "Sit down and stand up",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "chair"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand in front of a sturdy chair, feet hip-width apart.",
        steps: [
          "Sit down to the chair in 3 seconds, arms crossed on your chest.",
          "Touch the seat lightly, don't rest.",
          "Stand up in 1 second."
        ],
        feel: "Front of the thighs and the buttocks.",
        pass: "Buttocks touch the seat each time and you stand all the way up without using your hands.",
        mistakes: [
          "Dropping onto the seat instead of lowering.",
          "Knees falling inwards."
        ],
        easier: null,
        harder: "bodyweight_squat",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "bodyweight_squat",
        name: "Squat",
        pattern: "lower_push",
        position: "stand",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand with feet shoulder-width apart, toes slightly out.",
        steps: [
          "Push your hips back and bend your knees for 3 seconds.",
          "Stop when your thighs are level with the floor.",
          "Stand up in 1 second."
        ],
        feel: "Front of the thighs and the buttocks.",
        pass: "Thighs reach level with the floor, heels stay down and knees point the same way as the toes.",
        mistakes: [
          "Heels lifting off the floor.",
          "Knees falling inwards."
        ],
        easier: "sit_to_stand",
        harder: "backpack_squat",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "backpack_squat",
        name: "Backpack squat",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand with feet shoulder-width apart, backpack held against your chest.",
        steps: [
          "Hug the backpack to your chest.",
          "Push your hips back and bend your knees for 3 seconds.",
          "Stop when your thighs are level with the floor.",
          "Stand up in 1 second."
        ],
        feel: "Front of the thighs and the buttocks.",
        pass: "Thighs reach level with the floor, heels stay down and the backpack stays against your chest.",
        mistakes: [
          "Leaning far forward.",
          "Knees falling inwards."
        ],
        easier: "bodyweight_squat",
        harder: "single_leg_box_squat",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "single_leg_box_squat",
        name: "One-leg sit down to a chair",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "chair"
        ],
        level: 4,
        balance: true,
        entry: false,
        gated: true,
        setup: "Stand in front of a sturdy chair on one leg, arms forward.",
        steps: [
          "Lift one foot just off the floor.",
          "Sit down to the chair on the other leg in 3 seconds.",
          "Stand up on the same leg in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Front of the thigh and the buttock of the standing leg.",
        pass: "Buttocks touch the seat and you stand back up without the lifted foot touching the floor.",
        mistakes: [
          "Dropping onto the seat.",
          "Standing knee falling inwards."
        ],
        easier: "backpack_squat",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            5,
            8
          ]
        },
        sides: 2,
        rest: 60,
        images: []
      },
      {
        id: "glute_bridge",
        name: "Hip lift on the floor",
        pattern: "lower_pull",
        position: "floor",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Lie on your back, knees bent, feet flat and hip-width apart, arms by your sides.",
        steps: [
          "Push through your heels and lift your hips in 1 second.",
          "Hold at the top for 1 second.",
          "Lower in 3 seconds."
        ],
        feel: "Buttocks and back of the thighs.",
        pass: "At the top your shoulders, hips and knees are in one straight line.",
        mistakes: [
          "Arching the lower back at the top.",
          "Pushing through the toes instead of the heels."
        ],
        easier: null,
        harder: "backpack_hip_thrust",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "backpack_hip_thrust",
        name: "Hip lift with shoulders on the sofa",
        pattern: "lower_pull",
        position: "floor",
        equipment: [
          "sofa",
          "backpack"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Sit on the floor with your upper back against the sofa edge, knees bent, feet flat.",
        steps: [
          "Hold the backpack on your hips.",
          "Push through your heels and lift your hips in 1 second.",
          "Hold at the top for 1 second.",
          "Lower in 3 seconds."
        ],
        feel: "Buttocks and back of the thighs.",
        pass: "At the top your shins are upright and your shoulders, hips and knees are in one straight line.",
        mistakes: [
          "Arching the lower back at the top.",
          "Feet too close, so the knees bend past the toes."
        ],
        easier: "glute_bridge",
        harder: "single_leg_glute_bridge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "single_leg_glute_bridge",
        name: "One-leg hip lift",
        pattern: "lower_pull",
        position: "floor",
        equipment: [],
        level: 4,
        balance: false,
        entry: false,
        gated: true,
        setup: "Lie on your back, knees bent, feet flat, arms by your sides.",
        steps: [
          "Lift one foot and straighten that leg.",
          "Push through the other heel and lift your hips in 1 second.",
          "Lower in 3 seconds.",
          "Do all reps on one side, then the other."
        ],
        feel: "Buttocks and back of the thigh of the working leg.",
        pass: "At the top both hips are level and in one straight line with the shoulder and the bent knee.",
        mistakes: [
          "One hip dropping lower than the other.",
          "Pushing through the toes."
        ],
        easier: "backpack_hip_thrust",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 2,
        rest: 60,
        images: []
      },
      {
        id: "wall_split_squat",
        name: "Split squat holding the wall",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "wall"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand side-on to a wall, one hand on it, one foot a long step in front of the other.",
        steps: [
          "Lower your back knee towards the floor in 3 seconds.",
          "Stop with the back knee a hand's width above the floor.",
          "Push up in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Front of the thigh and the buttock of the front leg.",
        pass: "The back knee stops a hand's width above the floor and the front knee stays over the front foot.",
        mistakes: [
          "Front heel lifting.",
          "Front knee falling inwards."
        ],
        easier: null,
        harder: "reverse_lunge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 2,
        rest: 60,
        images: []
      },
      {
        id: "reverse_lunge",
        name: "Step back and lower",
        pattern: "lower_push",
        position: "stand",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand tall, feet hip-width apart, hands on hips.",
        steps: [
          "Step one foot back.",
          "Lower the back knee in 3 seconds to a hand's width above the floor.",
          "Push through the front heel and step back up in 1 second.",
          "Change legs each time."
        ],
        feel: "Front of the thigh and the buttock of the front leg.",
        pass: "The back knee stops a hand's width above the floor and you return to standing without a wobble.",
        mistakes: [
          "Short step, so the front knee shoots forward.",
          "Leaning the upper body forward."
        ],
        easier: "wall_split_squat",
        harder: "backpack_reverse_lunge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "backpack_reverse_lunge",
        name: "Step back and lower with the backpack",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand tall, feet hip-width apart, backpack held against your chest.",
        steps: [
          "Hug the backpack to your chest.",
          "Step one foot back and lower the back knee in 3 seconds.",
          "Push through the front heel and step back up in 1 second.",
          "Change legs each time."
        ],
        feel: "Front of the thigh and the buttock of the front leg.",
        pass: "The back knee stops a hand's width above the floor and the backpack stays against your chest.",
        mistakes: [
          "Short step, so the front knee shoots forward.",
          "Leaning the upper body forward."
        ],
        easier: "reverse_lunge",
        harder: "rear_foot_split_squat",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "rear_foot_split_squat",
        name: "Split squat with the back foot on the sofa",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "sofa"
        ],
        level: 4,
        balance: true,
        entry: false,
        gated: true,
        setup: "Stand a long step in front of the sofa, the top of your back foot resting on the seat.",
        steps: [
          "Lower your back knee in 3 seconds.",
          "Stop with the front thigh level with the floor.",
          "Push up through the front heel in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Front of the thigh and the buttock of the front leg.",
        pass: "The front thigh reaches level with the floor and the front heel stays down.",
        mistakes: [
          "Front foot too close to the sofa.",
          "Front knee falling inwards."
        ],
        easier: "backpack_reverse_lunge",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 2,
        rest: 60,
        images: []
      },
      {
        id: "hip_hinge",
        name: "Push the hips back",
        pattern: "lower_pull",
        position: "stand",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand with feet hip-width apart, knees a little bent, hands on the front of your thighs.",
        steps: [
          "Keep your back straight and push your hips back in 3 seconds.",
          "Stop when your upper body is about halfway to level.",
          "Push your hips forward to stand in 1 second."
        ],
        feel: "Back of the thighs and the buttocks.",
        pass: "Your hands slide down to just above the knees, your back stays straight and your knees don't bend further.",
        mistakes: [
          "Rounding the back.",
          "Bending the knees into a squat."
        ],
        easier: null,
        harder: "backpack_hip_hinge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "backpack_hip_hinge",
        name: "Push the hips back with the backpack",
        pattern: "lower_pull",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand with feet hip-width apart, knees a little bent, backpack hanging in front of your thighs.",
        steps: [
          "Hold the backpack by its top handle in both hands.",
          "Keep your back straight and push your hips back in 3 seconds.",
          "Stop when the backpack reaches your knees.",
          "Push your hips forward to stand in 1 second."
        ],
        feel: "Back of the thighs and the buttocks.",
        pass: "The backpack reaches the knees with a straight back, and you finish standing tall.",
        mistakes: [
          "Rounding the back.",
          "Lifting with the arms."
        ],
        easier: "hip_hinge",
        harder: "staggered_hip_hinge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "staggered_hip_hinge",
        name: "Push the hips back, one foot ahead",
        pattern: "lower_pull",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand with one foot half a step ahead of the other, backpack in both hands.",
        steps: [
          "Put most of your weight on the front foot.",
          "Keep your back straight and push your hips back in 3 seconds until the backpack reaches the front knee.",
          "Stand up in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Back of the thigh and the buttock of the front leg.",
        pass: "The backpack reaches the front knee with a straight back and the back foot only rests on its toes.",
        mistakes: [
          "Rounding the back.",
          "Shifting the weight to the back foot."
        ],
        easier: "backpack_hip_hinge",
        harder: "single_leg_hinge",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 2,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "single_leg_hinge",
        name: "One-leg reach",
        pattern: "lower_pull",
        position: "stand",
        equipment: [],
        level: 4,
        balance: true,
        entry: false,
        gated: true,
        setup: "Stand on one leg, the other foot just off the floor, arms hanging.",
        steps: [
          "Lean forward from the hips while the free leg goes back in 3 seconds.",
          "Stop when your body and the back leg are near level.",
          "Come back up in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Back of the thigh and the buttock of the standing leg.",
        pass: "Your upper body and the back leg form one straight line and the free foot doesn't touch down.",
        mistakes: [
          "Twisting the hips open.",
          "Rounding the back."
        ],
        easier: "staggered_hip_hinge",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 2,
        rest: 60,
        images: []
      },
      {
        id: "calf_raise",
        name: "Rise onto the toes",
        pattern: "lower_push",
        position: "stand",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand with feet hip-width apart, fingertips on a wall for balance.",
        steps: [
          "Rise onto your toes in 1 second.",
          "Hold at the top for 1 second.",
          "Lower in 3 seconds."
        ],
        feel: "Calves.",
        pass: "Heels lift as high as they go each time and come all the way back down.",
        mistakes: [
          "Bouncing.",
          "Rolling onto the outer edge of the feet."
        ],
        easier: null,
        harder: "wall_single_calf_raise",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            12,
            20
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "wall_single_calf_raise",
        name: "One-foot rise, hand on the wall",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "wall"
        ],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand on one foot, one hand on a wall.",
        steps: [
          "Lift one foot.",
          "Rise onto the toes of the other in 1 second.",
          "Lower in 3 seconds.",
          "Do all reps on one side, then the other."
        ],
        feel: "Calf of the standing leg.",
        pass: "The heel lifts as high as it goes and comes all the way down, with the hand only steadying you.",
        mistakes: [
          "Pushing on the wall to rise.",
          "Bending the knee."
        ],
        easier: "calf_raise",
        harder: "book_edge_calf_raise",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 2,
        rest: 45,
        images: []
      },
      {
        id: "book_edge_calf_raise",
        name: "One-foot rise off a book",
        pattern: "lower_push",
        position: "stand",
        equipment: [
          "book",
          "wall"
        ],
        level: 3,
        balance: true,
        entry: false,
        gated: true,
        setup: "Stand on one foot with the ball of the foot on a thick book, one hand on a wall.",
        steps: [
          "Let your heel drop below the book edge in 3 seconds.",
          "Rise as high as you can in 1 second.",
          "Do all reps on one side, then the other."
        ],
        feel: "Calf of the standing leg.",
        pass: "The heel goes below the book edge and then rises above it every time.",
        mistakes: [
          "Bending the knee.",
          "Rushing the way down."
        ],
        easier: "wall_single_calf_raise",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 2,
        rest: 45,
        images: []
      },
      {
        id: "wall_push_up",
        name: "Push-up against the wall",
        pattern: "upper_push",
        position: "wall",
        equipment: [
          "wall"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand an arm's length from a wall, hands on it at shoulder height.",
        steps: [
          "Lower your chest to the wall in 3 seconds.",
          "Keep your body straight from head to heels.",
          "Push back in 1 second."
        ],
        feel: "Chest, front of the shoulders and back of the arms.",
        pass: "Your nose comes within a fist of the wall and your hips stay in line with your shoulders and heels.",
        mistakes: [
          "Hips sagging or sticking out.",
          "Elbows flaring straight out to the sides."
        ],
        easier: null,
        harder: "table_push_up",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "table_push_up",
        name: "Push-up on the table edge",
        pattern: "upper_push",
        position: "wall",
        equipment: [
          "table"
        ],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Hands on the edge of a sturdy table, shoulder-width apart, feet back so your body is straight.",
        steps: [
          "Lower your chest to the table edge in 3 seconds.",
          "Keep your body straight.",
          "Push back up in 1 second."
        ],
        feel: "Chest, front of the shoulders and back of the arms.",
        pass: "Your chest comes within a fist of the edge and your hips don't sag.",
        mistakes: [
          "Hips sagging.",
          "Elbows flaring straight out to the sides."
        ],
        easier: "wall_push_up",
        harder: "knee_push_up",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "knee_push_up",
        name: "Push-up on the knees",
        pattern: "upper_push",
        position: "floor",
        equipment: [],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Hands on the floor under your shoulders, knees on the floor, body straight from knees to head.",
        steps: [
          "Lower your chest to the floor in 3 seconds.",
          "Keep a straight line from knees to head.",
          "Push back up in 1 second."
        ],
        feel: "Chest, front of the shoulders and back of the arms.",
        pass: "Your chest comes within a fist of the floor and your hips stay in line.",
        mistakes: [
          "Hips piking up.",
          "Head dropping first."
        ],
        easier: "table_push_up",
        harder: "push_up",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "push_up",
        name: "Push-up",
        pattern: "upper_push",
        position: "floor",
        equipment: [],
        level: 4,
        balance: false,
        entry: false,
        gated: true,
        setup: "Hands on the floor under your shoulders, legs straight behind you on your toes.",
        steps: [
          "Lower your chest to the floor in 3 seconds.",
          "Keep your body straight from head to heels.",
          "Push back up in 1 second."
        ],
        feel: "Chest, front of the shoulders and back of the arms.",
        pass: "Your chest comes within a fist of the floor and your hips stay in line with your shoulders and heels.",
        mistakes: [
          "Hips sagging.",
          "Only the head going down."
        ],
        easier: "knee_push_up",
        harder: "feet_up_push_up",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "feet_up_push_up",
        name: "Push-up with feet on the sofa",
        pattern: "upper_push",
        position: "floor",
        equipment: [
          "sofa"
        ],
        level: 5,
        balance: false,
        entry: false,
        gated: true,
        setup: "Hands on the floor under your shoulders, feet on the sofa seat behind you.",
        steps: [
          "Lower your chest to the floor in 3 seconds.",
          "Keep your body straight.",
          "Push back up in 1 second."
        ],
        feel: "Chest, front of the shoulders and back of the arms.",
        pass: "Your chest comes within a fist of the floor and your hips stay in line.",
        mistakes: [
          "Hips sagging.",
          "Hands too far forward."
        ],
        easier: "push_up",
        harder: "pike_push_up",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "pike_push_up",
        name: "Hips-high push-up",
        pattern: "upper_push",
        position: "floor",
        equipment: [],
        level: 5,
        balance: false,
        entry: false,
        gated: true,
        setup: "Hands and feet on the floor, hips high so your body makes an upside-down V.",
        steps: [
          "Bend your elbows and lower the top of your head towards the floor in 3 seconds.",
          "Push back up in 1 second."
        ],
        feel: "Shoulders and back of the arms.",
        pass: "The top of your head comes within a fist of the floor between your hands, hips stay high.",
        mistakes: [
          "Dropping the hips.",
          "Hands too close to the feet."
        ],
        easier: "feet_up_push_up",
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            5,
            8
          ]
        },
        sides: 1,
        rest: 60,
        images: []
      },
      {
        id: "backpack_press",
        name: "Backpack press overhead",
        pattern: "upper_push",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 2,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand tall, feet hip-width apart, backpack held by its sides at your chest.",
        steps: [
          "Press the backpack straight up in 1 second until your arms are straight.",
          "Lower it to your chest in 3 seconds."
        ],
        feel: "Shoulders and back of the arms.",
        pass: "At the top your arms are straight beside your ears and your lower back stays flat.",
        mistakes: [
          "Arching the back.",
          "Pushing the backpack forward, not up."
        ],
        easier: null,
        harder: "slow_backpack_press",
        tempo: {
          down: 3,
          hold: 0,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 2
      },
      {
        id: "slow_backpack_press",
        name: "Slow backpack press overhead",
        pattern: "upper_push",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand tall, feet hip-width apart, backpack held by its sides at your chest.",
        steps: [
          "Press the backpack up in 1 second.",
          "Hold at the top for 2 seconds.",
          "Lower it to your chest in 4 seconds."
        ],
        feel: "Shoulders and back of the arms.",
        pass: "Arms straight beside the ears for the full 2 seconds and the lower back stays flat.",
        mistakes: [
          "Arching the back.",
          "Rushing the way down."
        ],
        easier: "backpack_press",
        harder: null,
        tempo: {
          down: 4,
          hold: 2,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            6,
            10
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 2
      },
      {
        id: "backpack_row",
        name: "Backpack row",
        pattern: "upper_pull",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Feet hip-width apart, sit your hips back and lean forward to about 45 degrees with a straight back, backpack hanging from both hands.",
        steps: [
          "Pull the backpack to your lower ribs in 1 second.",
          "Squeeze your shoulder blades for 1 second.",
          "Lower it in 3 seconds."
        ],
        feel: "Upper back and the back of the shoulders.",
        pass: "The backpack touches your lower ribs each time and your back stays straight and still.",
        mistakes: [
          "Standing up as you pull.",
          "Rounding the back."
        ],
        easier: null,
        harder: "one_arm_row",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "one_arm_row",
        name: "One-arm row, hand on a chair",
        pattern: "upper_pull",
        position: "stand",
        equipment: [
          "backpack",
          "chair"
        ],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "One hand on a chair seat, the same-side foot back, back straight and level, backpack in the free hand.",
        steps: [
          "Pull the backpack to your hip in 1 second.",
          "Hold for 1 second.",
          "Lower it in 3 seconds.",
          "Do all reps on one side, then the other."
        ],
        feel: "Upper back and the back of the shoulder.",
        pass: "The backpack reaches your hip, your elbow passes your back and your shoulders stay level.",
        mistakes: [
          "Twisting the body to lift.",
          "Shrugging the shoulder up."
        ],
        easier: "backpack_row",
        harder: "slow_one_arm_row",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 2,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "slow_one_arm_row",
        name: "Slow one-arm row",
        pattern: "upper_pull",
        position: "stand",
        equipment: [
          "backpack",
          "chair"
        ],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "One hand on a chair seat, back straight and level, backpack in the free hand.",
        steps: [
          "Pull the backpack to your hip in 1 second.",
          "Hold for 2 seconds.",
          "Lower it in 4 seconds.",
          "Do all reps on one side, then the other."
        ],
        feel: "Upper back and the back of the shoulder.",
        pass: "The backpack stays at your hip for the full 2 seconds and your shoulders stay level.",
        mistakes: [
          "Twisting the body to lift.",
          "Rushing the way down."
        ],
        easier: "one_arm_row",
        harder: null,
        tempo: {
          down: 4,
          hold: 2,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 2,
        rest: 60,
        images: [],
        load: 4
      },
      {
        id: "prone_arm_raise",
        name: "Arms up lying face down",
        pattern: "upper_pull",
        position: "floor",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Lie face down, arms stretched forward in a Y, thumbs up, forehead on a folded towel.",
        steps: [
          "Lift both arms off the floor in 1 second.",
          "Hold for 1 second.",
          "Lower in 3 seconds."
        ],
        feel: "Upper back and the back of the shoulders.",
        pass: "Both hands lift a fist's height off the floor and your forehead stays down.",
        mistakes: [
          "Lifting the head and chest instead of the arms.",
          "Bending the elbows."
        ],
        easier: null,
        harder: "prone_arm_raise_hold",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "prone_arm_raise_hold",
        name: "Arms up lying face down, with a hold",
        pattern: "upper_pull",
        position: "floor",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Lie face down, arms stretched forward in a Y, thumbs up, forehead on a folded towel.",
        steps: [
          "Lift both arms off the floor in 1 second.",
          "Hold for 2 seconds.",
          "Lower in 3 seconds."
        ],
        feel: "Upper back and the back of the shoulders.",
        pass: "Both hands stay a fist's height off the floor for the full 2 seconds.",
        mistakes: [
          "Lifting the head.",
          "Bending the elbows."
        ],
        easier: "prone_arm_raise",
        harder: null,
        tempo: {
          down: 3,
          hold: 2,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "backpack_curl",
        name: "Backpack curl",
        pattern: "upper_pull",
        position: "stand",
        equipment: [
          "backpack"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand tall, backpack held by its top handle with both hands, arms straight.",
        steps: [
          "Bend your elbows and lift the backpack to your chest in 1 second.",
          "Lower it in 3 seconds until your arms are straight."
        ],
        feel: "Front of the upper arms.",
        pass: "Your elbows stay at your sides and the backpack goes from straight arms to your chest each time.",
        mistakes: [
          "Swinging the body.",
          "Elbows drifting forward."
        ],
        easier: null,
        harder: null,
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 45,
        images: [],
        load: 2
      },
      {
        id: "dead_bug",
        name: "Opposite arm and leg out, lying on your back",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Lie on your back, arms pointing at the ceiling, knees bent at 90 degrees above your hips.",
        steps: [
          "Reach one arm back and the opposite leg out in 3 seconds.",
          "Stop just above the floor.",
          "Bring them back in 1 second.",
          "Change sides each time."
        ],
        feel: "Stomach.",
        pass: "Your lower back stays pressed to the floor and the moving heel stops just above it.",
        mistakes: [
          "Lower back lifting off the floor.",
          "Moving the arm and leg of the same side."
        ],
        easier: null,
        harder: "forearm_plank",
        tempo: {
          down: 3,
          hold: 1,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "forearm_plank",
        name: "Forearm plank",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Lie face down, forearms on the floor under your shoulders, on your toes.",
        steps: [
          "Lift your hips so your body is straight from head to heels.",
          "Hold, breathing normally."
        ],
        feel: "Stomach and front of the shoulders.",
        pass: "Shoulders, hips and heels stay in one straight line for the whole time.",
        mistakes: [
          "Hips sagging.",
          "Hips piking up."
        ],
        easier: "dead_bug",
        harder: "long_lever_plank",
        tempo: null,
        dose: {
          sets: 3,
          seconds: [
            20,
            40
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "long_lever_plank",
        name: "Forearm plank, elbows further forward",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 3,
        balance: false,
        entry: false,
        gated: false,
        setup: "Lie face down on your forearms, on your toes.",
        steps: [
          "Place your elbows a hand ahead of your shoulders.",
          "Lift your hips so your body is straight.",
          "Hold, breathing normally."
        ],
        feel: "Stomach.",
        pass: "Elbows stay ahead of the shoulders and the body stays in one straight line for the whole time.",
        mistakes: [
          "Hips sagging.",
          "Holding your breath."
        ],
        easier: "forearm_plank",
        harder: null,
        tempo: null,
        dose: {
          sets: 3,
          seconds: [
            20,
            30
          ]
        },
        sides: 1,
        rest: 45,
        images: []
      },
      {
        id: "kneeling_side_plank",
        name: "Side plank on the knees",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Lie on your side, elbow under the shoulder, knees bent behind you.",
        steps: [
          "Lift your hips off the floor.",
          "Hold, then do the other side."
        ],
        feel: "Side of the stomach.",
        pass: "Shoulder, hip and knee stay in one straight line for the whole time.",
        mistakes: [
          "Hips dropping.",
          "Leaning forward."
        ],
        easier: null,
        harder: "side_plank",
        tempo: null,
        dose: {
          sets: 3,
          seconds: [
            15,
            30
          ]
        },
        sides: 2,
        rest: 30,
        images: []
      },
      {
        id: "side_plank",
        name: "Side plank",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Lie on your side, elbow under the shoulder, legs straight and stacked.",
        steps: [
          "Lift your hips off the floor.",
          "Hold, then do the other side."
        ],
        feel: "Side of the stomach.",
        pass: "Shoulder, hip and ankle stay in one straight line for the whole time.",
        mistakes: [
          "Hips dropping.",
          "Leaning forward."
        ],
        easier: "kneeling_side_plank",
        harder: null,
        tempo: null,
        dose: {
          sets: 3,
          seconds: [
            15,
            30
          ]
        },
        sides: 2,
        rest: 30,
        images: []
      },
      {
        id: "bird_dog",
        name: "Opposite arm and leg out, on hands and knees",
        pattern: "core",
        position: "floor",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "On hands and knees, hands under shoulders, knees under hips.",
        steps: [
          "Reach one arm forward and the opposite leg back in 1 second.",
          "Hold for 2 seconds.",
          "Bring them back in 2 seconds.",
          "Change sides each time."
        ],
        feel: "Stomach, lower back and buttocks.",
        pass: "Arm and leg reach level with your back and your hips stay square to the floor.",
        mistakes: [
          "Twisting the hips.",
          "Arching the lower back."
        ],
        easier: null,
        harder: null,
        tempo: {
          down: 2,
          hold: 2,
          up: 1
        },
        dose: {
          sets: 3,
          reps: [
            8,
            12
          ]
        },
        sides: 1,
        rest: 30,
        images: []
      },
      {
        id: "march_in_place",
        name: "March on the spot",
        pattern: "snack",
        position: "stand",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand tall.",
        steps: [
          "March, lifting each knee to hip height.",
          "Swing your arms."
        ],
        feel: "Front of the hips and the heart rate going up.",
        pass: "Each knee reaches hip height and you keep going for the whole time.",
        mistakes: [
          "Leaning back.",
          "Lifting the knees only a little."
        ],
        easier: null,
        harder: "high_knees",
        tempo: null,
        dose: {
          sets: 1,
          seconds: [
            60,
            90
          ]
        },
        sides: 1,
        rest: 0,
        images: []
      },
      {
        id: "high_knees",
        name: "Quick high knees",
        pattern: "snack",
        position: "stand",
        equipment: [],
        level: 2,
        balance: false,
        entry: false,
        gated: false,
        setup: "Stand tall.",
        steps: [
          "Run on the spot, bringing each knee to hip height.",
          "Land softly on the balls of your feet."
        ],
        feel: "Front of the hips and the heart rate going up.",
        pass: "Each knee reaches hip height and you keep going for the whole time.",
        mistakes: [
          "Leaning back.",
          "Landing hard."
        ],
        easier: "march_in_place",
        harder: null,
        tempo: null,
        dose: {
          sets: 2,
          seconds: [
            30,
            45
          ]
        },
        sides: 1,
        rest: 30,
        images: []
      },
      {
        id: "step_up",
        name: "Step up and down",
        pattern: "snack",
        position: "stand",
        equipment: [
          "step"
        ],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand facing a bottom stair or a sturdy step.",
        steps: [
          "Step up with one foot and stand tall on the step.",
          "Step down with the same foot.",
          "Change the leading foot every 10 steps."
        ],
        feel: "Front of the thighs and the heart rate going up.",
        pass: "You stand fully upright on the step each time and keep going for the whole time.",
        mistakes: [
          "Pushing off the back foot.",
          "Not standing tall at the top."
        ],
        easier: null,
        harder: null,
        tempo: null,
        dose: {
          sets: 2,
          seconds: [
            60,
            90
          ]
        },
        sides: 1,
        rest: 30,
        images: []
      },
      {
        id: "squat_reach",
        name: "Squat and reach up",
        pattern: "snack",
        position: "stand",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand with feet shoulder-width apart.",
        steps: [
          "Squat until your thighs are level with the floor in 2 seconds.",
          "Stand up and reach both arms straight overhead in 1 second."
        ],
        feel: "Thighs, buttocks and shoulders.",
        pass: "Thighs reach level with the floor and your arms finish straight beside your ears.",
        mistakes: [
          "Heels lifting.",
          "Half reach overhead."
        ],
        easier: null,
        harder: null,
        tempo: {
          down: 2,
          hold: 0,
          up: 1
        },
        dose: {
          sets: 2,
          reps: [
            10,
            15
          ]
        },
        sides: 1,
        rest: 30,
        images: []
      },
      {
        id: "shadow_boxing",
        name: "Shadow boxing",
        pattern: "snack",
        position: "stand",
        equipment: [],
        level: 1,
        balance: false,
        entry: true,
        gated: false,
        setup: "Stand with one foot half a step ahead, knees soft, fists by your chin.",
        steps: [
          "Punch straight ahead, one hand then the other.",
          "Turn your back heel with each punch.",
          "Bring each hand back to your chin."
        ],
        feel: "Shoulders, the middle of the body and the heart rate going up.",
        pass: "Each punch reaches a straight arm and the hand comes back to your chin before the next.",
        mistakes: [
          "Dropping the hands.",
          "Locking the elbow hard."
        ],
        easier: null,
        harder: null,
        tempo: null,
        dose: {
          sets: 2,
          seconds: [
            45,
            60
          ]
        },
        sides: 1,
        rest: 30,
        images: []
      }
    ]
  };

  // src/content.mjs
  var MOVEMENTS = movements_default.movements;
  var BY_ID = new Map(MOVEMENTS.map((m) => [m.id, m]));
  var movementOf = (id) => BY_ID.get(id) ?? null;
  var MAIN_PATTERNS = ["lower_push", "lower_pull", "upper_push", "upper_pull"];
  var WEEK_FLOOR_SETS = 4;
  var WEEK_TARGET_SETS = [8, 10];
  var MAX_NEW = 1;
  var SETUP_SECONDS = 30;
  var LOAD_STEP_KG = 1;
  var LOAD_MAX_KG = 12;
  var MAX_ITEMS = 5;
  var MIN_ITEMS = 3;
  var ROOT = /* @__PURE__ */ new Map();
  for (const m of MOVEMENTS) {
    let r = m;
    while (r.easier) r = BY_ID.get(r.easier);
    ROOT.set(m.id, r.id);
  }
  var chainOf = (id) => ROOT.get(id) ?? null;
  var CORE = ["dead_bug", "bird_dog", "kneeling_side_plank"];
  var SLOTS = {
    full: ["sit_to_stand", "wall_push_up", "backpack_row", "hip_hinge", "core"],
    lower: ["sit_to_stand", "hip_hinge", "wall_split_squat", "glute_bridge", "core"],
    upper: ["wall_push_up", "backpack_row", "backpack_press", "prone_arm_raise", "core"],
    full_lower: ["sit_to_stand", "hip_hinge", "wall_split_squat", "wall_push_up", "backpack_row"],
    full_upper: ["wall_push_up", "backpack_row", "backpack_press", "sit_to_stand", "core"]
  };
  var STAND_INS = {
    sit_to_stand: ["wall_split_squat", "calf_raise"],
    hip_hinge: ["glute_bridge"],
    glute_bridge: ["hip_hinge"],
    wall_split_squat: ["sit_to_stand", "calf_raise"],
    wall_push_up: ["backpack_press"],
    backpack_press: ["wall_push_up"],
    backpack_row: ["prone_arm_raise", "backpack_curl"],
    prone_arm_raise: ["backpack_row", "backpack_curl"]
  };
  function readHistory2(raw) {
    if (raw === void 0 || raw === null) return [];
    if (!Array.isArray(raw)) throw new InputError("bad_content");
    return raw.map((h) => {
      if (!h || typeof h.movementId !== "string" || !Array.isArray(h.sets) || !h.sets.every((n) => Number.isFinite(n) && n >= 0)) throw new InputError("bad_content");
      return { movementId: h.movementId, day: String(h.day ?? ""), sets: h.sets, load: Number.isFinite(h.load) ? h.load : null };
    }).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  }
  var owns = (rules, m) => m.equipment.every((e) => rules.equipment.includes(e) || ALWAYS_THERE.includes(e));
  var top = (m) => (m.dose.reps ?? m.dose.seconds)[1];
  function mastered(history, id) {
    const m = movementOf(id);
    const times = history.filter((h) => h.movementId === id).slice(-2);
    return times.length === 2 && times.every((t) => t.sets.length >= m.dose.sets && t.sets.every((n) => n >= top(m)));
  }
  var doneBefore = (history, id) => history.some((h) => h.movementId === id);
  function blockOf(rules, history, id) {
    const m = movementOf(id);
    if (!m) return "unknown_movement";
    if (!owns(rules, m)) return "equipment_not_owned";
    if (rules.avoid.includes(id)) return "avoided_movement";
    if (rules.movements[id] === "cannot") return "cannot_do";
    if (!earned(rules, history, m)) return "gated_movement";
    return null;
  }
  function earned(rules, history, m) {
    if (m.entry || rules.movements[m.id] === "can" || doneBefore(history, m.id)) return true;
    const before = m.easier && movementOf(m.easier);
    if (!before) return true;
    if (!owns(rules, before)) return earned(rules, history, before);
    return mastered(history, before.id) && fullyLoaded(history, before);
  }
  var fullyLoaded = (history, m) => !m.equipment.includes("backpack") || (lastLoad(history, m.id) ?? 0) >= LOAD_MAX_KG;
  var patternUsable = (rules, history, pattern) => MOVEMENTS.some((m) => m.pattern === pattern && blockOf(rules, history, m.id) === null);
  var isNew = (rules, history, m) => !m.entry && !doneBefore(history, m.id) && rules.movements[m.id] !== "can" && !(m.easier && !owns(rules, movementOf(m.easier)));
  function pickInChain(rules, history, root, allowNew) {
    let pick = null;
    for (let m = movementOf(root); m; m = m.harder ? movementOf(m.harder) : null) {
      const block = blockOf(rules, history, m.id);
      if (block === "equipment_not_owned") continue;
      if (block === "gated_movement") break;
      if (block) {
        if (block === "cannot_do") break;
        continue;
      }
      if (isNew(rules, history, m) && !allowNew) break;
      pick = m;
      if (isNew(rules, history, m)) break;
    }
    return pick;
  }
  var repSeconds = (m) => m.tempo ? m.tempo.down + m.tempo.hold + m.tempo.up : 3;
  var middle = ([lo, hi]) => (lo + hi) / 2;
  function itemSeconds(item) {
    const m = movementOf(item.movementId);
    const work = item.reps ? middle(item.reps) * repSeconds(m) : middle(item.seconds);
    return item.sets * work * m.sides + Math.max(0, item.sets - 1) * item.rest + SETUP_SECONDS;
  }
  var sessionMinutes = (items) => Math.ceil(items.reduce((sum, i) => sum + itemSeconds(i), 0) / 60);
  function lastLoad(history, id) {
    const times = history.filter((h) => h.movementId === id && h.load !== null);
    return times.length ? times[times.length - 1].load : null;
  }
  function itemFor(m, history, loads, sets) {
    const item = { movementId: m.id, sets, rest: m.rest, isNew: false };
    if (m.dose.reps) item.reps = [...m.dose.reps];
    else item.seconds = [...m.dose.seconds];
    if (m.equipment.includes("backpack")) {
      const set = Number.isFinite(loads[m.id]) ? loads[m.id] : null;
      const last = lastLoad(history, m.id);
      let load = set ?? last ?? m.load ?? 2;
      if (set === null && last !== null && mastered(history, m.id)) load += LOAD_STEP_KG;
      item.load = Math.min(LOAD_MAX_KG, Math.max(1, load));
    }
    return item;
  }
  function readSessionRequest(a) {
    if (!a || typeof a !== "object") throw new InputError("bad_content");
    const rules = readRules(a.rules ?? {});
    const focus = a.focus ?? "full";
    if (!FOCUS.includes(focus)) throw new InputError("bad_content");
    const minutes = Number.isInteger(a.minutes) ? a.minutes : rules.session.max;
    if (minutes < 5 || minutes > 120) throw new InputError("bad_content");
    const loads = a.loads && typeof a.loads === "object" && !Array.isArray(a.loads) ? a.loads : {};
    return {
      rules,
      focus,
      minutes,
      loads,
      history: readHistory2(a.history),
      turn: Number.isInteger(a.turn) ? a.turn : 0,
      easeOff: Number.isFinite(a.lastPain) && a.lastPain >= 4,
      deload: a.deload === true,
      sessionId: typeof a.sessionId === "string" ? a.sessionId : null
    };
  }
  function buildSession(req) {
    const { rules, history, focus, loads } = req;
    const slots = SLOTS[focus].map((s) => s === "core" ? CORE[req.turn % CORE.length] : s);
    const items = [];
    let newOnes = 0;
    const used = /* @__PURE__ */ new Set();
    for (const slot of slots) {
      let pick = null;
      for (const root of [slot, ...STAND_INS[slot] ?? []]) {
        if (used.has(root)) continue;
        pick = pickInChain(rules, history, root, newOnes < MAX_NEW);
        if (pick) {
          used.add(root);
          break;
        }
      }
      if (!pick || items.some((i) => i.movementId === pick.id)) continue;
      const fresh = isNew(rules, history, pick);
      if (fresh) newOnes += 1;
      let sets = pick.dose.sets;
      if (req.easeOff || req.deload) sets = Math.max(1, sets - 1);
      items.push({ ...itemFor(pick, history, loads, sets), isNew: fresh });
    }
    fitTime(items, req.minutes);
    return items;
  }
  function fitTime(items, minutes) {
    while (sessionMinutes(items) > minutes && items.length > MIN_ITEMS) items.pop();
    while (sessionMinutes(items) > minutes) {
      const longest = items.filter((i) => i.sets > 1).sort((a, b) => itemSeconds(b) - itemSeconds(a))[0];
      if (!longest) break;
      longest.sets -= 1;
    }
  }
  var contentOf = (req, items) => ({ sessionId: req.sessionId, focus: req.focus, minutes: sessionMinutes(items), items });
  function workoutContent(a) {
    const req = readSessionRequest(a);
    return { content: contentOf(req, buildSession(req)) };
  }
  var setsByPattern = (contents) => {
    const out = Object.fromEntries(MAIN_PATTERNS.map((p) => [p, 0]));
    for (const c of contents) for (const i of c.items) {
      const p = movementOf(i.movementId)?.pattern;
      if (p in out) out[p] += i.sets;
    }
    return out;
  };
  function weekContent(a) {
    if (!a || !Array.isArray(a.sessions)) throw new InputError("bad_content");
    const reqs = a.sessions.map((s, turn) => readSessionRequest({ ...a, ...s, turn }));
    const contents = reqs.map((r) => contentOf(r, buildSession(r)));
    for (const pattern of MAIN_PATTERNS) if (contents.length > 1 && setsByPattern(contents)[pattern] === 0) addItem(contents, reqs, pattern);
    for (const pattern of MAIN_PATTERNS) {
      let guard = 0;
      while (setsByPattern(contents)[pattern] < WEEK_FLOOR_SETS && guard++ < 8) {
        if (!addSet(contents, reqs, pattern)) break;
      }
    }
    const sets = setsByPattern(contents);
    const history = reqs[0]?.history ?? [];
    const none = MAIN_PATTERNS.filter((p) => contents.length > 0 && sets[p] === 0 && reqs[0] && !patternUsable(reqs[0].rules, history, p));
    const short = MAIN_PATTERNS.filter((p) => contents.length > 0 && sets[p] < WEEK_TARGET_SETS[0] && !none.includes(p));
    const notes = [];
    if (short.length) notes.push(`This week has ${short.map((p) => `${sets[p]} sets of ${PATTERN_WORDS[p]}`).join(", ")}, below the ${WEEK_TARGET_SETS[0]} to ${WEEK_TARGET_SETS[1]} aimed for.`);
    if (none.length) notes.push(`No movement for ${none.map((p) => PATTERN_WORDS[p]).join(" or ")} fits your equipment and the movements you left out.`);
    const note = notes.length ? notes.join(" ") : null;
    return { contents, setsByPattern: sets, target: WEEK_TARGET_SETS, note };
  }
  var patternOf = (item) => movementOf(item.movementId).pattern;
  var withSets = (items, item, sets) => items.map((x) => x === item ? { ...x, sets } : x);
  function addSet(contents, reqs, pattern) {
    const spots = contents.flatMap((c, k) => c.items.filter((i) => patternOf(i) === pattern && i.sets < 6).map((i) => ({ c, k, i })));
    const fits = spots.filter(({ c, k, i }) => sessionMinutes(withSets(c.items, i, i.sets + 1)) <= reqs[k].minutes).sort((x, y) => x.c.minutes - y.c.minutes)[0];
    if (fits) {
      fits.i.sets += 1;
      fits.c.minutes = sessionMinutes(fits.c.items);
      return true;
    }
    const sets = setsByPattern(contents);
    for (const { c, k, i } of spots) {
      const donor = c.items.filter((d) => d !== i && d.sets > 1 && (sets[patternOf(d)] ?? 0) - 1 >= (MAIN_PATTERNS.includes(patternOf(d)) ? WEEK_FLOOR_SETS : 0)).sort((a, b) => (sets[patternOf(b)] ?? 99) - (sets[patternOf(a)] ?? 99))[0];
      if (!donor) continue;
      const items = c.items.map((x) => x === i ? { ...x, sets: x.sets + 1 } : x === donor ? { ...x, sets: x.sets - 1 } : x);
      if (sessionMinutes(items) > reqs[k].minutes) continue;
      i.sets += 1;
      donor.sets -= 1;
      c.minutes = sessionMinutes(c.items);
      return true;
    }
    return false;
  }
  var PATTERN_ROOTS = {
    lower_push: ["sit_to_stand", "wall_split_squat", "calf_raise"],
    lower_pull: ["hip_hinge", "glute_bridge"],
    upper_push: ["wall_push_up", "backpack_press"],
    upper_pull: ["backpack_row", "prone_arm_raise", "backpack_curl"]
  };
  function addItem(contents, reqs, pattern) {
    const order = contents.map((c, k) => k).sort((x, y) => contents[x].minutes - contents[y].minutes);
    for (const k of order) {
      const c = contents[k];
      const req = reqs[k];
      const newOnes = c.items.filter((i) => i.isNew).length;
      const taken = new Set(c.items.map((i) => chainOf(i.movementId)));
      let pick = null;
      for (const root of PATTERN_ROOTS[pattern]) {
        if (taken.has(root)) continue;
        pick = pickInChain(req.rules, req.history, root, newOnes < MAX_NEW);
        if (pick) break;
      }
      if (!pick) continue;
      const sets = req.easeOff || req.deload ? Math.max(1, pick.dose.sets - 1) : pick.dose.sets;
      const item = { ...itemFor(pick, req.history, req.loads, sets), isNew: isNew(req.rules, req.history, pick) };
      const tries = [[...c.items, item]];
      const counts = setsByPattern(contents);
      const swaps = c.items.filter((i) => !MAIN_PATTERNS.includes(patternOf(i)) || counts[patternOf(i)] - i.sets >= WEEK_FLOOR_SETS).sort((a, b) => (counts[patternOf(b)] ?? 99) - (counts[patternOf(a)] ?? 99));
      for (const out of swaps) tries.push(c.items.map((i) => i === out ? item : i));
      for (const items of tries) {
        const fitted = items.map((i) => ({ ...i }));
        if (fitted.length > MAX_ITEMS) continue;
        if (sessionMinutes(fitted) > req.minutes) {
          for (const i of fitted.filter((x) => x.movementId !== item.movementId).sort((a, b) => b.sets - a.sets)) {
            while (i.sets > 1 && sessionMinutes(fitted) > req.minutes) i.sets -= 1;
          }
        }
        if (sessionMinutes(fitted) > req.minutes) continue;
        c.items = fitted;
        c.minutes = sessionMinutes(fitted);
        return true;
      }
    }
    return false;
  }
  var PATTERN_WORDS = { lower_push: "legs pushing", lower_pull: "hips and the back of the legs", upper_push: "upper-body pushing", upper_pull: "upper-body pulling", core: "the middle of the body", snack: "short pieces" };
  function checkContent(a) {
    if (!a || !a.content || !Array.isArray(a.content.items)) throw new InputError("bad_content");
    const rules = readRules(a.rules ?? {});
    const history = readHistory2(a.history);
    const minutes = Number.isInteger(a.minutes) ? a.minutes : rules.session.max;
    const violations = [];
    const add = (code, text, movementId) => violations.push(movementId ? { code, text, movementId } : { code, text });
    let fresh = 0;
    for (const item of a.content.items) {
      const m = movementOf(item.movementId);
      if (!m) {
        add("unknown_movement", `${item.movementId} is not in the movement library.`, item.movementId);
        continue;
      }
      if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > 6) add("bad_dose", `${m.name} needs between 1 and 6 sets.`, m.id);
      const block = blockOf(rules, history, m.id);
      if (block === "equipment_not_owned") add(block, `${m.name} needs ${m.equipment.join(" and ")}, which the person doesn't have.`, m.id);
      else if (block === "avoided_movement" || block === "cannot_do") add("avoided_movement", `${m.name} is on the person's list to leave out.`, m.id);
      else if (block === "gated_movement") add(block, `${m.name} comes only after ${movementOf(m.easier).name} is done at the top of its range twice${movementOf(m.easier).equipment.includes("backpack") ? `, with ${LOAD_MAX_KG} kg in the backpack` : ""}.`, m.id);
      if (isNew(rules, history, m)) fresh += 1;
    }
    if (fresh > MAX_NEW) add("too_many_new", `The session has ${fresh} movements the person hasn't done yet; at most ${MAX_NEW}.`);
    const valid = a.content.items.filter((i) => movementOf(i.movementId) && Number.isInteger(i.sets) && i.sets >= 1);
    const length = sessionMinutes(valid.map((i) => ({
      ...i,
      rest: Number.isFinite(i.rest) ? i.rest : movementOf(i.movementId).rest,
      reps: i.reps ?? movementOf(i.movementId).dose.reps,
      seconds: i.seconds ?? movementOf(i.movementId).dose.seconds
    })));
    if (length > minutes) add("session_too_long", `The session takes about ${length} minutes; the person's sessions are at most ${minutes}.`);
    if (Array.isArray(a.week)) {
      const sets = setsByPattern(a.week.filter((c) => c && Array.isArray(c.items)));
      for (const p of MAIN_PATTERNS) if (sets[p] < WEEK_FLOOR_SETS && patternUsable(rules, history, p)) add("sets_below_floor", `The week has ${sets[p]} sets of ${PATTERN_WORDS[p]}; at least ${WEEK_FLOOR_SETS}.`);
    }
    return { pass: violations.length === 0, violations };
  }
  var movementLibrary = () => ({ version: movements_default.version, movements: MOVEMENTS });

  // src/phone/entry.mjs
  var TEXT = {
    bad_json: "The request could not be read.",
    bad_request: "The request could not be read.",
    bad_datetime: "A time in the request is not an ISO 8601 time with an offset.",
    bad_date: "A day in the request is not written as YYYY-MM-DD.",
    bad_shoes: "The shoes need the day they were bought and their miles.",
    bad_memory: "Memory must be a table of rows.",
    bad_stopped: "The stopped usual times must be a list.",
    bad_context: "The context is missing.",
    bad_plan: "The plan has no list of sessions.",
    bad_action: "There is no session to explain.",
    bad_rules: "Your rules could not be read.",
    bad_day_kinds: "A day is marked as something other than home, out or rest.",
    bad_content: "The workout could not be read.",
    missing_history: "There is no workout history to plan from.",
    internal: "Something went wrong while working this out."
  };
  var fail = (code) => JSON.stringify({ ok: false, error: { code, text: TEXT[code] ?? TEXT.internal } });
  var tool = (fn) => (argsJson) => {
    let args;
    try {
      args = JSON.parse(argsJson);
    } catch {
      return fail("bad_json");
    }
    try {
      return JSON.stringify({ ok: true, ...fn(args) });
    } catch (e) {
      return fail(e && e.name === "InputError" && typeof e.code === "string" ? e.code : "internal");
    }
  };
  globalThis.recommendWeek = tool(recommendWeek);
  globalThis.planContext = tool(planContext);
  globalThis.checkPlan = tool(checkPlan);
  globalThis.explainAction = tool(explainAction);
  globalThis.checkWeek = tool(checkWeek);
  globalThis.planBrief = tool(planBrief);
  globalThis.workoutContent = tool(workoutContent);
  globalThis.weekContent = tool(weekContent);
  globalThis.checkContent = tool(checkContent);
  globalThis.movementLibrary = tool(movementLibrary);
})();
