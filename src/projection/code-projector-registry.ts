import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { CodeProjector } from "../contracts/code-projection.contract.js";

export class CodeProjectorRegistry {
  readonly #projectors = new Map<string, CodeProjector>();

  public register(projector: CodeProjector): this {
    requireProjector(projector);
    if (this.#projectors.has(projector.projectorId)) {
      throw new SemanticKernelError(
        "DUPLICATE_CODE_PROJECTOR",
        `Code projector already registered: ${projector.projectorId}`,
        { projectorId: projector.projectorId },
      );
    }
    this.#projectors.set(projector.projectorId, Object.freeze({ ...projector }));
    return this;
  }

  public projector(projectorId: string): CodeProjector {
    const projector = this.#projectors.get(projectorId);
    if (projector === undefined) {
      throw new SemanticKernelError(
        "CODE_PROJECTOR_NOT_FOUND",
        `Code projector not found: ${projectorId}`,
        { projectorId },
      );
    }
    return projector;
  }

  public has(projectorId: string): boolean {
    return this.#projectors.has(projectorId);
  }
}

function requireProjector(candidate: unknown): asserts candidate is CodeProjector {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new SemanticKernelError("INVALID_CODE_PROJECTOR", "Code projector must be an object.");
  }
  const projector = candidate as Partial<CodeProjector>;
  if (typeof projector.projectorId !== "string" || !isIdentity(projector.projectorId)) {
    throw new SemanticKernelError(
      "INVALID_CODE_PROJECTOR",
      "Code projector projectorId must be a portable identity containing letters, numbers, dots, underscores, slashes, or hyphens.",
    );
  }
  if (typeof projector.project !== "function") {
    throw new SemanticKernelError(
      "INVALID_CODE_PROJECTOR",
      `Code projector must provide a project function: ${projector.projectorId}`,
      { projectorId: projector.projectorId },
    );
  }
}

function isIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value);
}
