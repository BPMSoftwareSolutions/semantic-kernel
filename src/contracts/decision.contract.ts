import type { JsonValue } from "../types/json.type.js";
import type { Predicate } from "./predicate.contract.js";

export interface DecisionRule {
  readonly ruleId: string;
  readonly when: Predicate;
  readonly then: JsonValue;
}

export interface DecisionDeclaration {
  readonly declarationType: "decision.v1";
  readonly decisionId: string;
  readonly rules: readonly DecisionRule[];
  readonly noMatchDisposition: "reject" | "return-null";
}
