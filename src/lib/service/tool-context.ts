import {AsyncLocalStorage} from 'node:async_hooks';
export const serviceToolContext = new AsyncLocalStorage<{memberId:string;at:Date;claimId:string|null;drugName:string|null}>();
export const evidenceNow=()=>serviceToolContext.getStore()?.at??new Date();
export function claimScope(){const c=serviceToolContext.getStore();return c?{memberId:c.memberId,dateOfService:{lte:c.at}}:{}}
