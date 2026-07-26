import { createHash } from "node:crypto";
import type {
  CodeProjectionReceipt,
  CodeProjectorOutput,
  ProjectedCodeArtifactReceipt,
} from "../contracts/code-projection.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import type { CodeProjectorRegistry } from "./code-projector-registry.js";

export async function projectCode(
  registry: CodeProjectorRegistry,
  projectorId: string,
  authority: JsonValue,
  options: JsonObject = {},
): Promise<CodeProjectionReceipt> {
  const projector = registry.projector(projectorId);
  const authoritySnapshot = deepFreeze(structuredClone(authority));
  const optionsSnapshot = deepFreeze(structuredClone(options));
  const candidate = await projector.project(Object.freeze({
    authority: authoritySnapshot,
    options: optionsSnapshot,
  }));
  const output = requireOutput(candidate, projectorId);
  const artifacts = output.artifacts
    .map((artifact) => Object.freeze({
      ...artifact,
      sha256: sha256(artifact.content),
    }))
    .sort((left, right) => left.path.localeCompare(right.path)) as readonly ProjectedCodeArtifactReceipt[];

  return Object.freeze({
    receiptType: "code-projection-receipt.v1",
    projectorId,
    targetId: output.targetId,
    authoritySha256: sha256(canonicalJson(authoritySnapshot)),
    optionsSha256: sha256(canonicalJson(optionsSnapshot)),
    artifacts: Object.freeze(artifacts),
    metadata: deepFreeze(canonicalizeObject(output.metadata ?? {})),
  });
}

function requireOutput(candidate: unknown, projectorId: string): CodeProjectorOutput {
  if (!isRecord(candidate)) {
    throw invalidOutput(projectorId, "output must be an object");
  }
  if (typeof candidate.targetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(candidate.targetId)) {
    throw invalidOutput(projectorId, "targetId must be a portable identity");
  }
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
    throw invalidOutput(projectorId, "artifacts must be a non-empty array");
  }
  if (candidate.metadata !== undefined && !isJsonObject(candidate.metadata)) {
    throw invalidOutput(projectorId, "metadata must be a JSON object");
  }

  const paths = new Set<string>();
  const artifacts = candidate.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw invalidOutput(projectorId, `artifact ${index} must be an object`);
    if (typeof artifact.path !== "string" || !isSafeRelativeArtifactPath(artifact.path)) {
      throw invalidOutput(projectorId, `artifact ${index} path must be a safe relative path`);
    }
    if (paths.has(artifact.path)) throw invalidOutput(projectorId, `duplicate artifact path: ${artifact.path}`);
    paths.add(artifact.path);
    if (typeof artifact.content !== "string") {
      throw invalidOutput(projectorId, `artifact ${artifact.path} content must be a string`);
    }
    if (artifact.executable !== undefined && typeof artifact.executable !== "boolean") {
      throw invalidOutput(projectorId, `artifact ${artifact.path} executable must be Boolean`);
    }
    return Object.freeze({
      path: artifact.path,
      content: artifact.content,
      ...(artifact.executable === undefined ? {} : { executable: artifact.executable }),
    });
  });

  return Object.freeze({
    targetId: candidate.targetId,
    artifacts: Object.freeze(artifacts),
    ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
  });
}

function isSafeRelativeArtifactPath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) return false;
  const segments = value.split("/");
  return segments.every(isPortablePathSegment);
}

function isPortablePathSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[\u0000-\u001f<>:"|?*]/u.test(segment)
    && !/[. ]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment);
}

function invalidOutput(projectorId: string, reason: string): SemanticKernelError {
  return new SemanticKernelError(
    "INVALID_CODE_PROJECTION_OUTPUT",
    `Invalid output from code projector ${projectorId}: ${reason}.`,
    { projectorId, reason },
  );
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key] as JsonValue)]));
  }
  return value;
}

function canonicalizeObject(value: JsonObject): JsonObject {
  return canonicalize(value) as JsonObject;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T extends JsonValue>(value: T): T;
function deepFreeze<T extends JsonObject>(value: T): T;
function deepFreeze<T extends JsonValue | JsonObject>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isJsonObject(value: unknown, ancestors = new Set<object>()): value is JsonObject {
  return isRecord(value) && isJsonCollection(value, ancestors, Object.values(value));
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return isJsonCollection(value, ancestors, value);
  return isJsonObject(value, ancestors);
}

function isJsonCollection(collection: object, ancestors: Set<object>, values: readonly unknown[]): boolean {
  if (ancestors.has(collection)) return false;
  ancestors.add(collection);
  const valid = values.every((value) => isJsonValue(value, ancestors));
  ancestors.delete(collection);
  return valid;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
