export class SemanticKernelError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SemanticKernelError";
  }
}
