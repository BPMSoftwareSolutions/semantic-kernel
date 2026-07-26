import type { JsonObject, JsonValue } from "../types/json.type.js";

export type CodeProjectionContext = Readonly<{
  authority: JsonValue;
  options: JsonObject;
}>;

export type ProjectedCodeArtifact = Readonly<{
  path: string;
  content: string;
  executable?: boolean;
}>;

export type CodeProjectorOutput = Readonly<{
  targetId: string;
  artifacts: readonly ProjectedCodeArtifact[];
  metadata?: JsonObject;
}>;

export type CodeProjector = Readonly<{
  projectorId: string;
  project(context: CodeProjectionContext): CodeProjectorOutput | Promise<CodeProjectorOutput>;
}>;

export type ProjectedCodeArtifactReceipt = ProjectedCodeArtifact & Readonly<{
  sha256: string;
}>;

export type CodeProjectionReceipt = Readonly<{
  receiptType: "code-projection-receipt.v1";
  projectorId: string;
  targetId: string;
  authoritySha256: string;
  optionsSha256: string;
  artifacts: readonly ProjectedCodeArtifactReceipt[];
  metadata: JsonObject;
}>;
