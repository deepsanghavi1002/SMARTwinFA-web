export class ReadinessError extends Error { constructor(message: string){super(message);this.name="ReadinessError";} }
export function duplicateImportAction(seen:ReadonlySet<string>,key:string){return seen.has(key)?"quarantine" as const:"accept" as const;}
export function authorizedDelivery(authorized:boolean,retries:number){if(!authorized||retries<0||retries>3)throw new ReadinessError("delivery denied");return "queued" as const;}
export function closeOverrides(active:readonly string[],registered:ReadonlySet<string>){const missing=active.filter((id)=>!registered.has(id));if(missing.length)throw new ReadinessError("unregistered override");return true;}
export function clientBranchAllowed(branch:string){if(/license|company|schema|database/i.test(branch))throw new ReadinessError("hard-coded client branch");return true;}
export function evidenceRegistry(ids:readonly string[]){if(!ids.length||new Set(ids).size!==ids.length)throw new ReadinessError("invalid evidence registry");return Object.freeze([...ids]);}
export function databaseHarness(isolated:boolean,disposable:boolean){if(!isolated||!disposable)throw new ReadinessError("database harness is unsafe");return "ready" as const;}
export function accessibleControl(input:{label:string; keyboard:boolean}){if(!input.label.trim()||!input.keyboard)throw new ReadinessError("control is inaccessible");return true;}
export function observation(context:string,correlationId:string){if(!context||!correlationId)throw new ReadinessError("observation scope is incomplete");return Object.freeze({context,correlationId});}
export function classifyData(value:"public"|"internal"|"restricted",lineage:string){if(value==="restricted"&&!lineage.trim())throw new ReadinessError("restricted data needs lineage");return Object.freeze({value,lineage});}
export function readinessChecklist(items:readonly boolean[]){if(!items.length||items.some((item)=>!item))throw new ReadinessError("operational readiness incomplete");return "ready" as const;}
