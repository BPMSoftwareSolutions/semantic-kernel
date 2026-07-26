import type { ExecutionReceipt, ExecutionStep, StepTestimony } from "../contracts/execution.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";
import { SemanticCatalog } from "../catalog/semantic-catalog.js";
import { PortRegistry } from "../ports/port-registry.js";
import { completedReceipt, failedReceipt, normalize } from "../proof/receipt-projector.js";
import { resolveDecision } from "./decision-resolver.js";
import { executeIteration } from "./iteration-executor.js";
import { readPath, writePath } from "./path-accessor.js";
import { applyProjection } from "./projection-engine.js";

export class SemanticKernel {
  public constructor(public readonly catalog = new SemanticCatalog(), public readonly ports = new PortRegistry()) {}

  public resolve(decisionId: string, context: JsonValue): JsonValue { return resolveDecision(this.catalog.decision(decisionId), context); }
  public project(projectionId: string, context: JsonValue): JsonValue { return applyProjection(this.catalog.projection(projectionId), context); }
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
}
