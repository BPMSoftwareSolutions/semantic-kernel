import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { ProjectionDeclaration, ProjectionExpression } from "../contracts/projection.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import { evaluatePredicate } from "./predicate-evaluator.js";
import { readPath, writePath } from "./path-accessor.js";

export function applyProjection(declaration: ProjectionDeclaration, context: JsonValue): JsonValue {
  return evaluate(declaration.expression, context);
}

function evaluate(expression: ProjectionExpression, context: JsonValue): JsonValue {
  switch (expression.kind) {
    case "read": {
      const value = readPath(context, expression.path);
      if (value === undefined && expression.required === true) {
        throw new SemanticKernelError("PROJECTION_REQUIRED_PATH_MISSING", `Required projection path is missing: ${expression.path}`, { path: expression.path });
      }
      return value ?? null;
    }
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
    case "filter": {
      const collection = requireArray(evaluate(expression.collection, context), "FILTER_REQUIRES_ARRAY");
      return collection.filter((item, index) => evaluatePredicate(expression.when, itemContext(context, expression.itemPath, item, index)));
    }
    case "map": {
      const collection = requireArray(evaluate(expression.collection, context), "MAP_REQUIRES_ARRAY");
      return collection.map((item, index) => evaluate(expression.expression, itemContext(context, expression.itemPath, item, index)));
    }
    case "count": return requireArray(evaluate(expression.expression, context), "COUNT_REQUIRES_ARRAY").length;
  }
}
function isObject(value: JsonValue): value is JsonObject { return value !== null && typeof value === "object" && !Array.isArray(value); }

function requireArray(value: JsonValue, code: string): JsonValue[] {
  if (!Array.isArray(value)) throw new SemanticKernelError(code, "Projection collection expression must produce an array.");
  return value;
}

function itemContext(context: JsonValue, path: string, item: JsonValue, index: number): JsonObject {
  const base: JsonObject = isObject(context) ? context : { value: context };
  return writePath(writePath(base, path, item), "$.iteration.index", index);
}
