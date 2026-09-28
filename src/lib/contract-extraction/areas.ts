import type {Requirement} from './core';
/** Navigation categorization only; never changes the model's extracted answer. */
export function drugRequirements(requirements:Requirement[]){
 return requirements.filter(r=>r.area==='Drug definitions'||(['Guarantee eligibility','Network','Formulary'].includes(r.area)&&/generic|brand|specialty|limited.distribution|retail.?90|days.? supply|formulary|synthroid|test strips|vaccine|compound/i.test([r.title,...r.citations.map(c=>c.quote)].join(' '))));
}
