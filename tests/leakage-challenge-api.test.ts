import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({selectedSponsor:vi.fn(),authenticatedStaff:vi.fn(),getClock:vi.fn(),createChallenge:vi.fn(),evaluateChallenge:vi.fn(),readChallenge:vi.fn()}));
vi.mock('@/lib/contract-checks/context',()=>({selectedSponsor:m.selectedSponsor}));
vi.mock('@/lib/contract-checks/access',()=>({authenticatedStaff:m.authenticatedStaff,sameOrigin:(r:Request)=>r.headers.get('origin')==='http://localhost'}));
vi.mock('@/lib/session',()=>({getClock:m.getClock}));
vi.mock('@/lib/leakage-challenge/service',()=>({createChallenge:m.createChallenge,evaluateChallenge:m.evaluateChallenge,readChallenge:m.readChallenge}));
import {POST,GET} from '@/app/api/leakage-challenges/route';
const req=(body:unknown,origin='http://localhost')=>new Request('http://localhost/api/leakage-challenges',{method:'POST',headers:{origin},body:JSON.stringify(body)});
const body={action:'create',key:'abc12345-1234-4123-8123-123456789012',size:200};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('DEMO_FEATURES','1');m.authenticatedStaff.mockResolvedValue(true);m.selectedSponsor.mockResolvedValue('tennessee');m.getClock.mockResolvedValue({now:new Date('2026-09-22')});m.createChallenge.mockResolvedValue('lch_test');});
afterEach(()=>vi.unstubAllEnvs());
it('requires demo mode, staff authentication and same origin',async()=>{
 expect((await POST(req(body,'https://other'))).status).toBe(403);m.authenticatedStaff.mockResolvedValue(false);expect((await GET(new Request('http://localhost/api/leakage-challenges?id=lch_test'))).status).toBe(403);m.authenticatedStaff.mockResolvedValue(true);vi.stubEnv('DEMO_FEATURES','0');expect((await POST(req(body))).status).toBe(404);
});
it('rejects injected answer keys, seeds, sponsor IDs and arbitrary size',async()=>{
 for(const extra of [{seed:'known'},{sponsor:'wisconsin'},{answer:{}},{size:100000}])expect((await POST(req({...body,...extra}))).status).toBe(400);expect(m.createChallenge).not.toHaveBeenCalled();
});
it('returns only the identifier on create and uses trusted sponsor context',async()=>{
 const r=await POST(req(body));expect(await r.json()).toEqual({id:'lch_test'});expect(m.createChallenge).toHaveBeenCalledWith('tennessee',body.key,200);
});
it('returns not found for inaccessible runs and hides internal errors',async()=>{
 m.readChallenge.mockResolvedValue(null);expect((await GET(new Request('http://localhost/api/leakage-challenges?id=lch_other'))).status).toBe(404);
 m.evaluateChallenge.mockRejectedValue(Error('database password'));const r=await POST(req({action:'evaluate',id:'lch_other'}));expect(JSON.stringify(await r.json())).not.toContain('password');
});
