"""Minimal JSON Schema subset validator.

Written rather than pulled in because the runtime core carries no third-party
dependencies (ADR-0001), and because the subset actually needed here is small:
type, required, properties, enum, numeric bounds, string length/pattern, array
items and bounds, additionalProperties.

This is deliberately **not** a complete JSON Schema implementation — no $ref, no
allOf/anyOf/oneOf, no format assertions. Unsupported keywords are ignored rather
than silently treated as satisfied-by-default in a way that would matter: the
supported keywords are the ones the gateway and quality gates rely on, and a
contract using anything else fails contract validation instead.

Used in two security-relevant places, so it fails closed: model-generated tool
arguments are validated here before a tool ever sees them, and agent output is
validated here before it can pass the schema quality gate.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = ["validate", "SchemaError"]

_TYPES: dict[str, type | tuple[type, ...]] = {
    "object": dict,
    "array": (list, tuple),
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
    "null": type(None),
}


class SchemaError(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


def validate(instance: Any, schema: dict[str, Any], *, path: str = "$") -> list[str]:
    """Return a list of human-readable errors. Empty means valid.

    Returns rather than raises so callers can report every problem at once —
    handing a model one error at a time turns a single rework into several.
    """
    errors: list[str] = []
    if not schema:
        return errors

    expected = schema.get("type")
    if expected:
        types = expected if isinstance(expected, list) else [expected]
        if not any(_is_type(instance, t) for t in types):
            errors.append(f"{path}: expected type {expected}, got {type(instance).__name__}")
            # Type is wrong, so every keyword below would produce noise.
            return errors

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} is not one of {schema['enum']}")
    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: expected constant {schema['const']!r}")

    if isinstance(instance, dict):
        errors += _object_errors(instance, schema, path)
    elif isinstance(instance, (list, tuple)):
        errors += _array_errors(instance, schema, path)
    elif isinstance(instance, str):
        errors += _string_errors(instance, schema, path)
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        errors += _number_errors(instance, schema, path)
    return errors


def _is_type(instance: Any, expected: str) -> bool:
    py = _TYPES.get(expected)
    if py is None:
        return True  # unknown type keyword: do not fail on it
    # bool is a subclass of int in Python; JSON treats them as distinct, and
    # accepting True where an integer is required has bitten every hand-rolled
    # validator that skipped this check.
    if expected in ("number", "integer") and isinstance(instance, bool):
        return False
    return isinstance(instance, py)


def _object_errors(instance: dict, schema: dict, path: str) -> list[str]:
    errors: list[str] = []
    for key in schema.get("required", []):
        if key not in instance:
            errors.append(f"{path}: missing required property '{key}'")
    props = schema.get("properties", {})
    for key, subschema in props.items():
        if key in instance:
            errors += validate(instance[key], subschema, path=f"{path}.{key}")
    if schema.get("additionalProperties") is False:
        extra = set(instance) - set(props)
        if extra:
            errors.append(f"{path}: unexpected properties {sorted(extra)}")
    if "minProperties" in schema and len(instance) < schema["minProperties"]:
        errors.append(f"{path}: needs at least {schema['minProperties']} properties")
    return errors


def _array_errors(instance, schema: dict, path: str) -> list[str]:
    errors: list[str] = []
    item_schema = schema.get("items")
    if isinstance(item_schema, dict):
        for i, item in enumerate(instance):
            errors += validate(item, item_schema, path=f"{path}[{i}]")
    if "minItems" in schema and len(instance) < schema["minItems"]:
        errors.append(f"{path}: needs at least {schema['minItems']} items, got {len(instance)}")
    if "maxItems" in schema and len(instance) > schema["maxItems"]:
        errors.append(f"{path}: allows at most {schema['maxItems']} items, got {len(instance)}")
    if schema.get("uniqueItems"):
        try:
            if len(set(map(repr, instance))) != len(instance):
                errors.append(f"{path}: items must be unique")
        except TypeError:
            pass
    return errors


def _string_errors(instance: str, schema: dict, path: str) -> list[str]:
    errors: list[str] = []
    if "minLength" in schema and len(instance) < schema["minLength"]:
        errors.append(f"{path}: shorter than minLength {schema['minLength']}")
    if "maxLength" in schema and len(instance) > schema["maxLength"]:
        errors.append(f"{path}: longer than maxLength {schema['maxLength']}")
    pattern = schema.get("pattern")
    if pattern:
        try:
            if not re.search(pattern, instance):
                errors.append(f"{path}: does not match pattern {pattern!r}")
        except re.error:
            errors.append(f"{path}: schema has an invalid regex pattern {pattern!r}")
    return errors


def _number_errors(instance: float, schema: dict, path: str) -> list[str]:
    errors: list[str] = []
    if "minimum" in schema and instance < schema["minimum"]:
        errors.append(f"{path}: {instance} is below minimum {schema['minimum']}")
    if "maximum" in schema and instance > schema["maximum"]:
        errors.append(f"{path}: {instance} exceeds maximum {schema['maximum']}")
    if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
        errors.append(f"{path}: {instance} must exceed {schema['exclusiveMinimum']}")
    if "exclusiveMaximum" in schema and instance >= schema["exclusiveMaximum"]:
        errors.append(f"{path}: {instance} must be below {schema['exclusiveMaximum']}")
    return errors
