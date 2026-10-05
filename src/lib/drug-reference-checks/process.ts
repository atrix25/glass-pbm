// Deterministic demonstration processor. It does not import expected answers.
export type SourceRecord={sourceRow:number;ndc11:string;description:string;manufacturer:string;reportedBrandGeneric:string;publishedSourceType:string;reportCategory:string;classificationEffectiveDate:unknown;sourceCells:Record<string,string>};
export function processRecords(records:SourceRecord[]){
 const counts=new Map<string,number>();for(const r of records)counts.set(r.ndc11,(counts.get(r.ndc11)??0)+1);
 return records.map(r=>{
  const issues:string[]=[];
  if(!/^\d{11}$/.test(r.ndc11))issues.push('Invalid NDC');
  if(counts.get(r.ndc11)!==1)issues.push('Duplicate NDC');
  if(!['generic','brand'].includes(r.reportedBrandGeneric))issues.push('Missing classification');
  if(!['Single Source','Multi-Source'].includes(r.publishedSourceType))issues.push('Missing source type');
  if(r.sourceCells.C!==r.ndc11||r.sourceCells.F!==r.publishedSourceType||r.sourceCells.A!==r.reportCategory)issues.push('Source mismatch');
  if(!r.reportCategory.startsWith(r.reportedBrandGeneric==='generic'?'Generic ':'Brand '))issues.push('Conflicting classification');
  const applies=r.reportedBrandGeneric==='generic'&&r.publishedSourceType==='Single Source';
  return {...r,issues,processing:issues.length?'Blocked':applies?'Processed':'Outside this rule',producedBucket:!issues.length&&applies?'Generic':null,historicalStatus:'Missing evidence' as const};
 });
}
