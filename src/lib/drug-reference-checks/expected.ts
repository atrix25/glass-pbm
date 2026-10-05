// Independently transcribed from the public workbook, rows and clause reviewed separately.
// These are published records, not injected faults or operational classifications.
export const EXPECTED_GENERIC_NDCS=['00115169449','72626270101','66993001968','61314063705','68382043528'] as const;
export function verifyOutputs(outputs:{ndc11:string;producedBucket:string|null;issues:string[]}[]){
 const expected=new Set<string>(EXPECTED_GENERIC_NDCS);
 const results=EXPECTED_GENERIC_NDCS.map(ndc=>{const matches=outputs.filter(o=>o.ndc11===ndc);return {ndc11:ndc,expectedBucket:'Generic',status:matches.length===1&&matches[0].producedBucket==='Generic'&&!matches[0].issues.length?'Passed':'Failed'};});
 const unexpected=outputs.filter(o=>o.producedBucket!==null&&!expected.has(o.ndc11)).map(o=>o.ndc11);
 return {results,unexpected,passed:results.filter(r=>r.status==='Passed').length,failed:results.filter(r=>r.status==='Failed').length+unexpected.length};
}
