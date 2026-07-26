import type { ExecutionModel, ExecutionReceipt, StepTestimony } from "../contracts/execution.contract.js";
import type { JsonValue } from "../types/json.type.js";

export function completedReceipt(model: ExecutionModel, startedAt: string, steps: readonly StepTestimony[], observations: readonly JsonValue[], result: JsonValue): ExecutionReceipt {
  return { receiptType: "semantic-kernel-execution-receipt.v1", runId: createRunId(), executionModelId: model.executionModelId, startedAt, completedAt: new Date().toISOString(), disposition: "EXECUTION_COMPLETED", result, observations, steps };
}
export function failedReceipt(model: ExecutionModel, startedAt: string, steps: readonly StepTestimony[], observations: readonly JsonValue[], stepId: string, error: unknown): ExecutionReceipt {
  const failure = normalize(error);
  return { receiptType: "semantic-kernel-execution-receipt.v1", runId: createRunId(), executionModelId: model.executionModelId, startedAt, completedAt: new Date().toISOString(), disposition: "EXECUTION_FAILED", observations, steps, failure: { stepId, ...failure } };
}
export function normalize(error: unknown): { name: string; message: string } { return error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownFailure", message: String(error) }; }

function createRunId(): string { return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
