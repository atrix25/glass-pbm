import Link from 'next/link';
import {DrugReferenceChecks} from './drug-reference-checks';
import {sourceForSponsor} from '@/lib/contract-extraction/core';
import {notFound} from 'next/navigation';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock} from '@/lib/session';
import {recentExtractions,readExtraction} from '@/lib/contract-extraction/service';
import {ASSURANCE_AREAS,relatedRequirements,visibleExtraction,assurancePosition} from '@/lib/operational-assurance/catalog';
import {ContractSourceImage} from './contract-source-image';
import {ExtractionActions} from './contract-extraction-actions';
import css from './operational-assurance.module.css';

export async function OperationalAssuranceWorkspace({area,extractionId,term}:{area?:string;extractionId?:string;term?:string}){
 const sponsor=await selectedSponsor(),clock=await getClock(),position=assurancePosition();
 const selected=ASSURANCE_AREAS.find(a=>a.id===area);
 if(area&&!selected)notFound();
 let extraction:Awaited<ReturnType<typeof readExtraction>>=null;
 if(sourceForSponsor(sponsor)){
  if(extractionId){const candidate=await readExtraction(extractionId,sponsor);if(!candidate)notFound();if(visibleExtraction(candidate.state,sponsor,clock.now))extraction=candidate;}
  else for(const row of await recentExtractions(sponsor)){const candidate=await readExtraction(row.id,sponsor);if(candidate&&visibleExtraction(candidate.state,sponsor,clock.now)){extraction=candidate;break;}}
 }
 const requirements=extraction?.state.original??[],related=selected?relatedRequirements(selected.id,requirements):[];
 const clause=related.find(r=>r.id===term)??(selected?.id==='drugs'?related.find(r=>r.area==='Drug definitions'&&r.citations.some(c=>c.page===101||c.page===104||c.page===13||c.page===14)&&r.citations.every(c=>c.matched)):undefined)??related[0];
 const reviews=extraction?.state.reviews.filter(r=>new Date(r.at)<=clock.now)??[],review=reviews.findLast(r=>r.requirementId===clause?.id);
 const currentReview=extraction?.state.reviews.findLast(r=>r.requirementId===clause?.id);
 const hiddenReview=!!currentReview&&new Date(currentReview.at)>clock.now;
 const url=(id?:string,clauseId?:string)=>'/rebate-protection?'+new URLSearchParams({...(id?{area:id}:{}),...(extraction?{extraction:extraction.id}:{}),...(clauseId?{term:clauseId}:{})});
 return <div className={css.page}>
  <header className={css.header}><div><p className={css.eyebrow}>{sponsor} · Evidence cutoff {clock.now.toISOString().slice(0,10)}</p><h1>Operational assurance</h1><p>Requirements, implementation and the evidence behind each result.</p></div><a className={css.refresh} href={url(selected?.id,clause?.id)}>Refresh</a></header>
  <section className={css.summary} aria-label="Verification coverage"><div><span>Actual records checked</span><strong>{position.recordsChecked}</strong></div><div><span>Areas verified</span><strong>{position.areasVerified} <small>/ 8</small></strong></div><div><span>Discrepancies</span><strong className={css.words}>Not assessed</strong></div><div><span>Areas missing evidence</span><strong>{position.areasMissingEvidence} <small>/ 8</small></strong></div></section>
  <p className={css.coverage}>Implementation evidence is not connected. Contract interpretation is available where sourced; operational results are not yet verified.</p>
  <section className={css.panel} aria-labelledby="areas-title"><div className={css.sectionHead}><h2 id="areas-title">Leakage areas</h2><span>Review each area independently</span></div>
   <div className={css.rows}>{ASSURANCE_AREAS.map((a,i)=>{const count=relatedRequirements(a.id,requirements).length;return <Link key={a.id} href={url(a.id)+'#area-review'} aria-current={a.id===selected?.id?'page':undefined} className={css.row}><span className={css.number}>{String(i+1).padStart(2,'0')}</span><div><strong>{a.name}</strong><p>{a.authority.join(' · ')}</p></div><div className={css.rowEvidence}>{count?`${count} related AI interpretations`:sourceForSponsor(sponsor)&&a.id!=='manufacturer'?(extraction?'No related interpretation':'Source available · Extraction needed'):'Requirement evidence unavailable'}<span>Actual records unavailable</span></div><span className={css.status}>Unable to verify</span><span aria-hidden="true">→</span></Link>;})}</div>
  </section>
  {selected&&<section id="area-review" className={css.detail}>
   <div className={css.sectionHead}><div><p className={css.eyebrow}>Responsible role · {selected.role}</p><h2>{selected.name}</h2></div><span className={css.status}>Unable to verify</span></div>
   {sponsor==='tennessee'&&selected.id==='drugs'&&<><DrugReferenceChecks key={clock.now.toISOString().slice(0,10)}/><details className={css.panel}><summary>Contract rule used in the public-data check · PDF 74</summary><ContractSourceImage page={74} sha256={sourceForSponsor(sponsor)!.sha256} citations={[{page:74,matched:true,quote:'For Discount purposes and other related contract calculations, Single-Source Generics should be considered as Multi Source generics and must not be included in the Brands bucket for the purpose of pricing or guarantee reconciliation.'}]}/></details></>}
   <div className={css.steps}>
    <section className={css.panel}><span className={css.step}>01</span><h3>Requirement</h3><p>{selected.requirement}</p><div className={css.tags}>{selected.authority.map(a=><span key={a}>{a}</span>)}</div><p className={css.note}>Control objective · Not an extracted or approved requirement.</p></section>
    <section className={css.panel}><span className={css.step}>02</span><h3>Actual</h3><strong>Data unavailable</strong><p>{selected.actual}.</p><p className={css.note}>No actual records loaded for this comparison.</p></section>
    <section className={css.panel}><span className={css.step}>03</span><h3>Verification</h3><strong>Not performed</strong><p>{selected.check}</p><p className={css.note}>Planned check · No passing result or loss estimate.</p></section>
    <section className={css.panel}><span className={css.step}>04</span><h3>Resolution</h3><strong>Evidence needed</strong><p>{selected.next}</p><p className={css.note}>No correction applied or resolution verified.</p></section>
   </div>
   <section className={css.panel}><div className={css.sectionHead}><h3>Requirement evidence</h3><span>{related.length?`${related.length} related interpretations`:'Unavailable'}</span></div>
    {!clause?<><p>{selected.id==='manufacturer'?'Manufacturer agreements are unavailable. Client rebate guarantees do not establish manufacturer obligations.':sourceForSponsor(sponsor)?'The public contract is available. No related AI interpretation is recorded at this cutoff. Review the source and run extraction; a missing result does not mean the contract has no requirement.':'The applicable source evidence is unavailable.'}</p>{sourceForSponsor(sponsor)&&selected.id!=='manufacturer'&&<p className={css.note}><Link href="/contract-extraction">Review contract and extract →</Link> · <a href={sourceForSponsor(sponsor)!.localUrl} target="_blank" rel="noreferrer">Open contract ↗</a></p>}<p className={css.note}>Required sources: {selected.authority.join(', ')}. Missing evidence does not establish compliance or the absence of a requirement.</p></>:<>
     <p className={css.note}>{extraction!.state.source.title} · Historical source · Selected pages only. {extraction!.state.source.id.startsWith('tennessee')&&'Redacted public copy; OCR transcription requires image review. Unsigned amendment excluded. '}Related clauses are not a complete set of requirements for this area.</p>
     <details className={css.selector} open={false}><summary>Choose a clause · {clause.title}</summary><nav aria-label="Related contract clauses">{related.map(r=><Link key={r.id} href={url(selected.id,r.id)+'#clause-review'} aria-current={r.id===clause.id?'page':undefined}>{r.title}<small>PDF {Array.from(new Set(r.citations.map(c=>c.page))).join(', ')} · {reviews.findLast(v=>v.requirementId===r.id)?.verdict??'Not reviewed'}</small></Link>)}</nav></details>
     <div id="clause-review" className={css.evidence}><section><h3>Original source</h3>{Array.from(new Set(clause.citations.map(c=>c.page))).map(page=><ContractSourceImage key={page} page={page} sha256={extraction!.state.source.sha256} citations={clause.citations}/>)}<details><summary>Exact quoted text</summary>{clause.citations.map((c,i)=><blockquote key={i}><p>{c.quote}</p><footer>PDF {c.page} · {c.matched?(sponsor==='tennessee'?'OCR wording matched · Verify against image':'Exact wording matched'):'Citation mismatch'}</footer></blockquote>)}</details></section>
      <section><p className={css.eyebrow}>Recorded model output · Interpretation requires review</p><h3>{clause.title}</h3><h4>AI conclusion</h4><p>{clause.interpretation}</p>{clause.conditions.length>0&&<><h4>Conditions and exceptions</h4><ul>{clause.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul></>}
       <h4>Proposed implementation</h4><p>{clause.implementation}</p><p className={css.note}>Proposal only. No actual configuration or transactions changed.</p>
       <div className={css.missing}><h4>Missing evidence</h4>{clause.missingDependencies.length>0&&<ul>{clause.missingDependencies.map((c,i)=><li key={i}>{c}</li>)}</ul>}<p>Actual implementation records and independently approved expected outcomes are unavailable. No operational verification has been performed.</p></div>
       <details className={css.review}><summary>Review interpretation · {review?.verdict??'Not reviewed'}</summary>{review?.correction&&<p>Reviewed interpretation: {review.correction}</p>}{hiddenReview?<p>Review controls are unavailable at this historical cutoff. Return to the current date to review.</p>:<ExtractionActions key={`${clause.id}-${extraction!.revision}`} mode="review" id={extraction!.id} revision={extraction!.revision} requirementId={clause.id} initialVerdict={review?.verdict??'Correct'} initialCorrection={review?.correction??clause.interpretation}/>}</details>
      </section></div>
    </>}
   </section>
  </section>}
  <footer className={css.footer}><span>Updated {new Date().toISOString().replace('T',' ').slice(0,19)} UTC · Refresh to update</span><details><summary>Source tools and history</summary><Link href="/contract-extraction">Contract extraction</Link><Link href="/agents/rebate-protection">Responsible agent</Link><Link href="/rebate-protection?tab=history">Historical demonstrations · Synthetic records</Link></details></footer>
 </div>;
}
