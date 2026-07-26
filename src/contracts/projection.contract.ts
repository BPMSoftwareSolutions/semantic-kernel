import type { JsonValue } from "../types/json.type.js";
import type { Predicate } from "./predicate.contract.js";

export type ProjectionExpression =
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "constant"; readonly value: JsonValue }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, ProjectionExpression>> }
  | { readonly kind: "array"; readonly items: readonly ProjectionExpression[] }
  | { readonly kind: "coalesce"; readonly expressions: readonly ProjectionExpression[] }
  | { readonly kind: "conditional"; readonly when: Predicate; readonly then: ProjectionExpression; readonly otherwise: ProjectionExpression }
  | { readonly kind: "merge"; readonly expressions: readonly ProjectionExpression[] };

export interface ProjectionDeclaration {
  readonly declarationType: "projection.v1";
  readonly projectionId: string;
  readonly expression: ProjectionExpression;
}
