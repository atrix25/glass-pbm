import {createHash} from 'node:crypto';
import {z} from 'zod';
import document from '../../../data/contract-extraction/wisconsin.json';
export const SOURCE=document;
export const AREAS=['Guarantee eligibility','Drug definitions','Formulary','Prior authorization','Step therapy','Notices','Network','Other'] as const;
export const extractionSchema=z.object({requirements:z.array(z.object({title:z.string().min(1),area:z.enum(AREAS),interpretation:z.string().min(1),implementation:z.string().min(1),conditions:z.array(z.string()),missingDependencies:z.array(z.string()),evidence:z.array(z.object({page:z.number().int(),quote:z.string().min(1)})).min(1),tests:z.array(z.object({input:z.string(),expected:z.string()})).min(1)})),limitations:z.array(z.string()).default([])});
export type Extraction=z.infer<typeof extractionSchema>;
export type Requirement=Extraction['requirements'][number]&{id:string;citations:{page:number;quote:string;matched:boolean;start:number;end:number}[]};
export type Verdict='Correct'|'Corrected'|'Unsupported'|'Unverifiable'|'Duplicate';
export type Review={id:string;requirementId:string;verdict:Verdict;correction:string;note:string;actor:string;at:string};
export type Omission={id:string;page:number;quote:string;interpretation:string;actor:string;at:string};
export type State={format:'extraction-1';extractorVersion:string;source:typeof SOURCE;status:'Queued'|'Running'|'Complete'|'Failed';attempt:number;startedAt:string|null;finishedAt:string|null;error:string|null;execution:'model'|null;model:string|null;usage:{inputTokens:number;outputTokens:number}|null;raw:Extraction|null;original:Requirement[];originalHash:string|null;reviews:Review[];omissions:Omission[];pageReviews:{page:number;actor:string;at:string}[];limitations:string[];commands:Record<string,string>};
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const normalize=(text:string)=>text.normalize('NFC').replace(/\s+/g,' ').trim();
export function citation(source:typeof SOURCE,page:number,quote:string){const text=normalize(source.pages.find(p=>p.page===page)?.text??''),needle=normalize(quote),start=needle.length?text.indexOf(needle):-1;return {page,quote,matched:start>=0,start,end:start<0?-1:start+needle.length};}
export function freeze(raw:Extraction,source:typeof SOURCE){return raw.requirements.map((r,i)=>({...r,id:`term-${i+1}`,citations:r.evidence.map(e=>citation(source,e.page,e.quote))}));}
export function initial():State{return {format:'extraction-1',extractorVersion:'page-context-v2',source:structuredClone(SOURCE),status:'Queued',attempt:0,startedAt:null,finishedAt:null,error:null,execution:null,model:null,usage:null,raw:null,original:[],originalHash:null,reviews:[],omissions:[],pageReviews:[],limitations:[],commands:{}};}
export function metrics(state:State){
 const latest=new Map(state.reviews.map(r=>[r.requirementId,r])),reviewed=[...latest.values()],correct=reviewed.filter(r=>r.verdict==='Correct').length;
 return {extracted:state.original.length,reviewed:reviewed.length,unreviewed:state.original.length-reviewed.length,correct,corrected:reviewed.filter(r=>r.verdict==='Corrected').length,unsupported:reviewed.filter(r=>r.verdict==='Unsupported').length,unverifiable:reviewed.filter(r=>r.verdict==='Unverifiable').length,duplicates:reviewed.filter(r=>r.verdict==='Duplicate').length,accuracy:reviewed.length?Math.round(correct/reviewed.length*1000)/10:null,omissions:state.omissions.length,pagesReviewed:new Set(state.pageReviews.map(r=>r.page)).size,pagesInScope:state.source.pages.length,citationsMatched:state.original.filter(r=>r.citations.every(c=>c.matched)).length};
}
