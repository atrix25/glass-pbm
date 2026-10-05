import {createHash} from 'node:crypto';
import source from '../../../data/formulary-checks/tennessee.json';
import {compileRows} from './processor';
import {verifyDrafts} from './expected';
export {source};
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assertAvailable(sponsor:string,cutoff:Date){
 if(sponsor!=='tennessee')throw Error('Select Tennessee');
 if(cutoff<new Date(source.retrievedOn+'T00:00:00Z'))throw Error('Source not available at this cutoff');
}
export function createState(at=new Date()){
 const outputs=compileRows(source.rows,source.effectiveDate);
 return {format:'formulary-draft-1' as const,sourceHash:source.sha256,inputHash:digest(source.rows),createdAt:at.toISOString(),processor:'published-table-1',verifier:'visual-reference-12-1',execution:'Deterministic translation · No model execution',outputs,outputHash:digest(outputs),tests:verifyDrafts(outputs),reviews:[] as {rowId:string;verdict:'Correct'|'Needs correction';note:string;actor:string;at:string}[],commands:{} as Record<string,string>,operationalStatus:'Not connected',activation:'Draft only'};
}
export type State=ReturnType<typeof createState>;
export function assertIntegrity(s:State){if(s.format!=='formulary-draft-1'||s.sourceHash!==source.sha256||s.inputHash!==digest(source.rows)||s.outputHash!==digest(s.outputs))throw Error('Source or output version changed');}
export function recordReview(s:State,rowId:string,verdict:'Correct'|'Needs correction',note:string,actor:string,at=new Date()){
 assertIntegrity(s);const output=s.outputs.find(o=>o.id===rowId);if(!output)throw Error('Row unavailable');
 if(verdict==='Correct'&&(output.issues.length||s.tests.some(t=>t.id===rowId&&t.status==='Failed')))throw Error('Failed checks cannot be approved');
 if(verdict==='Needs correction'&&!note.trim())throw Error('Describe the correction needed');
 s.reviews.push({rowId,verdict,note,actor,at:at.toISOString()});
}
export function visibleState(s:State,cutoff:Date){return new Date(s.createdAt)<=cutoff?{...s,reviews:s.reviews.filter(r=>new Date(r.at)<=cutoff),commands:undefined}:null;}
