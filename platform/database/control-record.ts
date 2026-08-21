import { type TenantContext, scopedKey } from "../context/tenant-context.ts";
export type ControlRecord = Readonly<{ id: string; scopeKey: string; context: TenantContext }>;
export function createControlRecord(context: TenantContext, id: string): ControlRecord { return Object.freeze({ id, scopeKey: scopedKey(context, "control", id), context }); }
