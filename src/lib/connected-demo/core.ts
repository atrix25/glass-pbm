import {priceClaim} from '@/lib/engine/pricing';
export type Config={cashCap:boolean;copay:number};
export type Claim={id:string;member:string;target:boolean;allowed:number;memberPaid:number;employer:number;version:number};
export type Event={at:string;role:string;action:string};
export type Entry={id:string;account:string;amount:number;status:'Posted'|'Pending'|'Settled';reason:string};
export type State={version:1;engine:string;createdAt:string;stage:'Ready'|'Detected'|'Approved'|'Rejected'|'Corrected'|'Settled'|'Verified';config:Config;original:Claim[];claims:Claim[];findings:{field:string;expected:string;actual:string}[];events:Event[];ledger:Entry[];checks:{name:string;passed:boolean;detail:string}[];commands:Record<string,string>;reviewer?:string};
export const TERMS={id:'SYN-CEDAR-2026-A1',effective:'2026-10-01',label:'Synthetic amendment · Not a Caremark contract',quote:'For the ten designated maintenance claims, pay the lesser of submitted ingredient cost plus a $2 dispensing fee or the pharmacy’s all-in cash price. Member cost share is $20, capped at allowed cost. All manufacturer rebates are credited to the employer. The disclosed administration fee is $2 per claim.',config:{cashCap:true,copay:2000}};
export const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
export function calculate(index:number,config:Config,version=1):Claim{
 const target=index<10;
 const priced=priceClaim({prices:{awpMicros:200000000,nadacMicros:100000000},usualAndCustomaryMicros:(target?8000:5000)*10000,submittedIngredientCostMicros:(target?12000:4800)*10000,rate:{dispensingFeeMicros:2000000,lesserOfArms:['SUBMITTED','UANDC'],includeUandC:target?config.cashCap:true}});
 const allowed=priced.totalAllowedMicros/10000,memberPaid=Math.min(allowed,target?config.copay:1000);
 return {id:`SYN-C${String(index+1).padStart(3,'0')}`,member:`Demo member ${String(index+1).padStart(3,'0')}`,target,allowed,memberPaid,employer:allowed-memberPaid,version};
}
export const totals=(claims:Claim[])=>claims.reduce((a,c)=>({allowed:a.allowed+c.allowed,member:a.member+c.memberPaid,employer:a.employer+c.employer}),{allowed:0,member:0,employer:0});
export function createState():State{
 const at=new Date().toISOString(),config={cashCap:false,copay:4000},claims=Array.from({length:100},(_,i)=>calculate(i,config));
 return {version:1,engine:'connected-sandbox-1 + priceClaim',createdAt:at,stage:'Ready',config,original:structuredClone(claims),claims,findings:[],events:[{at,role:'Sandbox importer',action:'Generated 100 fictional members and claims. Seeded an omitted cash-price cap and stale copay after a synthetic amendment.'}],ledger:[{id:'original-invoice',account:'Employer invoice',amount:457000,status:'Posted',reason:'Claims $4,420 + disclosed fees $200 − employer rebate credit $50'},{id:'manufacturer-receipt',account:'Manufacturer receipts',amount:5000,status:'Settled',reason:'Synthetic receipt supporting the full employer rebate credit'},{id:'rebate-credit',account:'Employer rebate credit',amount:-5000,status:'Posted',reason:'Included in original invoice; do not subtract again'}],checks:[],commands:{}};
}
export type Action='scan'|'approve'|'reject'|'repair'|'settle'|'verify';
export function execute(state:State,action:Exclude<Action,'verify'>,actor:string){
 const expected:Record<Exclude<Action,'verify'>,State['stage'][] >={scan:['Ready','Rejected'],approve:['Detected'],reject:['Detected'],repair:['Approved'],settle:['Corrected']};
 if(!expected[action].includes(state.stage))throw Error('Complete the preceding step first');
 let role='',description='';
 if(action==='scan'){
  state.findings=[];
  if(state.config.cashCap!==TERMS.config.cashCap)state.findings.push({field:'Cash-price cap',expected:'Included',actual:'Omitted'});
  if(state.config.copay!==TERMS.config.copay)state.findings.push({field:'Target member copay',expected:money(TERMS.config.copay),actual:money(state.config.copay)});
  state.stage='Detected';role='Operational protection · Scripted';description=`Detected ${state.findings.length} configuration mismatches. Prepared a source-linked patch; approval required for member cost and payment changes.`;
 }else if(action==='approve'||action==='reject'){
  state.stage=action==='approve'?'Approved':'Rejected';state.reviewer=actor;role='Benefits / Finance · Simulated review';description=`${action==='approve'?'Approved':'Rejected'} sandbox correction. Reviewer: ${actor}. No real benefit activation.`;
 }else if(action==='repair'){
  state.config={...TERMS.config};state.claims=state.original.map((_,i)=>calculate(i,state.config,i<10?2:1));
  const old=totals(state.original),now=totals(state.claims);
  for(const c of state.original.filter(c=>c.target)){const replacement=state.claims.find(r=>r.id===c.id)!;state.ledger.push({id:c.id+'-reversal',account:'Claim reversal',amount:-c.allowed,status:'Posted',reason:c.id+' · Original amount offset'},{id:c.id+'-replacement',account:'Claim replacement',amount:replacement.allowed,status:'Posted',reason:c.id+' · Repriced with approved configuration'});}
  state.ledger.push({id:'invoice-adjustment',account:'Employer invoice',amount:now.employer-old.employer,status:'Posted',reason:'Replacement claim results; original invoice retained'},
   {id:'member-refund',account:'Member refund',amount:old.member-now.member,status:'Pending',reason:'Refund from corrected member liability'},
   {id:'pharmacy-recovery',account:'Pharmacy recovery',amount:old.allowed-now.allowed,status:'Pending',reason:'Receivable from reversal and replacement; not collected yet'});
  state.stage='Corrected';role='Claims / Finance · Scripted';description='Applied approved configuration, reversed and replaced affected claim amounts, and posted a traceable invoice adjustment. Settlement remains pending.';
 }else{
  for(const e of state.ledger)if(e.status==='Pending')e.status='Settled';state.stage='Settled';role='Settlement simulator';description='Recorded fictional pharmacy recovery and member refund confirmations. No external submission or money movement.';
 }
 state.events.push({at:new Date().toISOString(),role,action:description});
}
export function forecast(s:State){const proposed=s.original.map((_,i)=>calculate(i,TERMS.config));const before=totals(s.original),after=totals(proposed);return {before,after,employerReduction:before.employer-after.employer,memberReduction:before.member-after.member,affected:proposed.filter((c,i)=>c.allowed!==s.original[i].allowed||c.memberPaid!==s.original[i].memberPaid).length};}
export function memberAnswer(s:State,question:'cost'|'refund'|'access',index=0){
 const c=s.claims[index],old=s.original[index];if(!c)return 'Member not found in this synthetic book.';
 if(question==='access')return 'This demonstration changes pricing and member cost share only. It models no pharmacy removal, new prior authorization or drug exclusion. Clinical access outcomes have not been tested.';
 if(question==='refund')return c.memberPaid===old.memberPaid?'No refund has been recorded for this claim.':s.stage==='Settled'||s.stage==='Verified'?`The simulator recorded a ${money(old.memberPaid-c.memberPaid)} refund for ${c.id}. This is fictional settlement evidence.`:`A ${money(old.memberPaid-c.memberPaid)} refund is pending for ${c.id}. It has not been confirmed paid.`;
 return `${c.id}: your recorded cost is ${money(c.memberPaid)} of ${money(c.allowed)} allowed cost. ${c.target&&c.version===1?'The synthetic amendment specifies a $20 copay and an $80 cash-price cap; the original configuration did not apply them. Staff approval is required before correction.':c.target?'The corrected calculation applies the $80 cash-price cap and $20 copay.':'This claim is outside the amendment population and is unchanged.'}`;
}
