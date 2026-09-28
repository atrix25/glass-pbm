import {SOURCE} from '@/lib/contract-extraction/core';
import {sourceHighlights} from '@/lib/contract-extraction/highlights';
import {ContractPageViewer} from './contract-page-viewer';
export function ContractSourceImage({page,sha256=SOURCE.sha256,citations=[]}:{page:number;sha256?:string;citations?:{page:number;quote:string;matched:boolean}[]}){
 const highlights=sourceHighlights(page,sha256,citations);
 if(!highlights)return <p>Source image unavailable for this document version.</p>;
 const image=`/contracts/wisconsin-etg0013-amendment-1/page-${page}.png`;
 return <figure className="my-4 min-w-0">
  <ContractPageViewer image={image} page={page} {...highlights}/>
  <figcaption className="mt-2 text-xs text-ink-500">Original PDF · page {page}{highlights.boxes.length>0&&' · Referenced language highlighted'} · <a href={`${SOURCE.localUrl}#page=${page}`} target="_blank" rel="noreferrer">Open PDF ↗</a>
   {highlights.missing>0&&<span className="mt-1 block text-amber-800">{highlights.missing} {highlights.missing===1?'passage could':'passages could'} not be located exactly. See quoted text below; no highlight inferred.</span>}
  </figcaption>
 </figure>;
}
