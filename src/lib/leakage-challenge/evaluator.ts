import type { Detection } from '../contract-checks/detector';
import type { AnswerKey } from './types';
/** Scores a frozen detector output. Never calls or modifies the detector. */
export function score(answer:AnswerKey,result:Detection){
 const alerts=result.findings.filter(f=>f.category!=='timing'&&f.category!=='economics');
 const used=new Set<number>();
 const outcomes=answer.faults.map(f=>{
  const i=alerts.findIndex((a,j)=>!used.has(j)&&a.claimId===f.claimId&&a.kind===f.expectedKind);
  if(i>=0)used.add(i);
  const finding=i>=0?alerts[i]:null;
  const status=!finding?'Missed':finding.amountCents===f.amountCents?'Detected':'Amount mismatch';
  return {...f,status,finding};
 });
 const falsePositives=alerts.filter((_,i)=>!used.has(i));
 const detected=outcomes.filter(o=>o.status==='Detected').length,amountMismatches=outcomes.filter(o=>o.status==='Amount mismatch').length,missed=outcomes.filter(o=>o.status==='Missed').length;
 const corrupted=new Set(answer.faults.map(f=>f.claimId)),cleanClaims=answer.originalClaimIds.filter(id=>!corrupted.has(id)).length;
 const cleanClaimsFlagged=new Set(falsePositives.filter(f=>!corrupted.has(f.claimId)).map(f=>f.claimId)).size;
 return {outcomes,falsePositives,detected,amountMismatches,missed,injected:outcomes.length,cleanClaims,cleanClaimsFlagged,
  detectionRate:outcomes.length?(detected+amountMismatches)/outcomes.length:null,
  exactRate:outcomes.length?detected/outcomes.length:null,
  precision:alerts.length?used.size/alerts.length:null,
  falsePositiveRate:cleanClaims?cleanClaimsFlagged/cleanClaims:null,
  unquantified:outcomes.filter(o=>o.amountCents===null).length,
  observedAt:result.cutoff,
 };
}
export type ChallengeScore=ReturnType<typeof score>;
