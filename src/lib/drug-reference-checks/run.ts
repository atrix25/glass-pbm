import {createHash} from 'node:crypto';
import records from '../../../data/public-drug-reference/maine/records.json';
import source from '../../../data/public-drug-reference/maine/source.json';
import contract from '../../../data/contract-extraction/tennessee.json';
import {processRecords} from './process';
import {verifyOutputs} from './expected';
export const RULE_QUOTE='For Discount purposes and other related contract calculations, Single-Source Generics should be considered as Multi Source generics and must not be included in the Brands bucket for the purpose of pricing or guarantee reconciliation.';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function runReferenceChecks(sponsor:string,cutoff:Date,now=new Date()){
 if(sponsor!=='tennessee')throw Error('Select Tennessee to run this contract rule');
 if(cutoff<new Date(source.retrievedOn+'T00:00:00Z'))throw Error('Public reference unavailable at this cutoff');
 const text=contract.pages.find(p=>p.page===74)?.text.replace(/\s+/g,' ');
 if(!text?.includes(RULE_QUOTE))throw Error('Contract citation does not match');
 const outputs=processRecords(records),verification=verifyOutputs(outputs);
 const blocked=outputs.filter(r=>r.issues.length).length;
 return {format:'public-drug-check-1',execution:'Deterministic code · No AI execution',processorVersion:'single-source-generic-1',verifierVersion:'mhdo-five-records-1',executedAt:now.toISOString(),cutoff:cutoff.toISOString(),sponsor,source,sourceSnapshotHash:hash(records),outputHash:hash(outputs),contract:{sha256:contract.sha256,page:74,quote:RULE_QUOTE},status:!blocked&&!verification.failed?'Passed':'Failed',summary:{records:outputs.length,validRecords:outputs.length-blocked,blocked,applicable:outputs.filter(r=>r.processing==='Processed').length,outsideRule:outputs.filter(r=>r.processing==='Outside this rule').length,verified:verification.passed,failed:verification.failed},verification,outputs,operationalResult:'Not assessed',limitations:['Technology demonstration using Maine report records and a Tennessee contract rule. Not a Tennessee audit.','Report categories are not raw Medi-Span MONY codes.','Classification dates, actual claims, employer obligations and guarantee calculations are unavailable. No financial savings or operational compliance result.','The other drug-definition controls, including specialty, limited distribution and formulary status, are not tested.']};
}
export type ReferenceResult=ReturnType<typeof runReferenceChecks>;
