import {hash,type State as ExtractionState,type Requirement as ExtractedRequirement,type Review} from '@/lib/contract-extraction/core';
import type {ProcessState} from './types';
export const MAPPING_FIELDS={copayCents:'Member copay (cents)',quantityLimit:'Quantity limit (per 30 days)',paRequired:'Prior authorization required',stepRequired:'Step therapy required'} as const;
export type Mapping={field:keyof typeof MAPPING_FIELDS;value:number|boolean;rationale:string};
export type ContractLink={extractionId:string;extractionRevision:number;originalHash:string;source:ExtractionState['source'];requirement:ExtractedRequirement;review:Review;mapping:Mapping;actor:string;recordedAt:string};
export function validateMapping(mapping:Mapping){
 if(!Object.hasOwn(MAPPING_FIELDS,mapping.field)||!mapping.rationale.trim())throw Error('Explain the sandbox mapping');
 if(['paRequired','stepRequired'].includes(mapping.field)){if(typeof mapping.value!=='boolean')throw Error('Invalid configuration value');}
 else if(typeof mapping.value!=='number'||!Number.isInteger(mapping.value)||mapping.value<0||mapping.value>100000||(mapping.field==='quantityLimit'&&mapping.value===0))throw Error('Invalid configuration value');
}
export function linkRequirement(state:ProcessState,extraction:ExtractionState,id:string,revision:number,requirementId:string,mapping:Mapping,actor:string){
 validateMapping(mapping);
 if(extraction.status!=='Complete'||extraction.execution!=='model'||hash(extraction.original)!==extraction.originalHash)throw Error('Verified extraction required');
 const requirement=extraction.original.find(r=>r.id===requirementId),review=extraction.reviews.findLast(r=>r.requirementId===requirementId);
 if(!requirement||!review||!['Correct','Corrected'].includes(review.verdict))throw Error('Review the interpretation first');
 if(!requirement.citations.every(c=>c.matched))throw Error('Resolve source citation mismatches first');
 state.contractLink={extractionId:id,extractionRevision:revision,originalHash:extraction.originalHash!,source:structuredClone(extraction.source),requirement:structuredClone(requirement),review:structuredClone(review),mapping:structuredClone(mapping),actor,recordedAt:new Date().toISOString()};
 const term=state.source.terms.contract[0];term.values[mapping.field]=mapping.value;
 term.clause='Reviewed clause with reviewer-defined sandbox configuration';
 // Business dates remain those of the synthetic replay; review recording time is separate.
 // Historical wording is linked evidence, not a declaration of current contract applicability.
 state.baseline=structuredClone(state.source);
 state.events.push({at:state.contractLink.recordedAt,step:'contract',kind:'Reviewed clause linked',actor,detail:`${requirement.title}. ${mapping.field} = ${mapping.value}. Sandbox rationale: ${mapping.rationale}`});
}
