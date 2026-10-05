'use client';
import Image from 'next/image';
import {useId,useRef} from 'react';
import type {HighlightBox} from '@/lib/contract-extraction/highlights';

export function ContractPageViewer({image,page,width,height,boxes,label='Contract'}:{image:string;page:number;width:number;height:number;boxes:HighlightBox[];label?:string}){
 const dialog=useRef<HTMLDialogElement>(null),title=useId();
 const picture=()=> <div className="relative bg-white">
  <Image src={image} alt={`Original ${label.toLowerCase()}, PDF page ${page}${boxes.length?'. Referenced language is highlighted in amber.':''}`} width={width*2} height={height*2} unoptimized className="h-auto w-full"/>
  <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full">
   {boxes.map((box,i)=><rect key={i} x={box.x-1} y={box.y-1} width={box.width+2} height={box.height+2} fill="#fbbf24" fillOpacity="0.25" stroke="#b45309" strokeWidth="0.8" rx="1"/>)}
  </svg>
 </div>;
 return <>
  <button type="button" onClick={()=>dialog.current?.showModal()} aria-label={`Enlarge ${label.toLowerCase()} page ${page} with highlighted passages`} className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-ink-200 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">{picture()}</button>
  <button type="button" className="mt-2 text-xs underline" onClick={()=>dialog.current?.showModal()}>Enlarge page</button>
  <dialog ref={dialog} aria-labelledby={title} className="fixed inset-0 m-auto max-h-[92dvh] w-[96vw] max-w-5xl overflow-auto rounded-xl border border-ink-200 bg-white p-0 shadow-xl backdrop:bg-black/60">
   <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 py-3"><h3 id={title} className="text-sm font-medium">{label} · PDF page {page}</h3><button type="button" autoFocus onClick={()=>dialog.current?.close()} className="rounded border border-ink-200 px-3 py-1.5 text-sm">Close</button></div>
   <div className="overflow-x-auto"><div className="min-w-[700px]">{picture()}</div></div>
  </dialog>
 </>;
}
