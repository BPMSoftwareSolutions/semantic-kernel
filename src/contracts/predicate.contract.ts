import type { JsonValue } from "../types/json.type.js";

export type Operand =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "value"; readonly value: JsonValue };

export type Predicate =
  | { readonly operator: "always" }
  | { readonly operator: "equals" | "not-equals" | "greater-than" | "greater-than-or-equal" | "less-than" | "less-than-or-equal" | "contains"; readonly left: Operand; readonly right: Operand }
  | { readonly operator: "exists" | "absent" | "truthy" | "falsy"; readonly operand: Operand }
  | { readonly operator: "matches-pattern"; readonly operand: Operand; readonly pattern: string; readonly flags?: string }
  | { readonly operator: "all" | "any"; readonly predicates: readonly Predicate[] }
  | { readonly operator: "not"; readonly predicate: Predicate };
