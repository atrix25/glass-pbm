import type { Evidence } from '../contract-checks/detector';
export type Fault = { id:string;claimId:string;name:string;expectedKind:string;amountCents:number|null;why:string;before:unknown;after:unknown };
export type AnswerKey = { version:string;seed:string;salt:string;originalClaimIds:string[];faults:Fault[] };
export type ChallengePackage = { input:Evidence;cutoff:string;answer:AnswerKey;commitment:string;inputHash:string };
