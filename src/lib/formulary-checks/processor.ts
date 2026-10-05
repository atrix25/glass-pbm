export type SourceRow = {id:string;page:number;name:string;cells:{drug:string;tier:string;limits:string}};
export type Draft = {id:string;name:string;page:number;classification:'Brand'|'Generic'|null;tier:number|null;PA:true|null;ST:true|null;QL:true|null;SP:true|null;effectiveDate:string;quantityLimit:null;clinicalCriteria:null;issues:string[]};
// Deterministic table translation. No expected-result fixtures or operational writes.
export function compileRows(rows:SourceRow[], effectiveDate:string):Draft[]{
 const ids=new Map<string,number>();for(const row of rows)ids.set(row.id,(ids.get(row.id)??0)+1);
 return rows.map(r=>{
  const issues:string[]=[];
  if(ids.get(r.id)!==1)issues.push('Duplicate source row');
  const labels=r.cells.drug.match(/\b(?:Brand|Generic) drug\b/g)??[];
  const classification=labels.length===1?(labels[0]==='Brand drug'?'Brand':'Generic'):null;
  if(!classification)issues.push('Missing or conflicting classification');
  if(r.cells.drug.replace(/\b(?:Brand|Generic) drug\b/g,'').replace(/\s+/g,' ').trim()!==r.name)issues.push('Drug name differs from source');
  const tier=/^[123]$/.test(r.cells.tier)?Number(r.cells.tier):null;
  if(tier===null)issues.push('Missing or unsupported tier');
  const flags=r.cells.limits.trim()?r.cells.limits.split(',').map(x=>x.trim()):[];
  if(flags.some(f=>!['PA','ST','QL','SP'].includes(f)))issues.push('Uninterpreted restriction text');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||!Number.isFinite(Date.parse(effectiveDate)))issues.push('Missing effective date');
  return {id:r.id,name:r.name,page:r.page,classification,tier,PA:flags.includes('PA')?true:null,ST:flags.includes('ST')?true:null,QL:flags.includes('QL')?true:null,SP:flags.includes('SP')?true:null,effectiveDate,quantityLimit:null,clinicalCriteria:null,issues};
 });
}
