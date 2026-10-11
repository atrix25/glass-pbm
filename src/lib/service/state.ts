export const TEAMS = ['Member services', 'Clinical operations', 'Benefits'] as const;
export const STATUSES = ['Open', 'In progress', 'Waiting', 'Resolved'] as const;
export type Kind = 'cost' | 'authorization' | 'benefit';
export type Status = typeof STATUSES[number];
export type Event = {seq:number;type:string;status:string;team:string;summary:string;actor:string;simulated:boolean;payload:string;evidenceAt:string|Date;createdAt:string|Date};
export type Context = {claimId:string|null;claimNumber:string|null;drugId:string|null;drugName:string|null;benefitPlanId:string|null;benefitName:string|null;patientPayCents:number|null;rejectReason:string|null;source?:{runId:string;optionId:string;title:string;claimIds:string[];higherCost:boolean;accessChange:boolean;beforeCents:number|null;afterCents:number|null;deltaCents:number|null;override:unknown};};
export const COMMANDS = ['prepare','escalate','receive','approve','reject','activate','authorization-response','fill-response','confirm','resolve','reopen','recover'] as const;
export type Command = typeof COMMANDS[number];
export function visibleEvents(events:Event[],at:Date){return events.filter(e=>new Date(e.evidenceAt)<=at).sort((a,b)=>a.seq-b.seq)}
export function caseState(kind:Kind,events:Event[]) {
 const last=events.at(-1);const lastReopen=events.findLastIndex(e=>e.type==='reopen');const cycle=events.slice(lastReopen+1);
 const draft=cycle.slice(Math.max(0,cycle.findLastIndex(e=>e.type==='prepare')));
 const review=draft.filter(e=>['approve','reject'].includes(e.type)).at(-1);
 return {status:(last?.status??'Open') as Status,team:last?.team??'Member services',prepared:cycle.some(e=>e.type==='prepare'),received:draft.some(e=>e.type==='receive'),approved:review?.type==='approve',rejected:review?.type==='reject',active:cycle.some(e=>e.type==='activate'),authorization:cycle.some(e=>e.type==='authorization-response'),fill:cycle.some(e=>e.type==='fill-response'),confirmed:cycle.some(e=>e.type==='confirm'),answered:cycle.some(e=>e.type==='answer'&&JSON.parse(e.payload).usable===true),pending:cycle.at(-1)?.type==='question',kind};
}
export function transition(kind:Kind,events:Event[],command:Command,note:string,hasClaim:boolean){
 const s=caseState(kind,events);let status:Status=s.status,team=s.team,summary='';
 if(command==='reopen'){if(s.status!=='Resolved')throw Error('Only resolved cases can be reopened.');if(!note.trim())throw Error('Enter a reason for reopening.');return {status:'Open' as Status,team,summary:`Reopened: ${note}`}}
 if(s.status==='Resolved')throw Error('Reopen this case before recording more work.');
 if(s.pending&&command!=='recover')throw Error('The answer is still running.');
 switch(command){
 case 'prepare':if(s.prepared&&!s.rejected)throw Error('A draft is already prepared.');if(!hasClaim)throw Error('Select a claim before preparing this action.');status='Waiting';team=kind==='authorization'?'Clinical operations':kind==='benefit'?'Benefits':'Member services';summary=kind==='authorization'?'Authorization request prepared. Awaiting simulated clinical review.':kind==='benefit'?'Benefit scenario prepared. Awaiting simulated benefits review.':'Cost-review packet prepared. Awaiting simulated review.';break;
 case 'escalate':status='Waiting';summary='Handoff prepared for Member services. Receipt is not yet recorded.';team='Member services';break;
 case 'receive':if(!events.some(e=>['prepare','escalate','handoff'].includes(e.type)))throw Error('Prepare a handoff first.');if(s.received)throw Error('Receipt already recorded.');status='In progress';summary=`Simulated staff receipt recorded by ${team}.`;break;
 case 'approve':case 'reject':if(!s.prepared||!s.received)throw Error('Prepare the draft and record staff receipt first.');if(s.approved||s.rejected)throw Error('This draft already has a decision.');if(!note.trim())throw Error('Enter a review note.');status='Waiting';summary=command==='approve'?'Simulated review approved. External response is still outstanding.':`Simulated review rejected: ${note}`;break;
 case 'activate':if(kind!=='benefit'||!s.approved)throw Error('A benefits approval is required.');if(s.active)throw Error('Scenario already effective.');status='Waiting';summary='Approved configuration is effective in this case simulation only. Operational benefits are unchanged.';break;
 case 'authorization-response':if(kind!=='authorization'||!s.approved)throw Error('A clinical review approval is required.');if(s.authorization)throw Error('Response already recorded.');status='Waiting';summary='Synthetic authorization response: approved for the selected drug. A successful fill is not yet recorded.';break;
 case 'fill-response':if(!hasClaim||!(kind==='authorization'?s.authorization:kind==='benefit'?s.active:false))throw Error('The relevant authorization or effective scenario is required.');if(s.fill)throw Error('Fill evidence already recorded.');status='In progress';summary='Synthetic pharmacy response: successful fill linked to this member, drug and reference claim.';break;
 case 'confirm':if(!s.answered)throw Error('A supported answer must be recorded first.');if(s.confirmed)throw Error('Confirmation already recorded.');status='In progress';summary='Simulated member confirmation: explanation understood.';break;
 case 'resolve':if(kind==='cost'?!s.confirmed:!s.fill)throw Error(kind==='cost'?'Member confirmation is required.':'Successful linked fill evidence is required. Approval alone does not restore access.');status='Resolved';summary=kind==='cost'?'Answer provided · confirmed in simulation.':'Access restored · verified in simulation.';break;
 case 'recover':if(!s.pending)throw Error('No interrupted answer to recover.');status='Open';summary='Interrupted answer marked failed. No resolution recorded; submit the question again.';break;
 }
 return {status,team,summary};
}
export function outcomes(cases:{kind:Kind;events:Event[]}[]){
 let resolved=0,withoutStaff=0,repeatContacts=0,totalMs=0,timed=0;
 for(const c of cases){const s=caseState(c.kind,c.events);repeatContacts+=Math.max(0,c.events.filter(e=>e.type==='question').length-1);if(s.status!=='Resolved')continue;resolved++;if(!c.events.some(e=>['receive','approve','reject'].includes(e.type)))withoutStaff++;const end=c.events.filter(e=>e.type==='resolve').at(-1),start=c.events[0];if(end&&start){totalMs+=Math.max(0,new Date(end.createdAt).getTime()-new Date(start.createdAt).getTime());timed++;}}
 return {total:cases.length,resolved,unresolved:cases.length-resolved,withoutStaff,repeatContacts,averageResolutionSeconds:timed?Math.round(totalMs/timed/1000):null};
}
