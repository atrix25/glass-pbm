import {createHash,randomBytes} from 'node:crypto';
import {adjudicationExpectation} from './expected';
import type {Answer,Book,Specimen,Values,Expectation} from './types';
export const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const owners=['Contract administration','Benefits operations','Claims operations','Finance','Finance','Client finance','Rebate operations','Contract administration'];
type Template={id:string;area:number;label:string;values:Values;kind?:Specimen['kind'];basis?:Values;review?:boolean;external?:boolean};
export const TEMPLATES:Template[]=[
 {id:'network',area:0,label:'Network mapping',values:{network:'Preferred',outOfNetworkCovered:false},review:true},
 {id:'benefits',area:0,label:'Benefit mapping',values:{copayCents:500},review:true},
 {id:'um',area:0,label:'Utilization-management mapping',values:{paRequired:true,stepRequired:true,quantity:30},review:true},
 {id:'exclusions',area:0,label:'Financial inclusions and exclusions',values:{clientEligible:true,manufacturerEligible:false},review:true},
 {id:'implementation-date',area:0,label:'Implementation effective date',values:{effectiveFrom:'2026-04-01'},review:true},
 {id:'brand',area:1,label:'Brand and generic definition',values:{classification:'Generic'},review:true},
 {id:'ldd',area:1,label:'Limited-distribution status',values:{limitedDistribution:true,network:'Designated'},review:true},
 {id:'formulary',area:1,label:'Formulary placement',values:{tier:'2',covered:true},review:true},
 {id:'retail90',area:1,label:'Retail 90 eligibility',values:{eligible:true,minimumDays:84,maximumDays:90},review:true},
 {id:'maintenance',area:1,label:'Maintenance Choice rules',values:{required:true,retailFillsAllowed:2},review:true},
 ...['eligibility','network','coverage','pa','step','quantity','pricing','costshare','accumulator','reversal'].map(variant=>({id:`claim-${variant}`,area:2,label:`Claim ${variant}`,kind:'engine' as const,values:adjudicationExpectation(variant),basis:{variant},review:true})),
 {id:'amendment',area:3,label:'Approved guarantee amendment',kind:'guarantee',basis:{units:10,manufacturerCents:10000},values:{rateCents:1200,population:'Commercial',effectiveFrom:'2026-04-01'},review:true},
 {id:'early',area:3,label:'Early guarantee application',values:{rateCents:1000,effectiveFrom:'2026-01-01'},review:true},
 {id:'late',area:3,label:'Late guarantee application',values:{rateCents:1200,effectiveFrom:'2026-04-01'},review:true},
 {id:'population',area:3,label:'Guarantee population',values:{population:'Commercial',excludedPopulation:'EGWP'},review:true},
 {id:'regulatory',area:4,label:'Regulatory rate event',kind:'rate',values:{authorized:true,eventAt:'2026-04-01',baseBps:1500,adjustmentBps:100,capBps:1550,performance:95,threshold:90,noticeSatisfied:true},review:true},
 {id:'specialty',area:4,label:'Specialty performance adjustment',kind:'rate',values:{authorized:true,eventAt:'2026-04-01',baseBps:1500,adjustmentBps:100,capBps:1700,performance:95,threshold:90,noticeSatisfied:true},review:true},
 {id:'unsupported-rate',area:4,label:'Unsupported rate increase',kind:'rate',values:{authorized:true,eventAt:'2026-12-01',baseBps:1500,adjustmentBps:100,capBps:1700,performance:95,threshold:90,noticeSatisfied:true},review:true},
 ...['missing','duplicate','amount','period','reversal','fees','credits','adjustments'].map(id=>({id:`client-${id}`,area:5,label:`Client invoice ${id}`,kind:'invoice' as const,values:{eligible:true,rateCents:600,feeCents:id==='fees'?200:0,creditCents:id==='credits'?100:0,adjustmentCents:id==='adjustments'?-50:0,period:'2026-04'},basis:{units:1,reversed:id==='reversal'},review:true})),
 ...['missing','duplicate','amount','period','reversal','excluded'].map(id=>({id:`manufacturer-${id}`,area:6,label:`Manufacturer invoice ${id}`,kind:'invoice' as const,values:{eligible:id!=='excluded',rateCents:1000,feeCents:0,creditCents:0,period:'2026Q2'},basis:{units:2,reversed:id==='reversal'},external:true})),
 {id:'submission-draft',area:6,label:'Manufacturer draft regeneration',kind:'invoice',values:{eligible:true,rateCents:1000,feeCents:0,creditCents:0,period:'2026Q2'},basis:{units:2},review:false,external:false},
 {id:'partial-collection',area:6,label:'Partial manufacturer collection',kind:'collection',values:{amountCents:2000,dueAt:'2026-04-20'},external:true},
 {id:'notice-recipient',area:7,label:'Restatement notice recipient',kind:'notice',values:{triggerAt:'2026-04-01',deadline:'2026-06-01',recipient:'Benefits lead'},external:true},
 {id:'notice-deadline',area:7,label:'Restatement notification deadline',kind:'notice',values:{triggerAt:'2026-03-01',deadline:'2026-04-01',recipient:'Benefits lead'},external:true},
 {id:'notice-prerequisite',area:7,label:'Restatement approval prerequisite',values:{approvedRestatement:true,triggerEvent:'Industry event'},review:true},
];
function correct(t:Template):Values{
 if(t.kind==='collection')return {receivedCents:2000,disputedCents:0};
 if(t.kind==='guarantee')return {rateCents:1200,forecastCents:12000,clientObligationCents:12000,expectedTopupCents:2000};
 if(t.kind==='invoice'){const amount=t.values.eligible&&!t.basis?.reversed?Number(t.basis?.units)*Number(t.values.rateCents)+Number(t.values.feeCents??0)-Number(t.values.creditCents??0)+Number(t.values.adjustmentCents??0):0;return {amountCents:amount,period:String(t.values.period),lineCount:amount?1:0};}
 if(t.kind==='rate')return {rateBps:t.id==='regulatory'?1550:t.id==='specialty'?1600:1500};
 if(t.kind==='notice')return {recipient:'Benefits lead',delivered:true,deliveredAt:t.id==='notice-deadline'?'2026-03-15':'2026-04-15'};
 return structuredClone(t.values);
}
export function makeFixture(sponsor:string,seed=randomBytes(20).toString('hex'),readableIds=false){
 let n=parseInt(digest(seed).slice(0,8),16);const rand=()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return (n>>>0)/4294967296;};
 const records:Specimen[]=[],expectations:Expectation[]=[];
 for(const t of TEMPLATES)for(const mode of ['fault','clean','unknown'] as const){
  const id=`${t.id}-${mode}`,target=correct(t),actual=structuredClone(target),basis=t.basis??{};
  if(mode==='fault'){
   const keys=Object.keys(actual).filter(k=>k!=='deliveredAt'),key=keys[Math.floor(rand()*keys.length)];
   if(t.kind==='notice'){actual.delivered=false;actual.recipient='Wrong recipient';}
   else if(t.kind==='invoice'){if(t.id.endsWith('missing')){actual.amountCents=0;actual.lineCount=0;}else if(t.id.endsWith('duplicate')){actual.lineCount=2;actual.amountCents=Number(target.amountCents)*2;}else if(t.id.endsWith('period'))actual.period='2026-01';else {actual.amountCents=Number(target.amountCents)+500;actual.lineCount=1;}}
   else if(t.kind==='rate')actual.rateBps=t.id==='unsupported-rate'?1600:1500;
   else if(t.id==='amendment')Object.assign(actual,{rateCents:1000,forecastCents:10000,clientObligationCents:10000,expectedTopupCents:0});
   else if(t.id==='early')Object.assign(actual,{rateCents:1200,effectiveFrom:'2026-04-01'});
   else if(t.id==='late')Object.assign(actual,{rateCents:1000,effectiveFrom:'2026-01-01'});
   else if(t.id==='partial-collection'){actual.receivedCents=1400;actual.disputedCents=600;}
   else {const v=actual[key];actual[key]=typeof v==='boolean'?!v:typeof v==='number'?v+100+Math.floor(rand()*5)*100:`Incorrect ${v}`;}
  }
  const term={id:`term-${t.id}`,version:1,clause:`Synthetic exhibit · ${t.label}. Approved fixture terms; not actual ${sponsor} contract terms.`,from:'2026-01-01',to:'2026-12-31',recordedAt:'2026-01-01',population:'Commercial',approved:true,values:t.kind==='engine'?{copayCents:500,dispensingFeeCents:100,submittedIngredientCents:1000,variant:String(t.basis?.variant)}:t.values};
  const requirements=mode==='unknown'?(rand()>.5?[]:[term,{...term,id:`conflicting-${t.id}`,version:2}]):[term];
  const r:Specimen={id,control:t.id,area:t.area,label:t.label,owner:t.id==='network'?'Network operations':t.id==='benefits'||t.id==='implementation-date'?'Benefits operations':t.id==='um'?'Clinical operations':owners[t.area],kind:t.kind??'mapping',population:'Commercial',serviceAt:t.id==='early'?'2026-03-15':'2026-04-15',recordedAt:'2026-04-15',requirements,actual,basis,dependencies:[],review:t.review??false,external:t.external??false,memberId:`member-${id}`,claimId:`claim-${id}`,invoiceId:[5,6].includes(t.area)?`invoice-${id}`:null};
  records.push(r);
  if(mode==='fault'&&t.kind==='notice')target.deliveredAt='2026-05-01T00:00:00.000Z';
  const moneyKey=['amountCents','billedCents','rateCents','copayCents','receivedCents','memberCents','planCents'].find(k=>typeof target[k]==='number'&&typeof actual[k]==='number'&&target[k]!==actual[k]);
  expectations.push({recordId:id,state:mode==='unknown'?'Not verified':mode==='fault'?'Exception':'Clear',target:mode==='unknown'?null:target,amountCents:mode==='fault'&&moneyKey?Math.abs(Number(target[moneyKey])-Number(actual[moneyKey])):null,repairable:mode==='fault'&&t.id!=='notice-deadline'});
 }
 // A shared root affects multiple claims and then a client invoice. No independent patching of downstream values while the root is unresolved.
 for(const r of records)if(['claim-pricing-fault','claim-costshare-fault'].includes(r.id))r.dependencies=['benefits-fault'];
 const invoice=records.find(r=>r.id==='client-missing-fault')!;invoice.dependencies=['claim-pricing-fault'];
 const missing='omitted-source';expectations.push({recordId:missing,state:'Not verified',target:null,amountCents:null,repairable:false});
 const book:Book={version:1,sponsor,cutoff:'2026-05-01T00:00:00.000Z',records,sourceManifest:[...records.map(r=>r.id),missing]};
 if(!readableIds){
  const ids=new Map(book.sourceManifest!.map(id=>[id,`record-${digest(`${seed}:${id}`).slice(0,18)}`]));
  for(const r of records){r.id=ids.get(r.id)!;r.dependencies=r.dependencies.map(d=>ids.get(d)!);r.memberId=`member-${r.id}`;r.claimId=`claim-${r.id}`;if(r.invoiceId)r.invoiceId=`invoice-${r.id}`;}
  book.sourceManifest=book.sourceManifest!.map(id=>ids.get(id)!);for(const e of expectations)e.recordId=ids.get(e.recordId)!;
 }
 const answer:Answer={seed,salt:randomBytes(24).toString('hex'),expectations,originalIds:[...book.sourceManifest!]};
 return {book,answer,commitment:digest(answer)};
}
