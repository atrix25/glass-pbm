import Link from 'next/link';
import {STAGES,type ProcessState,type Area} from '@/lib/assurance/process/types';
import {ProcessActions} from './process-actions';
import styles from './rebate-protection.module.css';
export function ProcessGuide({id,revision,state,area}:{id:string;revision:number;state:ProcessState;area:Area}){
 const stage=STAGES.find(s=>s.id===area)!,step=state.steps[area],blocked=stage.dependencies.filter(d=>state.steps[d].status!=='Released'),next=STAGES.filter(s=>s.dependencies.includes(area));
 const heading=step.status==='Not started'?'Build and check the configuration':step.status==='Awaiting review'?'Review the checked result':step.status==='Released'?'Follow the downstream result':step.status==='Failed'?'Resolve the failed check':step.status==='Awaiting evidence'?'Record the external evidence':step.status==='Rejected'?'Review rejected':step.status==='Missing evidence'?'Source evidence is missing':'Complete the upstream step';
 return <section className={styles.panel}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{stage.name} · Next action</span><h2>{heading}</h2></div><span className={styles.badge}>{step.status}</span></div>
 <ol aria-label="Implementation journey" className="my-5 grid list-inside list-decimal gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">{['Read clause','Review meaning','Set configuration','Test result','Approve release','Follow effects'].map((label,i)=><li className="rounded-lg border border-ink-100 p-3" key={label}><a href={i<3?'#expected-configuration':i===3?'#flow-checks':i===4?'#guided-action':'#next-destination'}>{label}</a></li>)}</ol>
 {state.contractLink?<p className={styles.note}>Linked to your {state.contractLink.review.verdict.toLowerCase()} interpretation. The source, verdict and sandbox mapping are frozen with this run.</p>:<p className={styles.note}>Synthetic demonstration. <Link href="/rebate-protection">Start from a reviewed contract clause →</Link></p>}
 {blocked.length>0&&<p>Required first: {blocked.map(d=><Link className="mr-3 underline" key={d} href={`/rebate-protection?run=${id}&area=${d}&tab=process`}>{STAGES.find(s=>s.id===d)!.name} →</Link>)}</p>}
 {step.status==='Awaiting review'&&<p>The recorded checks passed. Approval releases this sandbox output to the next stages; it does not change real benefits.</p>}
 {step.status==='Failed'&&<p>The configuration has not been released. Inspect Expected and Produced below, then repair the working data where a deterministic correction is available.</p>}
 {step.status==='Rejected'&&<p>This output remains blocked. Start a new flow to revise the proposed setting; the rejection remains in this record.</p>}
 <div id="guided-action" className="mt-5"><ProcessActions id={id} revision={revision} step={area} state={step} repairable={!!state.overrides[area]&&step.status==='Failed'}/></div>
 {step.status==='Released'&&<div className="mt-4"><ProcessActions id={id} revision={revision} testsFor={area}/></div>}
 {step.status==='Released'&&<div className="mt-4 flex flex-wrap gap-4">{next.map(s=><Link className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm" key={s.id} href={`/rebate-protection?run=${id}&area=${s.id}&tab=process`}>Continue to {s.name.toLowerCase()} →</Link>)}<Link href={`/rebate-protection?run=${id}&area=${area}&tab=evidence`}>View recorded evidence →</Link></div>}
 </section>;
}
