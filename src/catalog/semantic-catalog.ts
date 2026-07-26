import type { DecisionDeclaration } from "../contracts/decision.contract.js";
import type { ExecutionModel } from "../contracts/execution.contract.js";
import type { IterationDeclaration } from "../contracts/iteration.contract.js";
import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { ProjectionDeclaration } from "../contracts/projection.contract.js";

export class SemanticCatalog {
  readonly #decisions = new Map<string, DecisionDeclaration>();
  readonly #projections = new Map<string, ProjectionDeclaration>();
  readonly #iterations = new Map<string, IterationDeclaration>();
  readonly #executions = new Map<string, ExecutionModel>();

  public registerDecision(declaration: DecisionDeclaration): this { this.#register(this.#decisions, declaration.decisionId, declaration); return this; }
  public registerProjection(declaration: ProjectionDeclaration): this { this.#register(this.#projections, declaration.projectionId, declaration); return this; }
  public registerIteration(declaration: IterationDeclaration): this { this.#register(this.#iterations, declaration.iterationId, declaration); return this; }
  public registerExecution(declaration: ExecutionModel): this { this.#register(this.#executions, declaration.executionModelId, declaration); return this; }

  public decision(id: string): DecisionDeclaration { return this.#required(this.#decisions, "decision", id); }
  public projection(id: string): ProjectionDeclaration { return this.#required(this.#projections, "projection", id); }
  public iteration(id: string): IterationDeclaration { return this.#required(this.#iterations, "iteration", id); }
  public execution(id: string): ExecutionModel { return this.#required(this.#executions, "execution model", id); }

  #register<T>(map: Map<string, T>, id: string, value: T): void {
    if (map.has(id)) throw new SemanticKernelError("DUPLICATE_DECLARATION", `Declaration already registered: ${id}`, { id });
    map.set(id, value);
  }

  #required<T>(map: Map<string, T>, kind: string, id: string): T {
    const value = map.get(id);
    if (value === undefined) throw new SemanticKernelError("DECLARATION_NOT_FOUND", `${kind} not found: ${id}`, { kind, id });
    return value;
  }
}
