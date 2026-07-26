import type { Operand, Predicate } from "../contracts/predicate.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { JsonValue } from "../types/json.type.js";
import { readPath } from "./path-accessor.js";

export function evaluatePredicate(predicate: Predicate, context: JsonValue): boolean {
  switch (predicate.operator) {
    case "always": return true;
    case "equals": return deepEqual(resolve(predicate.left, context), resolve(predicate.right, context));
    case "not-equals": return !deepEqual(resolve(predicate.left, context), resolve(predicate.right, context));
    case "exists": return resolve(predicate.operand, context) !== undefined;
    case "absent": return resolve(predicate.operand, context) === undefined;
    case "truthy": return Boolean(resolve(predicate.operand, context));
    case "falsy": return !Boolean(resolve(predicate.operand, context));
    case "contains": return contains(resolve(predicate.left, context), resolve(predicate.right, context));
    case "greater-than": return compare(resolve(predicate.left, context), resolve(predicate.right, context)) > 0;
    case "greater-than-or-equal": return compare(resolve(predicate.left, context), resolve(predicate.right, context)) >= 0;
    case "less-than": return compare(resolve(predicate.left, context), resolve(predicate.right, context)) < 0;
    case "less-than-or-equal": return compare(resolve(predicate.left, context), resolve(predicate.right, context)) <= 0;
    case "matches-pattern": {
      const value = resolve(predicate.operand, context);
      return typeof value === "string" && new RegExp(predicate.pattern, predicate.flags).test(value);
    }
    case "all": return predicate.predicates.every((item) => evaluatePredicate(item, context));
    case "any": return predicate.predicates.some((item) => evaluatePredicate(item, context));
    case "not": return !evaluatePredicate(predicate.predicate, context);
  }
}

function resolve(operand: Operand, context: JsonValue): JsonValue | undefined {
  return operand.kind === "path" ? readPath(context, operand.path) : operand.value;
}
function deepEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function compare(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (typeof left !== "number" || typeof right !== "number") throw new SemanticKernelError("NON_NUMERIC_COMPARISON", "Numeric predicate operands must both be numbers.", { left, right });
  return left - right;
}
function contains(container: JsonValue | undefined, candidate: JsonValue | undefined): boolean {
  if (typeof container === "string" && typeof candidate === "string") return container.includes(candidate);
  if (Array.isArray(container)) return container.some((item) => deepEqual(item, candidate));
  return false;
}
