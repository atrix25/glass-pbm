import type {Specimen} from '@/lib/assurance/types';

export function ContractLanguage({record,cutoff}:{record?:Specimen;cutoff:string}) {
  const terms=record?.requirements.filter(t=>t.recordedAt<=cutoff&&t.from<=record.serviceAt&&t.to>=record.serviceAt&&t.population===record.population&&t.approved)??[];
  return <section className="min-w-0" aria-label="Contract language">
    <h3>Contract language</h3>
    {!terms.length?<p>No applicable source term. Not verified.</p>:<>
      {terms.length>1&&<p className="text-amber-800">Conflicting terms · Not verified</p>}
      {terms.map(term=>{
        const source=term.source&&term.source.recordedAt<=cutoff?term.source:null;
        const url=source?.url&&/^https?:\/\//.test(source.url)?source.url:null;
        return <div key={`${term.id}-${term.version}`} className="mb-3 space-y-3 rounded-lg border border-ink-100 bg-ink-50 p-4 text-sm">
          <span className="text-xs font-medium text-ink-500">{source?.kind==='contract'?'Contract excerpt':source?'Synthetic clause':'Original text not loaded'}</span>
          {source?<blockquote className="whitespace-pre-wrap border-l-2 border-ink-200 pl-3 leading-relaxed">{source.text}</blockquote>:<><p>Exact contract language is unavailable. This check uses a synthetic requirement.</p><p className="text-ink-500">{term.clause}</p></>}
          {source&&<p>{source.document} · {source.location}{source.kind==='synthetic'?' · Demo assumption':''}</p>}
          {url&&<a href={url} target="_blank" rel="noreferrer">Open source ↗</a>}
          <p className="text-ink-500">Version {term.version} · {term.from} – {term.to}<br/>{term.population}</p>
          {!source&&<details><summary>Stored requirement</summary><dl className="mt-3 space-y-2">{Object.entries(term.values).map(([key,value])=><div key={key} className="break-words"><dt className="text-ink-500">{key}</dt><dd>{String(value??'Not recorded')}</dd></div>)}</dl></details>}
        </div>;
      })}
    </>}
  </section>;
}
