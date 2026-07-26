import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { ProjectionDeclaration, ProjectionExpression } from "../contracts/projection.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import { evaluatePredicate } from "./predicate-evaluator.js";
import { readPath } from "./path-accessor.js";

export function applyProjection(declaration: ProjectionDeclaration, context: JsonValue): JsonValue {
  return evaluate(declaration.expression, context);
}

function evaluate(expression: ProjectionExpression, context: JsonValue): JsonValue {
  switch (expression.kind) {
    case "read": return readPath(context, expression.path) ?? null;
    case "constant": return expression.value;
    case "object": return Object.fromEntries(Object.entries(expression.fields).map(([key, value]) => [key, evaluate(value, context)]));
    case "array": return expression.items.map((item) => evaluate(item, context));
    case "coalesce": {
      for (const item of expression.expressions) {
        const value = evaluate(item, context);
        if (value !== null) return value;
      }
      return null;
    }
    case "conditional": return evaluate(evaluatePredicate(expression.when, context) ? expression.then : expression.otherwise, context);
    case "merge": {
      const values = expression.expressions.map((item) => evaluate(item, context));
      if (!values.every(isObject)) throw new SemanticKernelError("MERGE_REQUIRES_OBJECTS", "Projection merge accepts object values only.");
      return Object.assign({}, ...values);
    }
  }
}
function isObject(value: JsonValue): value is JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value); }
