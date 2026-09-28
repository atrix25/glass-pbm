import Link from 'next/link';
import {notFound} from 'next/navigation';
import {recentExtractions,readExtraction} from '@/lib/contract-extraction/service';
import {drugRequirements} from '@/lib/contract-extraction/areas';
import {available} from '@/lib/contract-extraction/extract';
import {ExtractionActions} from './contract-extraction-actions';
import {ContractSourceImage} from './contract-source-image';
import styles from './rebate-protection.module.css';
export async function DrugContractReview({sponsor,extractionId,term}:{sponsor:string;extractionId?:string;term?:string}){
 if(sponsor!=='wisconsin')return <section className={styles.panel}><span className={styles.eyebrow}>Drug definitions · Contract review</span><h2>Contract data unavailable</h2><p>The selected contract’s drug definition clauses and supporting drug lists are not available in this review.</p><p className="mt-3">AI interpretation: unavailable. Drug classification checks: not performed.</p><p className={styles.note}>Required: the applicable contract definitions, exhibits and dated drug reference lists. Another sponsor’s contract will not be substituted.</p></section>;
 const recent=await recentExtractions(sponsor);
 const extraction=await readExtraction(extractionId??recent[0]?.id??'',sponsor);
 if(extractionId&&!extraction)notFound();
 const state=extraction?.state,requirements=state?.status==='Complete'?drugRequirements(state.original):[];
 const selected=requirements.find(r=>r.id===term)??requirements.find(r=>r.area==='Drug definitions'&&r.citations.some(c=>c.page===101||c.page===104)&&r.citations.every(c=>c.matched))??requirements[0];
 const review=state?.reviews.findLast(r=>r.requirementId===selected?.id);
 const running=state?.status==='Queued'||state?.status==='Running';
 return <section className={styles.panel} id="drug-contract-review">
  <span className={styles.eyebrow}>Drug definitions · Contract review</span><h2>Source and AI interpretation</h2>
  <p className="mb-4">Select a clause. Compare the highlighted contract language with the AI’s conclusion, then record your verdict.</p>
  <p className={styles.note}>Historical Wisconsin ETF / Navitus contract · Not a statement of current plan terms. Review records belong to the selected sponsor.</p>
  <details className="my-4"><summary>Extraction details</summary><p>{state?.model??'No model result'} · {state?.status??'Not extracted'} · {requirements.length} related clauses</p><p>Selected pages only. A matched quotation does not establish a correct interpretation or complete coverage.</p>{state&&!state.source.pages.some(p=>p.page===104)&&<p>Brand and generic definition pages were not included in this older extraction. Extract again to include them.</p>}<ExtractionActions mode="create" configured={available()} returnArea="drugs"/></details>
  {running&&<div role="status"><p>AI extraction in progress. The recorded answer will appear here.</p><ExtractionActions mode="create" running configured={false} returnArea="drugs"/></div>}
  {state?.status==='Failed'&&<><p>Extraction failed. No substitute answer was generated.</p><ExtractionActions mode="retry" id={extraction!.id} revision={extraction!.revision}/></>}
  {!state&&<><p>No AI extraction is recorded for this sponsor. Extract the public reference contract to begin.</p><ExtractionActions configured={available()} returnArea="drugs"/></>}
  {state?.status==='Complete'&&!selected&&<p>No drug definition clauses were identified in this extraction. This is not a finding that the contract has none. Review the source or extract again.</p>}
  {selected&&<>
   <nav aria-label="Drug definition clauses" className="my-5 grid max-h-72 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">{requirements.map(r=><Link key={r.id} href={`/rebate-protection?area=drugs&tab=process&extraction=${extraction!.id}&term=${r.id}#drug-contract-review`} aria-current={r.id===selected.id?'page':undefined} className={`rounded-lg border p-3 text-sm ${r.id===selected.id?'border-amber-500 bg-amber-50':'border-ink-200 bg-white'}`}><strong>{r.title}</strong><span className="mt-1 block text-xs text-ink-500">PDF {r.citations.map(c=>c.page).filter((p,i,a)=>a.indexOf(p)===i).join(', ')} · {state!.reviews.findLast(x=>x.requirementId===r.id)?.verdict??'Not reviewed'}</span></Link>)}</nav>
   <h3>{selected.title}</h3>
   <div className="mt-4 grid items-start gap-6 lg:grid-cols-2"><section><h3>Contract source</h3>{[...new Set(selected.citations.map(c=>c.page))].map(page=><ContractSourceImage key={page} page={page} sha256={state!.source.sha256} citations={selected.citations}/>)}<details><summary>Exact quoted text</summary>{selected.citations.map((c,i)=><div key={i}><p>PDF page {c.page} · {c.matched?'Exact text matched':'Citation mismatch'}</p><blockquote className="my-3 border-l-2 border-amber-400 pl-3">{c.quote}</blockquote></div>)}</details></section>
   <section><h3>AI conclusion</h3><p className="mt-3">{selected.interpretation}</p>{selected.conditions.length>0&&<><h4 className="mt-5 font-medium">Conditions and exceptions</h4><ul className={styles.list}>{selected.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul></>}
   <h4 className="mt-5 font-medium">Proposed implementation</h4><p>{selected.implementation}</p><p className={styles.note}>Proposal only · No configuration has been changed by this review.</p>
   {selected.missingDependencies.length>0&&<div className="my-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><h4 className="font-medium">Evidence still needed</h4><ul className={styles.list}>{selected.missingDependencies.map((c,i)=><li key={i}>{c}</li>)}</ul></div>}
   <div className="my-5 rounded-lg border border-ink-200 p-4"><h4 className="font-medium">Verification data unavailable</h4><p>The contract text is available. The applicable dated drug reference files and actual implementation records are not loaded for comparison.</p><p className={styles.note}>Checks not performed · No substitute drug records or test results.</p></div>
   <div className="mt-5 border-t border-ink-200 pt-5"><h4 className="mb-3 font-medium">Your review · {review?.verdict??'Not reviewed'}</h4>{review?.correction&&<p>Reviewed interpretation: {review.correction}</p>}<ExtractionActions key={`${selected.id}-${extraction!.revision}`} mode="review" id={extraction!.id} revision={extraction!.revision} requirementId={selected.id} initialVerdict={review?.verdict??'Correct'} initialCorrection={review?.correction??selected.interpretation}/></div>
   </section></div>
  </>}
 </section>;
}
