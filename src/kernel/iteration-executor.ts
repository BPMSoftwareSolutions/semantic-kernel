import type { IterationDeclaration } from "../contracts/iteration.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { ProjectionDeclaration } from "../contracts/projection.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import { readPath, writePath } from "./path-accessor.js";
import { applyProjection } from "./projection-engine.js";

export function executeIteration(declaration: IterationDeclaration, projection: ProjectionDeclaration, context: JsonValue): JsonValue[] {
  const collection = readPath(context, declaration.collectionPath);
  if (!Array.isArray(collection)) throw new SemanticKernelError("ITERATION_COLLECTION_NOT_ARRAY", `Iteration collection is not an array: ${declaration.collectionPath}`);
  const ordered = declaration.order === "reverse" ? [...collection].reverse() : collection;
  return ordered.map((item, index) => applyProjection(projection, itemContext(context, declaration.itemContextPath, item, index)));
}

function itemContext(context: JsonValue, path: string, item: JsonValue, index: number): JsonObject {
  const base: JsonObject = context !== null && typeof context === "object" && !Array.isArray(context) ? context : { value: context };
  return writePath(writePath(base, path, item), "$.iteration.index", index);
}
