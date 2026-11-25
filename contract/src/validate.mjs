// A small JSON Schema checker with no dependencies: the part of draft 2020-12 the contract schemas use.
// Keywords: type, const, enum, properties, required, additionalProperties, items, minItems, maxItems,
// dependentRequired, pattern, minLength, maxLength, minimum, maximum, exclusiveMinimum, oneOf, $ref (to another contract schema by file name).
// It is plain ECMAScript, so the phone bundles and every engine's tests can import it.
import { SCHEMAS } from './schemas.mjs';

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => { const a = typeOf(v); return a === t || (t === 'number' && a === 'integer'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s; };

// The variant of a oneOf that a `kind` picks, when every variant names its kind with a const.
function byKind(variants, value) {
  if (typeOf(value) !== 'object' || !variants.every((s) => s.properties?.kind && 'const' in s.properties.kind)) return undefined;
  return variants.find((s) => same(s.properties.kind.const, value.kind)) ?? null;
}

function check(schema, value, path, errors, schemas) {
  const fail = (message) => { errors.push({ path: path || '(root)', message }); };
  if (schema.$ref !== undefined) {
    const target = schemas[schema.$ref.replace(/\.schema\.json$/, '')];
    if (!target) return fail(`unknown schema ${schema.$ref}`);
    return check(target, value, path, errors, schemas);
  }
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return fail(`must be ${types.join(' or ')}, got ${show(value)}`);
  }
  if ('const' in schema && !same(schema.const, value)) fail(`must be ${show(schema.const)}, got ${show(value)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) fail(`must be one of ${schema.enum.join(', ')}, got ${show(value)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must have at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`${show(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}, got ${value}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}, got ${value}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must be more than ${schema.exclusiveMinimum}, got ${value}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors, schemas));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties ?? {};
    for (const name of schema.required ?? []) if (!Object.hasOwn(value, name)) errors.push({ path: `${path}${path ? '.' : ''}${name}`, message: 'is missing' });
    for (const [name, needs] of Object.entries(schema.dependentRequired ?? {})) if (Object.hasOwn(value, name)) for (const n of needs) if (!Object.hasOwn(value, n)) errors.push({ path: `${path}${path ? '.' : ''}${n}`, message: `is missing, and ${name} needs it` });
    for (const [name, v] of Object.entries(value)) {
      const at = `${path}${path ? '.' : ''}${name}`;
      if (Object.hasOwn(props, name)) check(props[name], v, at, errors, schemas);
      else if (schema.additionalProperties === false) errors.push({ path: at, message: 'is not a field of this value' });
      else if (typeOf(schema.additionalProperties) === 'object') check(schema.additionalProperties, v, at, errors, schemas);
    }
  }
  if (schema.oneOf) {
    const picked = byKind(schema.oneOf, value);
    if (picked) check(picked, value, path, errors, schemas);
    else if (picked === null) fail(`kind ${show(value.kind)} is not one of ${schema.oneOf.map((s) => s.properties.kind.const).join(', ')}`);
    else {
      const passing = schema.oneOf.filter((s) => { const e = []; check(s, value, path, e, schemas); return e.length === 0; }).length;
      if (passing !== 1) fail(`must match exactly one of ${schema.oneOf.length} shapes, matched ${passing}`);
    }
  }
  return undefined;
}

/** Checks `value` against a schema object. -> { ok, errors: [{ path, message }] } */
export function validate(schema, value, schemas = SCHEMAS) {
  const errors = [];
  check(schema, value, '', errors, schemas);
  return { ok: errors.length === 0, errors };
}

/** Checks `value` against a contract schema by name: 'session', 'memory-row', 'calendar-result', ... */
export function validateAs(name, value) {
  if (!Object.hasOwn(SCHEMAS, name)) return { ok: false, errors: [{ path: '(root)', message: `unknown schema ${name}` }] };
  return validate(SCHEMAS[name], value);
}

/** The errors as one line each: "day: is missing". */
export const explain = (result) => result.errors.map((e) => `${e.path}: ${e.message}`);

/** Throws an Error that names the schema and every problem when `value` does not fit. Returns the value. */
export function assertValid(name, value, what = name) {
  const r = validateAs(name, value);
  if (!r.ok) throw Object.assign(new Error(`${what} does not fit ${name}.schema.json: ${explain(r).join('; ')}`), { name: 'ContractError', errors: r.errors });
  return value;
}
