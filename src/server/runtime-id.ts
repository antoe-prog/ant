import { randomUUID } from "node:crypto";

export function createRuntimeId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}
