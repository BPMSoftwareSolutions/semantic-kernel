import type { DecisionDeclaration } from "../contracts/decision.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { JsonValue } from "../types/json.type.js";
import { evaluatePredicate } from "./predicate-evaluator.js";

export function resolveDecision(declaration: DecisionDeclaration, context: JsonValue): JsonValue {
  const match = declaration.rules.find((rule) => evaluatePredicate(rule.when, context));
  if (match !== undefined) return match.then;
  if (declaration.noMatchDisposition === "return-null") return null;
  throw new SemanticKernelError("DECISION_NO_MATCH", `No rule matched decision: ${declaration.decisionId}`, { decisionId: declaration.decisionId });
}
