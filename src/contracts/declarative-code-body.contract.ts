import type { JsonValue } from "../types/json.type.js";

export type TypeScriptParameter = Readonly<{
  name: string;
  type?: string;
  optional?: boolean;
}>;

export type TypeScriptExpression =
  | Readonly<{ kind: "literal"; value: JsonValue }>
  | Readonly<{ kind: "identifier"; name: string }>
  | Readonly<{ kind: "member"; object: TypeScriptExpression; property: string; optional?: boolean }>
  | Readonly<{ kind: "index"; object: TypeScriptExpression; index: TypeScriptExpression; optional?: boolean }>
  | Readonly<{ kind: "call"; callee: TypeScriptExpression; arguments?: readonly TypeScriptExpression[]; optional?: boolean }>
  | Readonly<{ kind: "new"; callee: TypeScriptExpression; arguments?: readonly TypeScriptExpression[] }>
  | Readonly<{ kind: "await"; expression: TypeScriptExpression }>
  | Readonly<{ kind: "assign"; operator: "=" | "+=" | "-=" | "*=" | "/="; target: TypeScriptExpression; value: TypeScriptExpression }>
  | Readonly<{ kind: "update"; operator: "++" | "--"; operand: TypeScriptExpression; prefix?: boolean }>
  | Readonly<{ kind: "unary"; operator: "!" | "-" | "+" | "typeof" | "void"; operand: TypeScriptExpression }>
  | Readonly<{
      kind: "binary";
      operator: "===" | "!==" | "==" | "!=" | ">" | ">=" | "<" | "<=" | "+" | "-" | "*" | "/" | "%" | "&&" | "||" | "??" | "in" | "instanceof";
      left: TypeScriptExpression;
      right: TypeScriptExpression;
    }>
  | Readonly<{ kind: "conditional"; condition: TypeScriptExpression; then: TypeScriptExpression; otherwise: TypeScriptExpression }>
  | Readonly<{ kind: "array"; items: readonly TypeScriptExpression[] }>
  | Readonly<{ kind: "object"; properties: readonly TypeScriptObjectProperty[] }>
  | Readonly<{ kind: "arrow"; async?: boolean; parameters: readonly TypeScriptParameter[]; body: TypeScriptExpression | readonly TypeScriptStatement[] }>
  | Readonly<{ kind: "template"; parts: readonly (string | TypeScriptExpression)[] }>
  | Readonly<{ kind: "as"; expression: TypeScriptExpression; type: string }>
  | Readonly<{ kind: "spread"; expression: TypeScriptExpression }>;

export type TypeScriptObjectProperty =
  | Readonly<{ kind: "property"; name: string; value: TypeScriptExpression; shorthand?: boolean }>
  | Readonly<{ kind: "spread"; expression: TypeScriptExpression }>;

export type TypeScriptStatement =
  | Readonly<{ kind: "variable"; declarationKind: "const" | "let"; name: string; type?: string; value: TypeScriptExpression }>
  | Readonly<{ kind: "expression"; expression: TypeScriptExpression }>
  | Readonly<{ kind: "return"; expression?: TypeScriptExpression }>
  | Readonly<{ kind: "throw"; expression: TypeScriptExpression }>
  | Readonly<{ kind: "if"; condition: TypeScriptExpression; then: readonly TypeScriptStatement[]; otherwise?: readonly TypeScriptStatement[] }>
  | Readonly<{ kind: "for-of"; declarationKind: "const" | "let"; name: string; iterable: TypeScriptExpression; body: readonly TypeScriptStatement[]; await?: boolean }>
  | Readonly<{ kind: "while"; condition: TypeScriptExpression; body: readonly TypeScriptStatement[] }>
  | Readonly<{ kind: "try"; body: readonly TypeScriptStatement[]; catch?: Readonly<{ binding: string; body: readonly TypeScriptStatement[] }>; finally?: readonly TypeScriptStatement[] }>
  | Readonly<{ kind: "switch"; expression: TypeScriptExpression; cases: readonly TypeScriptSwitchCase[] }>
  | Readonly<{ kind: "break" }>
  | Readonly<{ kind: "continue" }>
  | Readonly<{ kind: "block"; body: readonly TypeScriptStatement[] }>;

export type TypeScriptSwitchCase = Readonly<{
  test?: TypeScriptExpression;
  body: readonly TypeScriptStatement[];
}>;

export type TypeScriptImport = Readonly<{
  kind: "import";
  from: string;
  typeOnly?: boolean;
  default?: string;
  namespace?: string;
  named?: readonly Readonly<{ imported: string; local?: string; typeOnly?: boolean }>[];
}>;

export type TypeScriptDeclaration =
  | Readonly<{
      kind: "function";
      name: string;
      export?: boolean;
      default?: boolean;
      async?: boolean;
      parameters: readonly TypeScriptParameter[];
      returnType?: string;
      body: readonly TypeScriptStatement[];
    }>
  | Readonly<{
      kind: "variable";
      name: string;
      export?: boolean;
      declarationKind: "const" | "let";
      type?: string;
      value: TypeScriptExpression;
    }>
  | Readonly<{ kind: "type-alias"; name: string; export?: boolean; typeParameters?: readonly string[]; type: string }>
  | Readonly<{ kind: "interface"; name: string; export?: boolean; extends?: readonly string[]; members: readonly TypeScriptInterfaceMember[] }>
  | Readonly<{ kind: "class"; name: string; export?: boolean; default?: boolean; extends?: TypeScriptExpression; members: readonly TypeScriptClassMember[] }>
  | Readonly<{ kind: "export-all"; from: string }>;

export type TypeScriptInterfaceMember =
  | Readonly<{ kind: "property"; name: string; type: string; optional?: boolean; readonly?: boolean }>
  | Readonly<{ kind: "method"; name: string; parameters: readonly TypeScriptParameter[]; returnType: string; optional?: boolean }>;

export type TypeScriptClassMember =
  | Readonly<{ kind: "property"; name: string; visibility?: "public" | "protected" | "private"; static?: boolean; readonly?: boolean; type?: string; value?: TypeScriptExpression }>
  | Readonly<{ kind: "constructor"; parameters: readonly TypeScriptParameter[]; body: readonly TypeScriptStatement[] }>
  | Readonly<{ kind: "method"; name: string; visibility?: "public" | "protected" | "private"; static?: boolean; async?: boolean; parameters: readonly TypeScriptParameter[]; returnType?: string; body: readonly TypeScriptStatement[] }>;

export type DeclarativeTypeScriptArtifact = Readonly<{
  path: string;
  imports?: readonly TypeScriptImport[];
  declarations: readonly TypeScriptDeclaration[];
}>;

export type DeclarativeTypeScriptProjection = Readonly<{
  projectionType: "declarative-typescript-projection.v1";
  projectionId: string;
  version: string;
  targetId: "typescript-esm";
  artifacts: readonly DeclarativeTypeScriptArtifact[];
}>;
