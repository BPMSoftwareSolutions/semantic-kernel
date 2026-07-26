import { SemanticKernelError } from "../contracts/kernel-error.js";
import type {
  RelationalExpression,
  RelationalJoin,
  RelationalQueryPlan,
  RelationalQueryResult,
  RelationalSelection,
  RelationalSources,
} from "../contracts/relational.contract.js";
import type { JsonObject, JsonValue } from "../types/json.type.js";

type RowEnvironment = Readonly<Record<string, JsonObject | null>>;
type EvaluatedRow = Readonly<{ environment: RowEnvironment; group: readonly RowEnvironment[]; value: JsonObject }>;

export function executeRelationalQuery(
  plan: RelationalQueryPlan,
  suppliedSources: RelationalSources,
): RelationalQueryResult {
  const cteSources = Object.entries(plan.ctes).reduce<RelationalSources>(
    (sources, [name, cte]) => ({ ...sources, [name]: executeRelationalQuery(cte, sources).rows }),
    suppliedSources,
  );
  const initial = plan.from === undefined
    ? [Object.freeze({}) as RowEnvironment]
    : readsSource(cteSources, plan.from.sourceId).map((row) => Object.freeze({ [plan.from!.alias]: row }));
  const joined = plan.joins.reduce(
    (rows, join) => appliesJoin(rows, join, cteSources),
    initial as readonly RowEnvironment[],
  );
  const filtered = plan.where === undefined
    ? joined
    : joined.filter((environment) => truthy(evaluate(plan.where!, environment, [environment])));
  const grouped = groupsRows(filtered, plan);
  const projected = grouped
    .filter(({ environment, group }) => plan.having === undefined || truthy(evaluate(plan.having, environment, group)))
    .map(({ environment, group }) => ({
      environment,
      group,
      value: projectsSelection(plan.selections, environment, group),
    }));
  const distinct = plan.distinct ? distinctRows(projected) : projected;
  const ordered = plan.orderBy.length === 0 ? distinct : ordersRows(distinct, plan);
  const rows = ordered
    .slice(plan.offset, plan.limit === undefined ? undefined : plan.offset + plan.limit)
    .map((entry) => entry.value);
  const columns = rows.length === 0 ? selectionNames(plan.selections) : Object.keys(rows[0]!);
  return Object.freeze({ columns: Object.freeze(columns), rows: Object.freeze(rows), rowCount: rows.length });
}

function readsSource(sources: RelationalSources, sourceId: string): readonly JsonObject[] {
  const source = sources[sourceId];
  if (source === undefined) {
    throw new SemanticKernelError("RELATIONAL_SOURCE_NOT_FOUND", `Relational source not found: ${sourceId}`, { sourceId });
  }
  return source;
}

function appliesJoin(
  leftRows: readonly RowEnvironment[],
  join: RelationalJoin,
  sources: RelationalSources,
): readonly RowEnvironment[] {
  const rightRows = readsSource(sources, join.source.sourceId);
  if (join.kind === "cross") {
    return leftRows.flatMap((left) => rightRows.map((right) => Object.freeze({ ...left, [join.source.alias]: right })));
  }
  const matchedRight = new Set<number>();
  const leftJoined = leftRows.flatMap((left) => {
    const matches = rightRows
      .map((right, index) => ({ row: right, index }))
      .filter(({ row }) => truthy(evaluate(requiredJoinPredicate(join), { ...left, [join.source.alias]: row }, [left])));
    matches.forEach(({ index }) => matchedRight.add(index));
    if (matches.length > 0) {
      return matches.map(({ row }) => Object.freeze({ ...left, [join.source.alias]: row }));
    }
    return join.kind === "left" || join.kind === "full"
      ? [Object.freeze({ ...left, [join.source.alias]: null })]
      : [];
  });
  if (join.kind !== "right" && join.kind !== "full") return leftJoined;
  const leftAliases = [...new Set(leftRows.flatMap((row) => Object.keys(row)))];
  const unmatchedRight = rightRows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => !matchedRight.has(index))
    .map(({ row }) => Object.freeze({
      ...Object.fromEntries(leftAliases.map((alias) => [alias, null])),
      [join.source.alias]: row,
    }));
  return [...leftJoined, ...unmatchedRight];
}

function requiredJoinPredicate(join: RelationalJoin): RelationalExpression {
  if (join.on === undefined) {
    throw new SemanticKernelError("RELATIONAL_JOIN_PREDICATE_REQUIRED", `${join.kind} join requires an ON predicate.`);
  }
  return join.on;
}

function groupsRows(
  rows: readonly RowEnvironment[],
  plan: RelationalQueryPlan,
): readonly Readonly<{ environment: RowEnvironment; group: readonly RowEnvironment[] }>[] {
  const grouped = plan.groupBy.length > 0 || plan.selections.some((selection) => containsAggregate(selection.expression));
  if (!grouped) return rows.map((environment) => Object.freeze({ environment, group: [environment] }));
  const groups = rows.reduce<Map<string, RowEnvironment[]>>((map, environment) => {
    const key = JSON.stringify(plan.groupBy.map((expression) => evaluate(expression, environment, [environment])));
    map.set(key, [...(map.get(key) ?? []), environment]);
    return map;
  }, new Map());
  if (groups.size === 0 && plan.groupBy.length === 0) {
    return [Object.freeze({ environment: Object.freeze({}), group: Object.freeze([]) })];
  }
  return [...groups.values()].map((group) => Object.freeze({ environment: group[0]!, group: Object.freeze(group) }));
}

function projectsSelection(
  selections: readonly RelationalSelection[],
  environment: RowEnvironment,
  group: readonly RowEnvironment[],
): JsonObject {
  return Object.freeze(selections.reduce<Record<string, JsonValue>>((row, selection, index) => {
    if (selection.expression.kind === "wildcard") {
      return { ...row, ...projectsWildcard(selection.expression.qualifier, environment) };
    }
    const name = selection.alias ?? derivesSelectionName(selection.expression, index);
    return { ...row, [name]: evaluate(selection.expression, environment, group) };
  }, {}));
}

function projectsWildcard(qualifier: string | undefined, environment: RowEnvironment): JsonObject {
  if (qualifier !== undefined) return environment[qualifier] ?? {};
  return Object.freeze(Object.values(environment).reduce<Record<string, JsonValue>>(
    (row, value) => ({ ...row, ...(value ?? {}) }),
    {},
  ));
}

function evaluatesReference(path: readonly string[], environment: RowEnvironment): JsonValue {
  if (path.length > 1 && Object.hasOwn(environment, path[0]!)) {
    return readsNested(environment[path[0]!] ?? {}, path.slice(1)) ?? null;
  }
  const matches = Object.values(environment)
    .filter((row): row is JsonObject => row !== null)
    .map((row) => readsNested(row, path))
    .filter((value) => value !== undefined);
  if (matches.length > 1) {
    throw new SemanticKernelError("RELATIONAL_REFERENCE_AMBIGUOUS", `Ambiguous relational reference: ${path.join(".")}`, { path });
  }
  return matches[0] ?? null;
}

function readsNested(value: JsonValue, path: readonly string[]): JsonValue | undefined {
  return path.reduce<JsonValue | undefined>((current, segment) => (
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? current[segment]
      : undefined
  ), value);
}

function evaluate(
  expression: RelationalExpression,
  environment: RowEnvironment,
  group: readonly RowEnvironment[],
): JsonValue {
  switch (expression.kind) {
    case "literal": return expression.value;
    case "reference": return evaluatesReference(expression.path, environment);
    case "wildcard": return projectsWildcard(expression.qualifier, environment);
    case "list": return expression.items.map((item) => evaluate(item, environment, group));
    case "unary": return evaluatesUnary(expression.operator, evaluate(expression.operand, environment, group));
    case "binary": return evaluatesBinary(
      expression.operator,
      evaluate(expression.left, environment, group),
      evaluate(expression.right, environment, group),
    );
    case "call": return evaluatesCall(expression, environment, group);
  }
}

function evaluatesUnary(operator: Extract<RelationalExpression, { kind: "unary" }>["operator"], value: JsonValue): JsonValue {
  switch (operator) {
    case "not": return !truthy(value);
    case "negate": return -requiresNumber(value);
    case "is-null": return value === null;
    case "is-not-null": return value !== null;
  }
}

function evaluatesBinary(
  operator: Extract<RelationalExpression, { kind: "binary" }>["operator"],
  left: JsonValue,
  right: JsonValue,
): JsonValue {
  switch (operator) {
    case "or": return truthy(left) || truthy(right);
    case "and": return truthy(left) && truthy(right);
    case "equals": return JSON.stringify(left) === JSON.stringify(right);
    case "not-equals": return JSON.stringify(left) !== JSON.stringify(right);
    case "greater-than": return compares(left, right) > 0;
    case "greater-than-or-equal": return compares(left, right) >= 0;
    case "less-than": return compares(left, right) < 0;
    case "less-than-or-equal": return compares(left, right) <= 0;
    case "add": return requiresNumber(left) + requiresNumber(right);
    case "subtract": return requiresNumber(left) - requiresNumber(right);
    case "multiply": return requiresNumber(left) * requiresNumber(right);
    case "divide": return requiresNumber(left) / requiresNumber(right);
    case "modulo": return requiresNumber(left) % requiresNumber(right);
    case "like": return matchesLike(left, right);
    case "in": return Array.isArray(right) && right.some((item) => JSON.stringify(item) === JSON.stringify(left));
  }
}

function evaluatesCall(
  expression: Extract<RelationalExpression, { kind: "call" }>,
  environment: RowEnvironment,
  group: readonly RowEnvironment[],
): JsonValue {
  if (isAggregate(expression.function)) {
    const values = group.map((row) => expression.arguments[0]?.kind === "wildcard"
      ? 1
      : evaluate(requiredArgument(expression), row, [row]));
    const selected = expression.distinct
      ? [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]
      : values;
    switch (expression.function) {
      case "count": return expression.arguments[0]?.kind === "wildcard" ? selected.length : selected.filter((value) => value !== null).length;
      case "sum": return selected.reduce<number>((total, value) => total + requiresNumber(value), 0);
      case "average": return selected.length === 0 ? null : selected.reduce<number>((total, value) => total + requiresNumber(value), 0) / selected.length;
      case "minimum": return selected.length === 0 ? null : selected.reduce((minimum, value) => compares(value, minimum) < 0 ? value : minimum);
      case "maximum": return selected.length === 0 ? null : selected.reduce((maximum, value) => compares(value, maximum) > 0 ? value : maximum);
    }
  }
  const values = expression.arguments.map((argument) => evaluate(argument, environment, group));
  switch (expression.function) {
    case "lower": return requiresString(values[0]).toLowerCase();
    case "upper": return requiresString(values[0]).toUpperCase();
    case "length": return requiresString(values[0]).length;
    case "coalesce": return values.find((value) => value !== null) ?? null;
    default: throw new SemanticKernelError("RELATIONAL_FUNCTION_INVALID", `Invalid scalar function: ${expression.function}`);
  }
}

function requiredArgument(expression: Extract<RelationalExpression, { kind: "call" }>): RelationalExpression {
  const argument = expression.arguments[0];
  if (argument === undefined) {
    throw new SemanticKernelError("RELATIONAL_FUNCTION_ARGUMENT_REQUIRED", `${expression.function} requires an argument.`);
  }
  return argument;
}

function containsAggregate(expression: RelationalExpression): boolean {
  switch (expression.kind) {
    case "call": return isAggregate(expression.function) || expression.arguments.some(containsAggregate);
    case "binary": return containsAggregate(expression.left) || containsAggregate(expression.right);
    case "unary": return containsAggregate(expression.operand);
    case "list": return expression.items.some(containsAggregate);
    default: return false;
  }
}

function isAggregate(value: string): value is "count" | "sum" | "average" | "minimum" | "maximum" {
  return ["count", "sum", "average", "minimum", "maximum"].includes(value);
}

function distinctRows(rows: readonly EvaluatedRow[]): readonly EvaluatedRow[] {
  return [...new Map(rows.map((row) => [JSON.stringify(row.value), row])).values()];
}

function ordersRows(rows: readonly EvaluatedRow[], plan: RelationalQueryPlan): readonly EvaluatedRow[] {
  return [...rows].sort((left, right) => plan.orderBy.reduce((result, order) => {
    if (result !== 0) return result;
    const leftValue = evaluatesOrderExpression(order.expression, left);
    const rightValue = evaluatesOrderExpression(order.expression, right);
    const comparison = compares(leftValue, rightValue);
    return order.direction === "descending" ? -comparison : comparison;
  }, 0));
}

function evaluatesOrderExpression(expression: RelationalExpression, row: EvaluatedRow): JsonValue {
  if (expression.kind === "reference" && expression.path.length === 1 && Object.hasOwn(row.value, expression.path[0]!)) {
    return row.value[expression.path[0]!] ?? null;
  }
  return evaluate(expression, row.environment, row.group);
}

function selectionNames(selections: readonly RelationalSelection[]): string[] {
  return selections.flatMap((selection, index) => selection.expression.kind === "wildcard"
    ? []
    : [selection.alias ?? derivesSelectionName(selection.expression, index)]);
}

function derivesSelectionName(expression: RelationalExpression, index: number): string {
  if (expression.kind === "reference") return expression.path.at(-1) ?? `column${index + 1}`;
  if (expression.kind === "call") return expression.function;
  return `column${index + 1}`;
}

function requiresNumber(value: JsonValue): number {
  if (typeof value !== "number") {
    throw new SemanticKernelError("RELATIONAL_NUMBER_REQUIRED", "Relational arithmetic requires numeric values.", { value });
  }
  return value;
}

function requiresString(value: JsonValue | undefined): string {
  if (typeof value !== "string") {
    throw new SemanticKernelError("RELATIONAL_STRING_REQUIRED", "Relational string operation requires a string.", { value });
  }
  return value;
}

function compares(left: JsonValue, right: JsonValue): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  throw new SemanticKernelError(
    "RELATIONAL_VALUES_NOT_COMPARABLE",
    "Relational comparison requires values of the same comparable type.",
    { left, right },
  );
}

function matchesLike(left: JsonValue, right: JsonValue): boolean {
  const value = requiresString(left);
  const pattern = requiresString(right)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${pattern}$`, "s").test(value);
}

function truthy(value: JsonValue): boolean {
  return Boolean(value);
}
