import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";

const ROOT = "$";

export function readPath(root: JsonValue, path: string): JsonValue | undefined {
  if (path === ROOT || path === "") return root;
  const segments = normalize(path);
  let current: JsonValue | undefined = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (isObject(current)) {
      current = current[segment];
    } else return undefined;
  }
  return current;
}

export function writePath(root: JsonObject, path: string, value: JsonValue): JsonObject {
  const segments = normalize(path);
  if (segments.length === 0) {
    if (!isObject(value)) throw new SemanticKernelError("ROOT_WRITE_REQUIRES_OBJECT", "Root execution context must remain an object.");
    return value;
  }
  const clone = structuredClone(root) as Record<string, JsonValue>;
  let cursor: Record<string, JsonValue> = clone;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (last) { cursor[segment] = value; return; }
    const existing = cursor[segment];
    const next = isObject(existing) ? structuredClone(existing) as Record<string, JsonValue> : {};
    cursor[segment] = next;
    cursor = next;
  });
  return clone;
}

function normalize(path: string): string[] {
  const trimmed = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  if (trimmed === "") return [];
  return trimmed.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
