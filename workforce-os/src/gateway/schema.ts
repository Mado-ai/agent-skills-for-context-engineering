/**
 * A deliberately small JSON Schema subset validator.
 *
 * Tool input/output schemas live in the database, not in code, so that the
 * governance record and the thing actually enforced are the same object. That
 * rules out compiling zod schemas from TypeScript, and pulling in a full JSON
 * Schema engine would be more surface than the subset we author needs.
 *
 * Supported: type (object/array/string/number/integer/boolean/null), required,
 * properties, items, enum, minLength, minimum, maximum, additionalProperties.
 * Anything else in a schema is ignored rather than silently treated as a pass.
 */

export interface SchemaViolation {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === expected;
}

export function validateAgainstSchema(
  value: unknown,
  schema: Schema | undefined,
  path = '$',
): SchemaViolation[] {
  if (!schema || Object.keys(schema).length === 0) return [];
  const violations: SchemaViolation[] = [];

  const expectedType = schema.type as string | string[] | undefined;
  if (expectedType) {
    const types = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!types.some((t) => matchesType(value, t))) {
      violations.push({ path, message: `expected ${types.join(' or ')}, got ${typeOf(value)}` });
      return violations; // Further checks would be noise once the type is wrong.
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    violations.push({ path, message: `value must be one of ${JSON.stringify(schema.enum)}` });
  }

  if (typeof value === 'string') {
    const minLength = schema.minLength as number | undefined;
    if (typeof minLength === 'number' && value.length < minLength) {
      violations.push({ path, message: `string shorter than minLength ${minLength}` });
    }
  }

  if (typeof value === 'number') {
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (typeof min === 'number' && value < min) {
      violations.push({ path, message: `value below minimum ${min}` });
    }
    if (typeof max === 'number' && value > max) {
      violations.push({ path, message: `value above maximum ${max}` });
    }
  }

  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;

    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (obj[key] === undefined) {
        violations.push({ path: `${path}.${key}`, message: 'required property is missing' });
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      if (obj[key] !== undefined) {
        violations.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          violations.push({ path: `${path}.${key}`, message: 'additional property is not permitted' });
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema.minItems as number | undefined;
    if (typeof minItems === 'number' && value.length < minItems) {
      violations.push({ path, message: `array shorter than minItems ${minItems}` });
    }
    const itemSchema = schema.items as Schema | undefined;
    if (itemSchema) {
      value.forEach((item, i) => {
        violations.push(...validateAgainstSchema(item, itemSchema, `${path}[${i}]`));
      });
    }
  }

  return violations;
}

/** Resolve a dotted path such as `report.sections` against an object. */
export function resolvePath(value: unknown, path: string): unknown {
  if (path === '' || path === '$') return value;
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
