// Python's number behaviour, so the same inputs give the same plan: round half to even, sum() with its
// compensated float addition (Python 3.12+), and statistics.mean / median, which are exact.

/** round(x, n): the exact decimal value of the double, rounded half to even. */
export function pyRound(x, n = 0) {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
  const [int, frac] = Math.abs(x).toFixed(100).split('.');
  const keep = frac.slice(0, n);
  const rest = frac.slice(n);
  let digits = BigInt(int + keep);
  const half = `5${'0'.repeat(rest.length - 1)}`;
  if (rest > half || (rest === half && digits % 2n === 1n)) digits += 1n;
  const s = digits.toString().padStart(n + 1, '0');
  const out = Number(n ? `${s.slice(0, s.length - n)}.${s.slice(s.length - n)}` : s);
  return x < 0 ? -out : out;
}

/** sum() of floats: Neumaier summation, as CPython does it. */
export function pySum(values) {
  let total = 0;
  let c = 0;
  for (const x of values) {
    const t = total + x;
    c += Math.abs(total) >= Math.abs(x) ? (total - t) + x : (x - t) + total;
    total = t;
  }
  return c && Number.isFinite(c) ? total + c : total;
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
// A finite double as mantissa * 2^exp with a whole-number mantissa.
function parts(x) {
  f64[0] = x;
  const bits = u64[0];
  const e = Number((bits >> 52n) & 0x7ffn);
  const m = bits & 0xfffffffffffffn;
  const mant = e === 0 ? m : m | (1n << 52n);
  return { mant: bits >> 63n ? -mant : mant, exp: (e === 0 ? 1 : e) - 1075 };
}
function scale(x, e) {
  for (; e > 0; e -= 1) x *= 2;
  for (; e < 0; e += 1) x *= 0.5;
  return x;
}

/** statistics.mean: the exact sum divided by the count, rounded once to a double. */
export function pyMean(values) {
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

/** statistics.median. */
export function pyMedian(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** str() of a Python float: whole numbers keep '.0'. */
export const pyFloat = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
