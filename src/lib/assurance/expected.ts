import type {Values} from './types';
/** Hand-authored arithmetic. Does not import adjudication, detector or repair. */
export function adjudicationExpectation(variant:string):Values{
 if(['eligibility','network','coverage','pa','step','quantity'].includes(variant))return {status:'R',billedCents:0,memberCents:0,planCents:0};
 if(variant==='reversal')return {status:'Reversed',billedCents:0,memberCents:0,planCents:0};
 // Submitted ingredient $10 + $1 fee. Copay $5, or $1 remaining OOP limit.
 return {status:'P',billedCents:1100,memberCents:variant==='accumulator'?100:500,planCents:variant==='accumulator'?1000:600};
}
