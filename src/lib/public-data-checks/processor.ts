import type {SourceRow,DraftRow,Change} from './types';
// Preserve source values exactly; these are draft reference configurations, not adjudication rules.
export function project(row:SourceRow):DraftRow{
 const values={...row.values};delete values.FORMULARY_VERSION;
 return {id:row.id,area:row.area,values};
}
export function compare(before:SourceRow[],after:SourceRow[]):Change[]{
 const a=new Map(before.map(r=>[r.id,project(r)])),b=new Map(after.map(r=>[r.id,project(r)]));
 if(a.size!==before.length||b.size!==after.length)throw Error('Duplicate source keys');
 const changes:Change[]=[];
 for(const id of [...new Set([...a.keys(),...b.keys()])].sort()){
  const old=a.get(id),next=b.get(id);
  const fields=[...new Set([...Object.keys(old?.values??{}),...Object.keys(next?.values??{})])].filter(k=>old?.values[k]!==next?.values[k]);
  if(!old||!next||fields.length)changes.push({id,area:(next??old)!.area,kind:!old?'Added':!next?'Removed':'Changed',fields});
 }
 return changes;
}
export function buildDraft(before:SourceRow[],after:SourceRow[],changes:Change[]):DraftRow[]{
 const working=new Map(before.map(r=>[r.id,project(r)])),target=new Map(after.map(r=>[r.id,r]));
 for(const patch of changes){
  if(patch.kind==='Removed')working.delete(patch.id);
  else {const row=target.get(patch.id);if(!row)throw Error('Missing patch source');working.set(patch.id,project(row));}
 }
 return [...working.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function priceAt(rows:SourceRow[],ndc:string,unit:string,asOf:string,effectiveOn:string){
 // Lexicographic comparison uses ISO dates; publication and effective dates are independent.
 const iso=(s:string)=>{const [m,d,y]=s.split('/');return `${y}-${m}-${d}`;};
 const eligible=rows.filter(r=>r.values.NDC===ndc&&r.values['Pricing Unit']===unit&&iso(r.values['As of Date'])<=asOf&&iso(r.values['Effective Date'])<=effectiveOn);
 eligible.sort((a,b)=>iso(b.values['As of Date']).localeCompare(iso(a.values['As of Date']))||iso(b.values['Effective Date']).localeCompare(iso(a.values['Effective Date'])));
 return eligible[0]??null;
}
export function buildPriceLookups(rows:SourceRow[]):import('./types').PriceLookup[]{
 const groups=new Map<string,SourceRow[]>();
 for(const r of rows){const key=r.values.NDC+':'+r.values['Pricing Unit'];groups.set(key,[...(groups.get(key)??[]),r]);}
 return rows.map(r=>{const [m,d,y]=r.values['As of Date'].split('/'),date=`${y}-${m}-${d}`,ndc=r.values.NDC,unit=r.values['Pricing Unit'],found=priceAt(groups.get(ndc+':'+unit)!,ndc,unit,date,date);return {ndc,unit,asOf:date,effectiveOn:date,sourceId:found?.id??null,rate:found?.values['NADAC Per Unit']??null};});
}
