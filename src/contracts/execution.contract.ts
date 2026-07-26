import type { JsonValue } from "../types/json.type.js";

export type ExecutionStep =
  | { readonly stepId: string; readonly operation: "resolve-decision"; readonly decisionId: string; readonly inputPath: string; readonly outputPath: string }
  | { readonly stepId: string; readonly operation: "apply-projection"; readonly projectionId: string; readonly inputPath: string; readonly outputPath: string }
  | { readonly stepId: string; readonly operation: "execute-iteration"; readonly iterationId: string; readonly inputPath: string; readonly outputPath: string }
  | { readonly stepId: string; readonly operation: "invoke-port"; readonly portId: string; readonly inputProjectionId?: string; readonly inputPath: string; readonly outputPath: string }
  | { readonly stepId: string; readonly operation: "record-observation"; readonly observationType: string; readonly valuePath: string; readonly outputPath: string };

export interface ExecutionModel {
  readonly declarationType: "execution-model.v1";
  readonly executionModelId: string;
  readonly steps: readonly ExecutionStep[];
  readonly resultPath: string;
}

export interface StepTestimony {
  readonly stepId: string;
  readonly operation: ExecutionStep["operation"];
  readonly disposition: "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly output?: JsonValue;
  readonly failure?: { readonly name: string; readonly message: string };
}

export interface ExecutionReceipt {
  readonly receiptType: "semantic-kernel-execution-receipt.v1";
  readonly runId: string;
  readonly executionModelId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly disposition: "EXECUTION_COMPLETED" | "EXECUTION_FAILED";
  readonly result?: JsonValue;
  readonly observations: readonly JsonValue[];
  readonly steps: readonly StepTestimony[];
  readonly failure?: { readonly stepId: string; readonly name: string; readonly message: string };
}
