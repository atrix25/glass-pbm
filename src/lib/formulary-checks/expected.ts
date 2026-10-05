import type {Draft} from './processor';
// Separately authored from visual inspection of the original PDF pages, not compiler output.
// These are development reference cases, NOT user review decisions or a complete formulary audit.
export const expected = [
 ['p22-r3','ADDERALL TAB 5MG','Brand',3,true,null,null,null],
 ['p22-r18','amphetamine sulfate tabs 5mg, 10mg','Generic',1,null,null,null,null],
 ['p64-r3','GVOKE KIT SOLN 1MG/0.2ML','Brand',2,null,null,null,null],
 ['p64-r5','mifepristone (hyperglycemia) tabs 300mg','Generic',1,true,null,true,true],
 ['p64-r10','saxagliptin hcl tabs 2.5mg, 5mg','Generic',1,null,null,null,null],
 ['p64-r19','OZEMPIC SOPN 2MG/3ML, 4MG/3ML, 8MG/3ML; TABS 1.5MG, 4MG, 9MG','Brand',2,true,null,null,null],
 ['p124-r1','SOFDRA GEL 12.45%','Brand',3,true,true,true,null],
 ['p124-r2','XERAC AC SOLN 6.25%','Brand',3,null,null,null,null],
 ['p124-r4','EUCRISA OINT 2%','Brand',2,true,null,null,null],
 ['p124-r27','ORACEA CPDR 40MG','Brand',1,null,null,null,null],
 ['p124-r36','permethrin crea 5%','Generic',1,null,null,null,null],
 ['p124-r37','PERMETHRIN CREA 5%','Brand',3,true,null,null,null],
] as const;
export function verifyDrafts(outputs:Draft[]){
 return expected.map(([id,name,classification,tier,PA,ST,QL,SP])=>{
  const matches=outputs.filter(o=>o.id===id),o=matches[0];
  const wanted={name,classification,tier,PA,ST,QL,SP,effectiveDate:'2026-10-01',quantityLimit:null,clinicalCriteria:null};
  const differences=Object.entries(wanted).filter(([k,v])=>!o||o[k as keyof Draft]!==v).map(([k])=>k);
  if(matches.length!==1)differences.push('row count');if(o?.issues.length)differences.push('source validation');
  return {id,expected:wanted,differences,status:differences.length?'Failed':'Passed'};
 });
}
