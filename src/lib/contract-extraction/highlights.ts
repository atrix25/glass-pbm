import geometry from '../../../data/contract-extraction/wisconsin-geometry.json';
import tennesseeGeometry from '../../../data/contract-extraction/tennessee-geometry.json';

type Citation = {page:number; quote:string; matched:boolean};
type Word = {text:string; box:number[]; line:string};
export type HighlightBox = {x:number; y:number; width:number; height:number};
const normalize = (text:string) => text.normalize('NFC').replace(/\s+/g,' ').trim();

/** Exact wording only; ambiguous or unmatched passages never receive an overlay. */
export function locatePassage(words:Word[], quote:string):HighlightBox[] {
 const spans:{word:Word; start:number; end:number}[]=[];
 let text='';
 for(const word of words){if(text)text+=' ';const start=text.length;text+=normalize(word.text);spans.push({word,start,end:text.length});}
 const needle=normalize(quote),start=needle?text.indexOf(needle):-1;
 if(start<0||text.indexOf(needle,start+1)>=0)return [];
 const end=start+needle.length;
 // Do not box a substring inside a different word.
 if((start>0&&text[start-1]!==' ')||(end<text.length&&text[end]!==' '))return [];
 const lines=new Map<string,number[]>();
 for(const span of spans){
  if(span.end<=start||span.start>=end)continue;
  const {line,box}=span.word,prior=lines.get(line);
  lines.set(line,prior?[Math.min(prior[0],box[0]),Math.min(prior[1],box[1]),Math.max(prior[2],box[2]),Math.max(prior[3],box[3])]:[...box]);
 }
 return [...lines.values()].map(([x,y,right,bottom])=>({x,y,width:right-x,height:bottom-y}));
}
export function sourceHighlights(page:number,sha256:string,citations:Citation[]){
 const source=[geometry,tennesseeGeometry].find(g=>g.sha256===sha256)?.pages.find(p=>p.page===page);
 if(!source)return null;
 const relevant=citations.filter(c=>c.page===page);
 const passages=relevant.map(c=>c.matched?locatePassage(source.words,c.quote):[]);
 const boxes=[...new Map(passages.flat().map(box=>[JSON.stringify(box),box])).values()];
 return {width:source.width,height:source.height,boxes,missing:passages.filter(p=>!p.length).length};
}
