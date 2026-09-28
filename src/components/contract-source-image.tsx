import Image from 'next/image';
import {SOURCE} from '@/lib/contract-extraction/core';
export function ContractSourceImage({page,sha256=SOURCE.sha256}:{page:number;sha256?:string}){
 if(sha256!==SOURCE.sha256||!SOURCE.pages.some(p=>p.page===page))return <p>Source image unavailable for this document version.</p>;
 const image=`/contracts/wisconsin-etg0013-amendment-1/page-${page}.png`;
 return <figure className="my-4 min-w-0"><a href={image} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-ink-200 bg-white"><Image src={image} alt={`Original Wisconsin ETF / Navitus contract, PDF page ${page}. Open to zoom and read the full page.`} width={1224} height={1584} unoptimized className="h-auto w-full"/></a><figcaption className="mt-2 text-xs text-ink-500">Original PDF · page {page} · <a href={image} target="_blank" rel="noreferrer">Enlarge image ↗</a> · <a href={`${SOURCE.localUrl}#page=${page}`} target="_blank" rel="noreferrer">Open PDF ↗</a></figcaption></figure>;
}
