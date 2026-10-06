import type {State} from './core';
// Independently authored expected outcomes. Never imported by pricing or repair.
export function verify(s:State){
 const check=(name:string,passed:boolean,detail:string)=>({name,passed,detail});
 const original=s.original,claims=s.claims;
 const invoice=s.ledger.filter(e=>e.account==='Employer invoice').reduce((n,e)=>n+e.amount,0);
 return [check('Exact claim amounts',s.config.cashCap&&s.config.copay===2000&&claims.length===100&&claims.every((c,i)=>c.id===`SYN-C${String(i+1).padStart(3,'0')}`&&c.allowed===(i<10?8000:5000)&&c.memberPaid===(i<10?2000:1000)&&c.employer===(i<10?6000:4000)),'10 target claims: $80 allowed, $20 member, $60 employer. 90 controls: $50 / $10 / $40.'),
 check('Unchanged members',claims.slice(10).every((c,i)=>JSON.stringify(c)===JSON.stringify(original[i+10])),'90 control claims retain every field.'),
 check('Employer invoice',invoice===435000,'$4,200 employer claim cost + $200 fees − $50 rebate credit = $4,350.'),
 check('Every rebate dollar',s.ledger.find(e=>e.id==='manufacturer-receipt')?.amount===5000&&s.ledger.find(e=>e.id==='rebate-credit')?.amount===-5000,'$50 collected and $50 credited. No rebate retention.'),
 check('Balanced correction',s.ledger.find(e=>e.id==='pharmacy-recovery')?.amount===42000&&s.ledger.find(e=>e.id==='member-refund')?.amount===20000&&s.ledger.find(e=>e.id==='invoice-adjustment')?.amount===-22000,'$420 pharmacy recovery = $200 member refund + $220 employer credit. Count economic benefit once.'),
 check('Approval and settlement',!!s.reviewer&&s.events.some(e=>e.role==='Benefits / Finance · Simulated review'&&e.action.startsWith('Approved'))&&s.ledger.filter(e=>['member-refund','pharmacy-recovery'].includes(e.id)).length===2&&s.ledger.every(e=>e.status!=='Pending'),'Recorded simulated approval and external confirmations required.'),
 check('Unique transactions',new Set(s.ledger.map(e=>e.id)).size===s.ledger.length&&claims.slice(0,10).every(c=>s.ledger.find(e=>e.id===c.id+'-reversal')?.amount===-12200&&s.ledger.find(e=>e.id===c.id+'-replacement')?.amount===8000),'Repeated commands must not create another adjustment or refund.')];
}
