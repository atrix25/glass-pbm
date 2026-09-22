import type {Requirement} from '../types';
export type Area='contract'|'drugs'|'claims'|'guarantees'|'rates'|'client'|'manufacturer'|'notices';
export type Artifact=Record<string,unknown>;
export type Check={name:string;status:'Passed'|'Failed'|'Missing evidence';expected:unknown;produced:unknown;detail:string};
export type Stage={id:Area;area:number;name:string;role:string;dependencies:Area[];rule:string;approval:boolean;external?:'delivery'|'settlement';};
export type Attempt={at:string;inputs:Artifact;output:Artifact|null;checks:Check[];version:number};
export type Step={status:'Not started'|'Blocked'|'Awaiting review'|'Rejected'|'Awaiting evidence'|'Released'|'Failed'|'Missing evidence';output:Artifact|null;checks:Check[];attempts:Attempt[];approved:boolean;external:Partial<Record<'acceptance'|'settlement'|'delivery',string>>;version:number};
export type Source={terms:Record<Area,Requirement[]>;claims:{id:string;member:string;serviceAt:string;recordedAt:string;quantity:number;days:number;ingredientCents:number;reversed:boolean;manufacturerEligible:boolean;guaranteeEligible:boolean}[];manifest:string[];cutoff:string;period:string};
export type ProcessState={format:2;sponsor:string;agentId:'rebate-protection';versions:{processor:string;verifier:string};baseline:Source;source:Source;overrides:Partial<Record<Area,Artifact>>;steps:Record<Area,Step>;events:{at:string;step:Area|null;kind:string;actor:string;detail:string}[];commands:Record<string,string>;tests:null|{at:string;cases:{name:string;area:Area;passed:boolean;detail:string}[]};};
export const STAGES:Stage[]=[
 {id:'contract',area:0,name:'Contract implementation',role:'Contract administration',dependencies:[],rule:'Select one approved, effective requirement; publish network, benefit, UM and financial configuration.',approval:true},
 {id:'drugs',area:1,name:'Drug definitions',role:'Benefits operations',dependencies:['contract'],rule:'Preserve separate classification, distribution, formulary, Retail 90 and Maintenance Choice attributes.',approval:false},
 {id:'rates',area:4,name:'Rate adjustments',role:'Finance',dependencies:['contract'],rule:'Apply authorized events only after the trigger, performance threshold and notice evidence; cap the adjustment.',approval:true},
 {id:'claims',area:2,name:'Claim adjudication',role:'Claims operations',dependencies:['contract','drugs','rates'],rule:'Pass persisted configuration and claim inputs to the adjudication engine. Offset the original ledger and accumulator movements for reversals.',approval:false},
 {id:'manufacturer',area:6,name:'Manufacturer invoicing',role:'Rebate operations',dependencies:['claims','drugs'],rule:'Build eligible, non-reversed submission lines; require separate acceptance and settlement evidence.',approval:true,external:'settlement'},
 {id:'guarantees',area:3,name:'Rebate guarantees',role:'Finance',dependencies:['claims','manufacturer'],rule:'Apply effective guarantee terms to eligible claims; separate collected manufacturer cash from PBM-funded shortfalls.',approval:false},
 {id:'client',area:5,name:'Client invoicing',role:'Client finance',dependencies:['claims','guarantees','manufacturer'],rule:'Reconcile claim charges, disclosed fees, full rebate credits and guarantee top-ups before releasing a draft.',approval:true},
 {id:'notices',area:7,name:'Nonstandard terms',role:'Contract administration',dependencies:['contract'],rule:'Prepare the required recipient and deadline; approval does not establish delivery. A missed deadline remains a breach.',approval:true,external:'delivery'},
];
export const emptyStep=():Step=>({status:'Not started',output:null,checks:[],attempts:[],approved:false,external:{},version:0});
