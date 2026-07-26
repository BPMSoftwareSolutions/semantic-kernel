import type { ExecutionReceipt, ExecutionStep, StepTestimony } from "../contracts/execution.contract.js";
import type { CodeProjectionReceipt, CodeProjector } from "../contracts/code-projection.contract.js";
import type { DecisionDeclaration } from "../contracts/decision.contract.js";
import type { IterationDeclaration } from "../contracts/iteration.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { ProjectionDeclaration } from "../contracts/projection.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import { SemanticCatalog } from "../catalog/semantic-catalog.js";
import { PortRegistry } from "../ports/port-registry.js";
import { completedReceipt, failedReceipt, normalize } from "../proof/receipt-projector.js";
import { resolveDecision } from "./decision-resolver.js";
import { executeIteration } from "./iteration-executor.js";
import { readPath, writePath } from "./path-accessor.js";
import { applyProjection } from "./projection-engine.js";
import { CodeProjectorRegistry } from "../projection/code-projector-registry.js";
import { projectCode as executeCodeProjection } from "../projection/project-code.js";

export type SemanticInvocation = (context: unknown) => unknown | Promise<unknown>;

export type SemanticEdges = Readonly<{
  invokes<TResult = unknown>(semanticIdentity: string, context: unknown): Promise<TResult>;
  projects<TResult = unknown>(projectionIdentity: string, context: unknown): TResult;
  projectsCode(projectorIdentity: string, authority: unknown, options?: unknown): Promise<CodeProjectionReceipt>;
}>;

export type CapabilityPack = Readonly<{
  decisions?: readonly DecisionDeclaration[];
  projections?: readonly ProjectionDeclaration[];
  iterations?: readonly IterationDeclaration[];
  executions?: readonly import("../contracts/execution.contract.js").ExecutionModel[];
  invocations?: Readonly<Record<string, SemanticInvocation>>;
  codeProjectors?: readonly CodeProjector[];
}>;

export class SemanticKernel {
  readonly #invocations = new Map<string, SemanticInvocation>();
  public readonly edges: SemanticEdges;

  public constructor(
    public readonly catalog = new SemanticCatalog(),
    public readonly ports = new PortRegistry(),
    public readonly codeProjectors = new CodeProjectorRegistry(),
  ) {
    this.edges = Object.freeze({
      invokes: async <TResult = unknown>(semanticIdentity: string, context: unknown): Promise<TResult> =>
        this.#invoke(semanticIdentity, context) as Promise<TResult>,
      projects: <TResult = unknown>(projectionIdentity: string, context: unknown): TResult =>
        this.project(projectionIdentity, requireJsonValue(context)) as TResult,
      projectsCode: async (projectorIdentity: string, authority: unknown, options?: unknown): Promise<CodeProjectionReceipt> =>
        this.projectCode(projectorIdentity, authority, options),
    });
  }

  public registerCapabilityPacks(packs: readonly unknown[]): void {
    for (const candidate of packs) {
      const pack = requireCapabilityPack(candidate);
      for (const declaration of pack.decisions ?? []) this.catalog.registerDecision(declaration);
      for (const declaration of pack.projections ?? []) this.catalog.registerProjection(declaration);
      for (const declaration of pack.iterations ?? []) this.catalog.registerIteration(declaration);
      for (const declaration of pack.executions ?? []) this.catalog.registerExecution(declaration);
      for (const [identity, invocation] of Object.entries(pack.invocations ?? {})) {
        if (this.#invocations.has(identity)) {
          throw new SemanticKernelError("DUPLICATE_INVOCATION", `Invocation already registered: ${identity}`, { identity });
        }
        this.#invocations.set(identity, invocation);
      }
      for (const projector of pack.codeProjectors ?? []) this.codeProjectors.register(projector);
    }
  }

  public seatPortAdapters(adapters: Readonly<Record<string, unknown>>): void {
    for (const [portId, candidate] of Object.entries(adapters)) {
      if (typeof candidate !== "function") {
        throw new SemanticKernelError("INVALID_PORT_ADAPTER", `Port adapter must be a function: ${portId}`, { portId });
      }
      this.ports.register(portId, async (input) => requireJsonValue(await candidate(input)));
    }
  }

  public resolve(decisionId: string, context: JsonValue): JsonValue { return resolveDecision(this.catalog.decision(decisionId), context); }
  public project(projectionId: string, context: JsonValue): JsonValue { return applyProjection(this.catalog.projection(projectionId), context); }
  public async projectCode(
    projectorId: string,
    authority: unknown,
    options?: unknown,
  ): Promise<CodeProjectionReceipt> {
    return executeCodeProjection(
      this.codeProjectors,
      projectorId,
      requireJsonValue(authority),
      requireJsonObjectOption(options),
    );
  }
  public iterate(iterationId: string, context: JsonValue): JsonValue[] {
    const declaration = this.catalog.iteration(iterationId);
    return executeIteration(declaration, this.catalog.projection(declaration.projectionId), context);
  }

  public async execute(executionModelId: string, input: JsonObject): Promise<ExecutionReceipt> {
    const model = this.catalog.execution(executionModelId);
    const startedAt = new Date().toISOString();
    const testimonies: StepTestimony[] = [];
    const observations: JsonValue[] = [];
    let context: JsonObject = structuredClone(input);
    for (const step of model.steps) {
      const stepStartedAt = new Date().toISOString();
      try {
        const output = await this.#executeStep(step, context, observations);
        context = writePath(context, step.outputPath, output);
        testimonies.push({ stepId: step.stepId, operation: step.operation, disposition: "completed", startedAt: stepStartedAt, completedAt: new Date().toISOString(), output });
      } catch (error) {
        testimonies.push({ stepId: step.stepId, operation: step.operation, disposition: "failed", startedAt: stepStartedAt, completedAt: new Date().toISOString(), failure: normalize(error) });
        return failedReceipt(model, startedAt, testimonies, observations, step.stepId, error);
      }
    }
    return completedReceipt(model, startedAt, testimonies, observations, readPath(context, model.resultPath) ?? null);
  }

  async #executeStep(step: ExecutionStep, context: JsonObject, observations: JsonValue[]): Promise<JsonValue> {
    switch (step.operation) {
      case "resolve-decision": return this.resolve(step.decisionId, readPath(context, step.inputPath) ?? null);
      case "apply-projection": return this.project(step.projectionId, readPath(context, step.inputPath) ?? null);
      case "execute-iteration": return this.iterate(step.iterationId, readPath(context, step.inputPath) ?? null);
      case "invoke-port": {
        const input = readPath(context, step.inputPath) ?? null;
        const portInput = step.inputProjectionId === undefined ? input : this.project(step.inputProjectionId, input);
        return this.ports.invoke(step.portId, portInput);
      }
      case "record-observation": {
        const observation = { observationType: step.observationType, value: readPath(context, step.valuePath) ?? null };
        observations.push(observation); return observation;
      }
    }
  }

  async #invoke(identity: string, context: unknown): Promise<unknown> {
    const invocation = this.#invocations.get(identity);
    if (invocation !== undefined) return invocation(context);
    if (this.catalog.hasDecision(identity)) return this.resolve(identity, requireJsonValue(context));
    if (this.catalog.hasExecution(identity)) {
      const receipt = await this.execute(identity, requireJsonObject(requireJsonValue(context)));
      if (receipt.disposition === "EXECUTION_FAILED") {
        throw new SemanticKernelError("EXECUTION_FAILED", `Execution failed: ${identity}`, receipt.failure);
      }
      return receipt.result ?? null;
    }
    throw new SemanticKernelError("DECLARATION_NOT_FOUND", `Invocable semantic identity not found: ${identity}`, { identity });
  }
}

export type SemanticKernelOptions = Readonly<{
  codeProjectors?: readonly CodeProjector[];
}>;

export function createSemanticKernel(options: SemanticKernelOptions = {}): SemanticKernel {
  const kernel = new SemanticKernel();
  for (const projector of options.codeProjectors ?? []) kernel.codeProjectors.register(projector);
  return kernel;
}

function requireCapabilityPack(candidate: unknown): CapabilityPack {
  if (!isRecord(candidate)) throw new SemanticKernelError("INVALID_CAPABILITY_PACK", "Capability pack must be an object.");
  for (const key of ["decisions", "projections", "iterations", "executions", "codeProjectors"] as const) {
    const value = candidate[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new SemanticKernelError("INVALID_CAPABILITY_PACK", `Capability pack ${key} must be an array.`, { key });
    }
  }
  const invocations = candidate.invocations;
  if (invocations !== undefined) {
    if (!isRecord(invocations) || Object.values(invocations).some((value) => typeof value !== "function")) {
      throw new SemanticKernelError("INVALID_CAPABILITY_PACK", "Capability pack invocations must be a function record.");
    }
  }
  return candidate as CapabilityPack;
}

function requireJsonObject(value: JsonValue): JsonObject {
  if (!isRecord(value)) throw new SemanticKernelError("EXECUTION_CONTEXT_NOT_OBJECT", "Execution context must be a JSON object.");
  return value as JsonObject;
}

function requireJsonObjectOption(value: unknown): JsonObject {
  if (value === undefined) return {};
  return requireJsonObject(requireJsonValue(value));
}

function requireJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new SemanticKernelError("NON_JSON_VALUE", "Semantic execution values must be JSON-compatible.");
  return value;
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return isJsonCollection(value, ancestors, value);
  return isRecord(value) && isJsonCollection(value, ancestors, Object.values(value));
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
