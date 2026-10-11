import {describe,it,expect} from 'vitest';
import {transition,caseState,visibleEvents,outcomes,type Event,type Kind,type Command} from '../src/lib/service/state';
const at=new Date('2026-09-15T12:00:00Z');
function fixture(kind:Kind='cost'){
 const events:Event[]=[{seq:0,type:'created',status:'Open',team:'Member services',summary:'Created',actor:'Demo',simulated:false,payload:'{}',evidenceAt:at,createdAt:at}];
 const add=(command:Command,note='Reviewed')=>{const n=transition(kind,events,command,note,true);events.push({...events[0],...n,type:command,seq:events.length,simulated:true,createdAt:new Date(at.getTime()+events.length*1000)});return n};
 const answer=()=>events.push({...events[0],seq:events.length,type:'answer',status:'In progress',payload:'{"usable":true}'});
 return {events,add,answer};
}
describe('evidence-based member service',()=>{
 it('requires supported explanation and member confirmation',()=>{const f=fixture();expect(()=>f.add('confirm')).toThrow();expect(()=>f.add('resolve')).toThrow();f.answer();f.add('confirm');expect(f.add('resolve').status).toBe('Resolved')});
 it('an authorization approval is not a restored fill',()=>{const f=fixture('authorization');f.add('prepare');expect(()=>f.add('approve')).toThrow();f.add('receive');f.add('approve');expect(()=>f.add('resolve')).toThrow();expect(()=>f.add('fill-response')).toThrow();f.add('authorization-response');expect(()=>f.add('resolve')).toThrow();f.add('fill-response');expect(f.add('resolve').status).toBe('Resolved')});
 it('benefit scenarios require approval and explicit simulated activation',()=>{const f=fixture('benefit');expect(()=>f.add('activate')).toThrow();f.add('prepare');f.add('receive');f.add('approve');expect(()=>f.add('fill-response')).toThrow();f.add('activate');f.add('fill-response');expect(f.add('resolve').status).toBe('Resolved')});
 it('rejection blocks responses; a fresh draft requires fresh receipt and review',()=>{const f=fixture('authorization');f.add('prepare');f.add('receive');f.add('reject');expect(()=>f.add('authorization-response')).toThrow();f.add('prepare');expect(caseState('authorization',f.events).rejected).toBe(false);expect(()=>f.add('approve')).toThrow();f.add('receive');f.add('approve');f.add('authorization-response')});
 it('rejects repeated approvals and duplicate fills',()=>{const f=fixture('authorization');f.add('prepare');f.add('receive');f.add('approve');expect(()=>f.add('approve')).toThrow();f.add('authorization-response');f.add('fill-response');expect(()=>f.add('fill-response')).toThrow()});
 it('reopening retains history but requires new resolution evidence',()=>{const f=fixture();f.answer();f.add('confirm');f.add('resolve');expect(()=>f.add('reopen','')).toThrow();f.add('reopen');expect(f.events.some(e=>e.type==='resolve')).toBe(true);expect(()=>f.add('resolve')).toThrow()});
 it('future evidence cannot resolve a historical case',()=>{const f=fixture();f.answer();f.add('confirm');f.add('resolve');f.events.at(-1)!.evidenceAt=new Date('2026-10-01');expect(caseState('cost',visibleEvents(f.events,at)).status).toBe('In progress')});
 it('blocks actions while an answer is running',()=>{const f=fixture();f.events.push({...f.events[0],type:'question',seq:1});expect(()=>f.add('prepare')).toThrow('still running');expect(f.add('recover').status).toBe('Open')});
 it('requires a selected claim for consequential drafts',()=>{const f=fixture();expect(()=>transition('cost',f.events,'prepare','',false)).toThrow('Select a claim')});
 it('counts only recorded staff intervention and completed resolutions',()=>{const a=fixture();a.events.push({...a.events[0],type:'question',seq:1});a.answer();a.events.push({...a.events[0],type:'question',seq:3});a.answer();a.add('confirm');a.add('resolve');const b=fixture('authorization');b.add('prepare');const m=outcomes([{kind:'cost',events:a.events},{kind:'authorization',events:b.events}]);expect(m).toMatchObject({total:2,resolved:1,unresolved:1,withoutStaff:1,repeatContacts:1});expect(m.averageResolutionSeconds).toBeGreaterThan(0)});
});
