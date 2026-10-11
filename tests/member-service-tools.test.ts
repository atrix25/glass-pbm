import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({pa:vi.fn(),claim:vi.fn(),claims:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{priorAuthorization:{findMany:mocks.pa},claim:{findFirst:mocks.claim,findMany:mocks.claims}}}));
vi.mock('@/lib/engine/replay',()=>({loadWorld:vi.fn()}));
vi.mock('@/lib/sources',()=>({getSource:()=>({id:"source",title:"Source",publisher:"Publisher",url:"https://example.org"})}));
import {getPriorAuthStatus,explainClaim} from '../src/lib/agent/tools';
import {serviceToolContext} from '../src/lib/service/tool-context';
const at=new Date('2026-06-01');
const scope={memberId:'m',at,claimId:'c',drugName:'SKYRIZI'};
beforeEach(()=>vi.clearAllMocks());
describe('service evidence tools',()=>{
 it('limits PA lookup to the requested drug and cutoff',async()=>{mocks.pa.mockResolvedValue([]);await serviceToolContext.run(scope,()=>getPriorAuthStatus({memberId:'m',drugName:'SKYRIZI'}));expect(mocks.pa.mock.calls[0][0].where).toEqual({memberId:'m',receivedAt:{lte:at},drug:{name:{contains:'SKYRIZI'}}})});
 it('does not expose a future decision or reviewer',async()=>{mocks.pa.mockResolvedValue([{drug:{name:'SKYRIZI'},tree:null,receivedAt:new Date('2026-05-20'),decidedAt:new Date('2026-07-01'),status:'Approved',determination:'Approved',decidedBy:'Reviewer',approvedTerminationDate:new Date('2026-12-01'),decisionSteps:[]}]);const result=await serviceToolContext.run(scope,()=>getPriorAuthStatus({memberId:'m',drugName:'SKYRIZI'}));expect((result.data as {requests:unknown[]}).requests[0]).toMatchObject({status:'InReview',determination:null,decidedBy:null,approvedThrough:null});expect(result.summary).not.toContain('Approved')});
 it('scopes a claim ID to its member and historical cutoff',async()=>{mocks.claim.mockResolvedValue(null);await serviceToolContext.run(scope,()=>explainClaim({claimId:'foreign'}));expect(mocks.claim.mock.calls[0][0].where).toMatchObject({memberId:'m',dateOfService:{lte:at},OR:[{id:'foreign'},{claimNumber:'foreign'}]})});
});
