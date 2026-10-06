import type {Dataset,DraftRow,Check} from './types';
// This verifier reads original target records independently. It never imports the draft builder.
export function verify(data:Dataset,draft:DraftRow[],census:Record<string,number>):Check[]{
 const target=data.snapshots['2026-09'],byId=new Map(draft.map(r=>[r.id,r]));
 const checks:Check[]=[];
 for(const area of Object.keys(census)){
  const source=target.filter(r=>r.area===area),produced=draft.filter(r=>r.area===area);
  let failures=source.length!==census[area]||produced.length!==source.length?1:0;
  for(const row of source){const actual=byId.get(row.id);if(!actual||actual.area!==area){failures++;continue;}
   const keys=Object.keys(row.values).filter(k=>k!=='FORMULARY_VERSION');
   if(Object.keys(actual.values).length!==keys.length||keys.some(k=>actual.values[k]!==row.values[k]))failures++;
  }
  checks.push({name:`${area} · Exact source agreement`,status:failures?'Failed':'Passed',count:source.length,detail:failures?`${failures} mismatches`:'Every selected field agrees with the September source; row totals agree with the independent import census.'});
 }
 checks.push({name:'Unique draft records',status:byId.size===draft.length?'Passed':'Failed',count:draft.length,detail:'No duplicate configuration keys.'});
 checks.push({name:'Complete pharmacy network',status:'Missing evidence',count:0,detail:'Only partition 6 was scanned. No complete-network or access-adequacy claim is supported.'});
 checks.push({name:'Clinical criteria and live implementation',status:'Missing evidence',count:0,detail:'Published PA/ST/QL flags do not provide complete clinical criteria. No operational configuration or claims are connected.'});
 return checks;
}
export function verifyPrices(data:Dataset):Check[]{
 const bad=data.prices.filter(r=>!/^\d{11}$/.test(r.values.NDC)||!/^\d+(\.\d+)?$/.test(r.values['NADAC Per Unit'])||!['EA','ML','GM'].includes(r.values['Pricing Unit']));
 return [{name:'NADAC identifiers, rates and units',status:bad.length?'Failed':'Passed',count:data.prices.length,detail:bad.length?`${bad.length} invalid rows`:'Published decimal strings and units preserved; no prices imputed.'},{name:'Contractual reimbursement',status:'Missing evidence',count:0,detail:'NADAC is a public acquisition-cost reference. It is not the Medicare plan’s contracted reimbursement rate.'}];
}
export function verifyPriceLookups(data:Dataset,outputs:import('./types').PriceLookup[]):Check{
 const groups=new Map<string,typeof data.prices>();for(const r of data.prices){const k=r.values.NDC+':'+r.values['Pricing Unit'];groups.set(k,[...(groups.get(k)??[]),r]);}
 const iso=(s:string)=>{const [m,d,y]=s.split('/');return `${y}-${m}-${d}`;};
 let failures=outputs.length!==data.prices.length?1:0;
 const required=new Set(data.prices.map(r=>r.values.NDC+':'+r.values['Pricing Unit']+':'+iso(r.values['As of Date'])));
 const seen=new Set<string>();
 for(const out of outputs){const key=out.ndc+':'+out.unit+':'+out.asOf;if(seen.has(key)||!required.has(key)||out.effectiveOn!==out.asOf)failures++;seen.add(key);
  const candidates=(groups.get(out.ndc+':'+out.unit)??[]).filter(r=>iso(r.values['As of Date'])<=out.asOf&&iso(r.values['Effective Date'])<=out.effectiveOn);
  let expected:typeof data.prices[number]|undefined;for(const r of candidates)if(!expected||Date.parse(r.values['As of Date'])>Date.parse(expected.values['As of Date'])||r.values['As of Date']===expected.values['As of Date']&&Date.parse(r.values['Effective Date'])>Date.parse(expected.values['Effective Date']))expected=r;
  if(out.sourceId!==(expected?.id??null)||out.rate!==(expected?.values['NADAC Per Unit']??null))failures++;
 }
 return {name:'Dated NADAC lookup agreement',status:failures?'Failed':'Passed',count:outputs.length,detail:failures?`${failures} mismatches`:'Each published NDC/unit/date query independently verified against eligible source rows. Exact decimal rates retained.'};
}
