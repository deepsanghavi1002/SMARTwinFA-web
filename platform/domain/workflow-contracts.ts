export class WorkflowError extends Error { constructor(message: string) { super(message); this.name="WorkflowError"; } }
export function postBalanced(totalDebit:number,totalCredit:number){if(totalDebit<=0||totalDebit!==totalCredit)throw new WorkflowError("posting is unbalanced");return "posted" as const;}
export function rollbackPosting(status:"draft"|"posted"){if(status!=="posted")throw new WorkflowError("only posted records roll back");return "reversed" as const;}
export function invoiceState(current:"draft"|"issued"|"cancelled",action:"issue"|"cancel"){if(current==="draft"&&action==="issue")return "issued" as const;if(current==="issued"&&action==="cancel")return "cancelled" as const;throw new WorkflowError("invalid invoice transition");}
export function allocatePayment(due:number,payment:number){if(payment<0||payment>due)throw new WorkflowError("invalid allocation");return due-payment;}
export function calculateProduction(input:number,output:number,cost:number){if(input<=0||output<=0||cost<0)throw new WorkflowError("invalid production values");return {yield:output/input,unitCost:cost/output};}
export function retryTax(status:"pending"|"failed"|"submitted",attempt:number){if(status!=="failed"||attempt<1||attempt>3)throw new WorkflowError("tax retry denied");return "pending" as const;}
export function typedReportFilter(field:string,value:string){if(!/^[a-z][a-z0-9_]{1,49}$/i.test(field)||!value.trim())throw new WorkflowError("invalid report filter");return Object.freeze({field,value});}
export function reportTotal(values:readonly number[]){if(values.some((v)=>!Number.isSafeInteger(v)))throw new WorkflowError("invalid report total");return values.reduce((a,b)=>a+b,0);}
export function dashboardLayout(widgets:readonly string[]){if(!widgets.length||new Set(widgets).size!==widgets.length)throw new WorkflowError("invalid dashboard layout");return Object.freeze([...widgets]);}
export function printRequest(id:string){if(!/^[a-z][a-z0-9_-]{2,99}$/i.test(id))throw new WorkflowError("invalid print id");return Object.freeze({id,status:"queued" as const,retentionDays:30});}
export function yearState(open:boolean,action:"open"|"lock"){if(open&&action==="lock")return false;if(!open&&action==="open")return true;throw new WorkflowError("invalid year transition");}
export function destructiveApproval(approvedBy:string,reason:string){if(!approvedBy||reason.trim().length<8)throw new WorkflowError("destructive approval denied");return true;}
export function validateImportRow(row:Record<string,string>,required:readonly string[]){for(const k of required)if(!row[k]?.trim())throw new WorkflowError("import row invalid");return Object.freeze({...row});}
export function importKeySeen(seen:ReadonlySet<string>,key:string){return seen.has(key)?"quarantine" as const:"accept" as const;}
export function deliveryAttempt(authorized:boolean,attempt:number){if(!authorized||attempt<1||attempt>3)throw new WorkflowError("delivery denied");return "queued" as const;}
