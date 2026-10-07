import publicSource from '../../../data/realistic-book/prices.json';
import type {Book} from './core';
export function verify(book:Book){
 const sourceRows=new Map(publicSource.rows.map(r=>[r.line,r]));
 const claims=book.claims,paid=claims.filter(c=>c.status==='Paid'),byId=new Map(claims.map(c=>[c.id,c]));
 const result=(name:string,passed:boolean,detail:string)=>({name,passed,detail});
 const seen=new Map<string,{ded:number;oop:number}>();let chronological=true,accumValid=true;
 for(const c of claims){const previous=seen.get(c.memberId)??{ded:0,oop:0};if(previous.ded!==c.deductibleBefore||previous.oop!==c.oopBefore)accumValid=false;seen.set(c.memberId,{ded:c.deductibleAfter,oop:c.oopAfter});}
 for(let i=1;i<claims.length;i++)if(claims[i].date<claims[i-1].date)chronological=false;
 const entries=book.journal;
 return [result('Claim allocations',claims.every(c=>Number.isSafeInteger(c.allowed)&&c.allowed===c.member+c.employer),'Allowed cost equals member plus employer liability, including signed reversals.'),
 result('Journal balance',entries.every(j=>j.lines.reduce((n,l)=>n+l.debit-l.credit,0)===0&&j.lines.every(l=>l.debit>=0&&l.credit>=0)),'Every entry has equal debits and credits.'),
 result('Dated public references',paid.every(c=>!!c.price&&c.price.asOf<=c.date&&c.price.effective<=c.date),'No future NADAC snapshot or effective price used.'),
 result('Public source identity',paid.every(c=>{const r=sourceRows.get(c.price!.line);return !!r&&r.NDC===c.ndc&&r['NDC Description']===c.drug&&r['Pricing Unit']===c.unit&&r['NADAC Per Unit']===c.price!.rate;}),'Drug identifier, description, unit and exact rate agree with the retained public CSV row.'),
 result('Source pricing calculation',paid.every(c=>c.allowed===Math.floor((Math.round(Number(c.price!.rate)*1000000)*Math.round(c.quantity*1000)+5000000)/10000000)+(c.channel==='Specialty'?800:c.channel==='Mail'?400:200)),'Independently recomputed NADAC × quantity and disclosed channel fee in cents.'),
 result('Benefit calculation',paid.every(c=>{const m=book.members.find(m=>m.id===c.memberId)!;const room=250000-c.oopBefore;let deduction=0,share=0;if(m.plan==='HDHP'){deduction=c.ndc==='70010006310'?0:Math.min(c.allowed,50000-c.deductibleBefore,room);share=deduction+Math.round((c.allowed-deduction)/5);}else share=c.tier==='Specialty'?Math.min(15000,Math.round(c.allowed/5)):(c.tier==='Brand'?4500:1000)*(c.channel==='Mail'?2:1);return c.member===Math.min(c.allowed,room,share)&&c.deductibleAfter===c.deductibleBefore+deduction&&c.oopAfter===c.oopBefore+c.member;}),'Independently checks deductible application, exempt drug, copays, coinsurance and OOP maximum.'),
 result('Enrollment',paid.every(c=>{const m=book.members.find(m=>m.id===c.memberId);return !!m&&m.start<=c.date&&(!m.end||m.end>=c.date); }),'Paid service dates fall within member coverage.'),
 result('Accumulator continuity',accumValid&&chronological&&claims.every(c=>c.oopAfter>=0&&c.oopAfter<=250000&&c.deductibleAfter>=0&&c.deductibleAfter<=50000),'Chronological individual balances, reversal restoration and plan maximums.'),
 result('Reversal offsets',claims.filter(c=>c.status==='Reversal').every(c=>{const o=byId.get(c.originalId??'');return !!o&&c.allowed===-o.allowed&&c.member===-o.member&&c.employer===-o.employer;}),'Reversals exactly offset their original transaction.'),
 result('Rejected and unknown claims',claims.filter(c=>c.status==='Rejected'||c.status==='Not verified').every(c=>c.allowed===0&&c.member===0&&c.employer===0&&c.oopBefore===c.oopAfter),'No payment or accumulator movement for non-payable submissions.'),
 result('Rebate population and attribution',book.rebates.every(r=>r.entitlement===r.claimIds.reduce((n,id)=>n+(byId.get(id)?.rebate??NaN),0)&&r.claimIds.every(id=>!claims.some(c=>c.status==='Reversal'&&c.originalId===id))),'Only net eligible paid fills; no reversed-claim rebates.'),
 result('Employer rebate entitlement',book.rebates.filter(r=>r.due<=book.cutoff).every(r=>{const credit=entries.find(j=>j.id===r.id+'-credit');return credit?.lines.find(l=>l.account==='Employer receivable')?.credit===r.entitlement;}),'Full entitlement credited even where manufacturer collection is partial.'),
 result('No future postings',entries.every(j=>j.date<=book.cutoff),'Future reconciliation and cash receipts remain outstanding.'),
 result('Claim posting completeness',paid.every(c=>{const fee=entries.find(j=>j.id===c.id+'-fee');const liability=entries.find(j=>j.id===c.id+'-claim');return fee?.lines.find(l=>l.account==='Employer receivable')?.debit===200&&(c.employer===0||liability?.lines.find(l=>l.account==='Employer receivable')?.debit===c.employer); }),'Each paid submission has its disclosed fee and nonzero employer liability; reversals are separate offsets.'),
 result('Unique identifiers',byId.size===claims.length&&new Set(entries.map(j=>j.id)).size===entries.length,'No duplicate claim or journal IDs.')];
}
