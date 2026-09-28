import {expect,it} from 'vitest';
import {drugRequirements} from '../src/lib/contract-extraction/areas';
import {freeze,SOURCE} from '../src/lib/contract-extraction/core';
import {sourceHighlights} from '../src/lib/contract-extraction/highlights';
it('includes drug definitions and related guarantee clauses without including unrelated PA procedures',()=>{
 const requirements=freeze({requirements:[['Drug definitions','Generic classification'],['Guarantee eligibility','Synthroid exclusion'],['Network','Retail 90 threshold'],['Prior authorization','PA procedure'],['Notices','Notice delivery']].map(([area,title])=>({title,area:area as 'Drug definitions',interpretation:'Recorded answer',implementation:'Proposal',conditions:[],missingDependencies:[],evidence:[{page:104,quote:'Unknown'}],tests:[{input:'Case',expected:'Result'}]})),limitations:[]},SOURCE);
 const before=JSON.stringify(requirements);
 expect(drugRequirements(requirements).map(r=>r.title)).toEqual(['Generic classification','Synthroid exclusion','Retail 90 threshold']);
 expect(JSON.stringify(requirements)).toBe(before);
});
it('includes and locates the original brand and generic definitions',()=>{
 for(const [page,quote] of [[101,'BRAND NAME DRUGS: Are defined by MediSpan (or similar organization).'],[104,'GENERIC DRUGS: Are defined by MediSpan (or similar organization).']] as const){
  const requirement=freeze({requirements:[{title:'Classification',area:'Drug definitions',interpretation:'Reference source required',implementation:'Compare to reference',conditions:[],missingDependencies:['Dated drug data'],evidence:[{page,quote}],tests:[{input:'A drug',expected:'Compare source'}]}],limitations:[]},SOURCE)[0];
  expect(requirement.citations[0].matched).toBe(true);
  expect(sourceHighlights(page,SOURCE.sha256,requirement.citations)?.missing).toBe(0);
 }
});
