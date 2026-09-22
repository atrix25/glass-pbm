import type { DataAnswer } from '@/lib/agents/data-agent/agent';
import type { QuestionCase } from './cases';
export type Check = {label:string; status:'pass'|'review'|'fail'; detail:string};
export function evaluateAnswer(test:QuestionCase,answer:DataAnswer):Check[]{
 const checks:Check[]=[];
 const add=(label:string,ok:boolean,detail:string)=>checks.push({label,status:ok?'pass':'fail',detail});
 add('Response recorded',answer.paragraphs.some(p=>p.trim()),'An answer must contain text.');
 add('Tool execution',answer.work.every(w=>!w.error),'Any returned tool error fails this check.');
 if(test.intent)add('Question routing',answer.intent===test.intent,`Expected ${test.intent}; recorded ${answer.intent}.`);
 for(const tool of test.tools)add('Required evidence',answer.work.some(w=>w.tool===tool&&!w.error),`Expected successful ${tool}.`);
 if(test.tools.length&&test.id!=='missing')add('Sources included',answer.citations.length>0,'Checks source presence, not whether each claim is supported by that source.');
 if(test.intent==='book-totals'){
  const snapshot=answer.work.find(w=>w.tool==='getBookSnapshot')?.data as {totals?:{members:number;claimsPaid:number;totalBilledCents:number}}|undefined;
  const totals=snapshot?.totals,text=answer.paragraphs.join(' ');
  const values=totals?[totals.members.toLocaleString('en-US'),totals.claimsPaid.toLocaleString('en-US'),new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(totals.totalBilledCents/100)]:[];
  checks.push({label:'Book totals in answer',status:values.length&&values.every(v=>text.includes(v))?'pass':'review',detail:`Expected members, paid claims and exact billed total from recorded tool evidence: ${values.join(' · ')||'Unavailable'}. Different formatting needs review. This checks presence, not the meaning of every sentence.`});
 }
 if(test.id==='missing'){
  const data=answer.work.find(w=>w.tool==='getClaimDetail')?.data as {found?:boolean}|undefined;
  add('Missing record acknowledged',data?.found===false&&/no claim matched|not found|could not find|no.*claim.*match/i.test(answer.paragraphs.join(' ')),'A nonexistent claim must not acquire invented details.');
 }
 if(test.review)checks.push({label:'Answer judgment',status:'review',detail:test.review});
 checks.push({label:'Factual accuracy',status:'review',detail:'Not automatically verified. Compare the answer with the recorded tool evidence; source presence and routing do not prove factual accuracy.'});
 return checks;
}
export function outcome(checks:Check[]){return checks.some(c=>c.status==='fail')?'Check failed':checks.some(c=>c.status==='review'&&c.label!=='Factual accuracy')?'Needs review':'Checks passed';}
