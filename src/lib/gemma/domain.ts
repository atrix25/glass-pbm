import {createHash} from 'node:crypto';
export type Kind='access'|'external'|'savings';
export const STAGES=['Detected','Investigating','Action prepared','Awaiting approval','Applied','Verified'] as const;
export type Scope={sponsorId:string;contractId:string};
export const GENERATOR_VERSION='gemma-events-v1';
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const key=(...parts:unknown[])=>'gem_'+hash(parts).slice(0,32);
export function monitorHealth(enabled:boolean,heartbeat:Date|null,checked:Date|null,error:string|null,now=new Date()){
 if(!enabled)return 'Paused';if(!heartbeat||now.getTime()-heartbeat.getTime()>150000)return 'Worker stale';if(error)return 'Needs attention';if(!checked||now.getTime()-checked.getTime()>180000)return 'Starting';return 'Monitoring';
}
export function generationSlots(now:Date){return {member:Math.floor(now.getTime()/60000),external:Math.floor(now.getTime()/600000),savings:now.toISOString().slice(0,10)}}
export function mayGenerate(backlog:number){return backlog<=100}
export type ClinicalOverlay={rule:'prescriber-confirmation';drugId:string;previousPolicyId:string|null};
export function evaluateClinical(overlay:ClinicalOverlay|null,input:{drugId:string;prescriberConfirmation:boolean;authorizationApproved:boolean}){
 const matches=overlay?.drugId===input.drugId;const documentationSatisfied=!matches||input.prescriberConfirmation;
 return {rule:matches?overlay!.rule:'reference-authorization',documentationSatisfied,authorizationSatisfied:input.authorizationApproved,canProceed:documentationSatisfied&&input.authorizationApproved};
}
export function verifyClinicalOverlay(p:ClinicalOverlay){
 if(p.rule!=='prescriber-confirmation'||!p.drugId)throw Error('Unsupported clinical policy.');
 const required=evaluateClinical(p,{drugId:p.drugId,prescriberConfirmation:false,authorizationApproved:true});
 const complete=evaluateClinical(p,{drugId:p.drugId,prescriberConfirmation:true,authorizationApproved:true});
 const unrelated=evaluateClinical(p,{drugId:'unrelated',prescriberConfirmation:false,authorizationApproved:true});
 return {passed:!required.canProceed&&complete.canProceed&&unrelated.canProceed,checks:[{name:'Missing documentation remains blocked',passed:!required.canProceed},{name:'Approved documentation permits next step',passed:complete.canProceed},{name:'Unrelated drug unchanged',passed:unrelated.canProceed}]};
}
export function decisionAllowed(status:string,expectedHash:string,actualHash:string|null,revision:number,currentRevision:number){if(revision!==currentRevision)throw Error('Work changed. Refresh before reviewing.');if(status!=='Awaiting approval')throw Error('This work is not awaiting approval.');if(!actualHash||expectedHash!==actualHash)throw Error('The proposal changed. Review the current version.');}
export function messageState(m:{preparedAt:Date;sentAt:Date|null;deliveredAt:Date|null;acknowledgedAt:Date|null;failedAt:Date|null},at:Date){if(m.acknowledgedAt&&m.acknowledgedAt<=at)return 'Acknowledged';if(m.failedAt&&m.failedAt<=at)return 'Failed';if(m.deliveredAt&&m.deliveredAt<=at)return 'Delivered';if(m.sentAt&&m.sentAt<=at)return 'Sent';return 'Prepared'}
