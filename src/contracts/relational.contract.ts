import type { JsonObject, JsonValue } from "../types/json.type.js";

export type RelationalExpression =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "reference"; readonly path: readonly string[] }
  | { readonly kind: "wildcard"; readonly qualifier?: string }
  | { readonly kind: "unary"; readonly operator: "not" | "negate" | "is-null" | "is-not-null"; readonly operand: RelationalExpression }
  | {
      readonly kind: "binary";
      readonly operator:
        | "or" | "and"
        | "equals" | "not-equals" | "greater-than" | "greater-than-or-equal" | "less-than" | "less-than-or-equal"
        | "add" | "subtract" | "multiply" | "divide" | "modulo"
        | "like" | "in";
      readonly left: RelationalExpression;
      readonly right: RelationalExpression;
    }
  | {
      readonly kind: "call";
      readonly function: "count" | "sum" | "average" | "minimum" | "maximum" | "lower" | "upper" | "length" | "coalesce";
      readonly arguments: readonly RelationalExpression[];
      readonly distinct?: boolean;
    }
  | { readonly kind: "list"; readonly items: readonly RelationalExpression[] };

export type RelationalSource = Readonly<{ sourceId: string; alias: string }>;

export type RelationalJoin = Readonly<{
  kind: "inner" | "left" | "right" | "full" | "cross";
  source: RelationalSource;
  on?: RelationalExpression;
}>;

export type RelationalSelection = Readonly<{ expression: RelationalExpression; alias?: string }>;

export type RelationalOrder = Readonly<{
  expression: RelationalExpression;
  direction: "ascending" | "descending";
}>;

export type RelationalQueryPlan = Readonly<{
  planType: "relational-query-plan.v1";
  ctes: Readonly<Record<string, RelationalQueryPlan>>;
  from?: RelationalSource;
  joins: readonly RelationalJoin[];
  where?: RelationalExpression;
  groupBy: readonly RelationalExpression[];
  having?: RelationalExpression;
  selections: readonly RelationalSelection[];
  distinct: boolean;
  orderBy: readonly RelationalOrder[];
  offset: number;
  limit?: number;
}>;

export type RelationalSources = Readonly<Record<string, readonly JsonObject[]>>;

export type RelationalQueryResult = Readonly<{
  columns: readonly string[];
  rows: readonly JsonObject[];
  rowCount: number;
}>;
