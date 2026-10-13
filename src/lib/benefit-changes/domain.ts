import {z} from 'zod';
import {hash} from '@/lib/gemma/domain';
import type {ChangeData,Proposal,Check} from './types';
import type {ConfigOverride} from '@/lib/engine/replay';
export const ENGINE='benefit-flow-v1';
export const proposalSchema=z.object({kind:z.enum(['copay','pa','specialty','blocked']),copayCents:z.number().int().min(0).max(10000),drugId:z.string().max(150),requiresPA:z.boolean(),specialtyRestricted:z.boolean(),effectiveDate:z.string().regex(/^2026-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Invalid date'),request:z.string().max(3000)}).strict();
export function overrideFor(p:Proposal,base:ConfigOverride={}):ConfigOverride{
 if(p.kind==='copay')return {...base,costShare:[...(base.costShare??[]).filter(x=>!(x.level==='1'&&x.channel==='Retail')),{level:'1',channel:'Retail',costShareType:'Copay',copayCents:p.copayCents}]};
 if(p.kind==='pa'){if(!p.drugId)throw Error('Select the exact drug before analysis.');return {...base,formulary:[...(base.formulary??[]).filter(x=>x.drugId!==p.drugId),{drugId:p.drugId,requiresPA:p.requiresPA}]};}
 if(p.kind==='specialty')return {...base,specialtyChannelRestricted:p.specialtyRestricted};return base;
}
export function proposalHash(d:ChangeData){return hash({proposal:d.proposal,override:d.override,baseline:d.baselineVersion,sources:d.sourceHash,cutoff:d.cutoff,impact:d.impact,checks:d.checks,engine:d.engine})}
export function requiredRoles(p:Proposal){return p.kind==='pa'||p.kind==='specialty'?['Employer','Clinical']:['Employer']}
export function approved(d:ChangeData){const h=proposalHash(d);return requiredRoles(d.proposal).every(role=>d.decisions.some(x=>x.role===role&&x.approved&&x.hash===h));}
export function constraints(d:ChangeData):Check[]{const p=d.proposal;return [
 {id:'authority',category:'Contractual',requirement:'The demo employer may amend copays, drug-specific authorization and specialty access after the required reviews.',source:'Synthetic demonstration agreement §1 · Steel Potatoes · 2026-01-01–2026-12-31 · v1',status:p.kind==='blocked'?'Missing evidence':'Passed',detail:p.kind==='blocked'?'No authority is available for the requested restriction. Deployment is blocked.':'Limited to the stated sandbox changes; not an actual Caremark contract.'},
 {id:'clinical',category:'Clinical',requirement:'Changes to prior authorization or specialty access require a recorded clinical review before implementation.',source:'Synthetic clinical governance policy §2 · v1 · 2026 plan year',status:p.kind==='pa'||p.kind==='specialty'?'Needs review':'Passed',detail:p.kind==='copay'?'No clinical criteria are changed.':'Clinical appropriateness must be reviewed; a rule match does not establish clinical safety.'},
 {id:'regulatory',category:'Regulatory',requirement:'Retain the reference out-of-pocket protections. Unassessed legal or notice obligations require evidence before release.',source:'Synthetic regulatory screening checklist §3 · Commercial reference demo · 2026 · v1',status:p.kind==='blocked'?'Missing evidence':'Passed',detail:'Only the encoded demonstration screen was evaluated. This is not a determination of legal compliance. No actual plan is activated.'},
 {id:'date',category:'Implementation',requirement:'The benefit must use a valid 2026 effective date and an explicitly recorded deployment.',source:'Sandbox deployment policy §4 · v1',status:Date.parse(p.effectiveDate+'T23:59:59Z')>=Date.parse(d.cutoff)?'Passed':'Failed',detail:'Retroactive changes are not supported in this demonstration.'}
 ];}
export function assertReviewable(d:ChangeData){if(!d.impact||d.impact.sampleRate!==1)throw Error('Complete the full-book impact analysis first.');if(!d.checks||d.checks.some(x=>x.status==='Failed'||x.status==='Missing evidence'))throw Error('Required constraints remain blocked.');}
export function assertDeployable(d:ChangeData){assertReviewable(d);if(!approved(d)||!d.version||d.version.hash!==proposalHash(d))throw Error('Current version approvals are required.');if(!d.tests?.length||d.tests.some(t=>!t.passed))throw Error('All required tests must pass.');}
