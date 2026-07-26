export interface IterationDeclaration {
  readonly declarationType: "iteration.v1";
  readonly iterationId: string;
  readonly collectionPath: string;
  readonly itemContextPath: string;
  readonly projectionId: string;
  readonly order: "source" | "reverse";
}
