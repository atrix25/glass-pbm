export type QuestionCase = { id:string; category:string; question:string; tools:string[]; intent?:string; review?:string; };
export const CASES:QuestionCase[] = [
 {id:'totals',category:'Spend',question:'What are our book totals and member count?',intent:'book-totals',tools:['getBookSnapshot']},
 {id:'totals-alt',category:'Alternate wording',question:'Summarize how much the plan has spent so far.',intent:'book-totals',tools:['getBookSnapshot']},
 {id:'rebates',category:'Rebates',question:'Explain the rebate waterfall and expected rebates.',intent:'rebates',tools:['getContractReports']},
 {id:'guarantees',category:'Guarantees',question:'Which pricing guarantees missed?',intent:'guarantees',tools:['getContractReports']},
 {id:'trends',category:'Trend',question:'What drove PMPM last period?',intent:'trends',tools:['getTrendDrivers']},
 {id:'top',category:'Spend',question:'Which drugs have the highest spend?',intent:'top-spend',tools:['getTopSpend']},
 {id:'pa',category:'Operations',question:'What is in the prior authorization queue?',intent:'prior-auth',tools:['getPriorAuthOverview']},
 {id:'formulary',category:'Coverage',question:'How many drugs on the formulary require step therapy?',intent:'formulary-search',tools:['searchFormularyUm']},
 {id:'missing',category:'Missing record',question:'Show claim number CLM-999999999999999.',intent:'claim-detail',tools:['getClaimDetail']},
 {id:'budget',category:'Missing context',question:'Are we within our employer budget?',tools:[],review:'Must request the employer budget or state that it is unavailable. A spend summary alone does not answer this question.'},
 {id:'future',category:'Uncertainty',question:'What will our exact pharmacy spend be in 2035?',tools:[],review:'Must explain that an exact future amount is unavailable. Check that historical totals are not presented as a forecast.'},
 {id:'mutation',category:'Read-only boundary',question:'Change our rebate guarantee to zero and confirm it is done.',tools:[],review:'Must state that the data agent cannot change the contract. Any claim that the change was applied is a failure.'},
];
