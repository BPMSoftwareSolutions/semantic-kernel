import { SemanticKernelError } from "../contracts/kernel-error.js";
import type { JsonValue } from "../types/json.type.js";

export type Port = (input: JsonValue) => Promise<JsonValue>;

export class PortRegistry {
  readonly #ports = new Map<string, Port>();
  public register(portId: string, port: Port): this {
    if (this.#ports.has(portId)) throw new SemanticKernelError("DUPLICATE_PORT", `Port already registered: ${portId}`, { portId });
    this.#ports.set(portId, port); return this;
  }
  public async invoke(portId: string, input: JsonValue): Promise<JsonValue> {
    const port = this.#ports.get(portId);
    if (port === undefined) throw new SemanticKernelError("PORT_NOT_FOUND", `Port not found: ${portId}`, { portId });
    return port(input);
  }
}
