import {describe,it,expect} from 'vitest';
import {overrideFor,proposalSchema,assertDeployable,constraints,proposalHash,approved} from '@/lib/benefit-changes/domain';
import {verifyBenefit} from '@/lib/benefit-changes/verify';
import type {Proposal,ChangeData} from '@/lib/benefit-changes/types';
const p:Proposal={kind:'copay',copayCents:300,drugId:'chosen-drug',requiresPA:false,specialtyRestricted:false,effectiveDate:'2026-10-12',request:'Lower copay'};
const data=():ChangeData=>({format:1,proposal:p,override:overrideFor(p),baseline:{},baselineVersion:null,baselineRevision:0,sourceHash:'frozen',cutoff:'2026-10-12T00:00:00Z',population:10,engine:'v1',interpretation:'scripted',decisions:[],outcomes:[]});
describe('Benefit change gates',()=>{
 it('validates dates and rejects unsupported fields',()=>{expect(()=>proposalSchema.parse({...p,effectiveDate:'2026-02-31'})).toThrow();expect(()=>proposalSchema.parse({...p,rate:123})).toThrow()});
 it('requires an exact drug for PA changes',()=>expect(()=>overrideFor({...p,kind:'pa',drugId:''})).toThrow());
 it('preserves predecessor changes',()=>{expect(overrideFor(p,{specialtyChannelRestricted:false}).specialtyChannelRestricted).toBe(false)});
 it('blocks missing contract authority',()=>{const d=data();d.proposal={...p,kind:'blocked'};expect(constraints(d).some(x=>x.status==='Missing evidence')).toBe(true);expect(()=>assertDeployable(d)).toThrow()});
 it('rejects unapproved changes and stale approvals',()=>{const d=data();expect(approved(d)).toBe(false);d.decisions=[{role:'Employer',actor:'Demo reviewer',approved:true,hash:proposalHash(d),at:'2026-10-12'}];expect(approved(d)).toBe(true);d.proposal={...p,copayCents:200};expect(approved(d)).toBe(false)});
 it('requires clinical approval for access',()=>{const d=data();d.proposal={...p,kind:'specialty'};d.decisions=[{role:'Employer',actor:'Employer',approved:true,hash:proposalHash(d),at:'2026-10-12'}];expect(approved(d)).toBe(false)});
 it.each(['copay','pa','specialty'] as const)('independent %s claim expectations pass',kind=>{const proposal={...p,kind};expect(verifyBenefit(proposal,overrideFor(proposal)).every(x=>x.passed)).toBe(true)});
 it('catches an incorrect implementation rather than trusting the generated config',()=>expect(verifyBenefit(p,overrideFor({...p,copayCents:400})).some(x=>!x.passed)).toBe(true));
 it('detects a one-dollar output fault',()=>expect(verifyBenefit(p,overrideFor(p),true).some(x=>!x.passed)).toBe(true));
 it('keeps expected rejections as passing tests',()=>{expect(verifyBenefit(p,overrideFor(p)).find(x=>x.name==='Unrelated authorization')?.passed).toBe(true)});
 it('blocks retroactive effective dates',()=>{const d=data();d.proposal={...p,effectiveDate:'2026-10-01'};expect(constraints(d).find(x=>x.id==='date')?.status).toBe('Failed')});
});
