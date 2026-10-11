import {describe,it,expect} from 'vitest';
import {DisruptionTracker} from '../src/lib/savings/impact';
import {qualify,rankOptions,DEFAULT_GOALS,type SavingsOption} from '../src/lib/savings/types';
const paid=(c:number)=>({responseStatus:'P',patientPayCents:c});
const base:SavingsOption={id:'a',title:'a',description:'',override:{},patch:{},savingsCents:10000,savingsPercent:3,memberCostDeltaCents:0,npsBefore:10,npsAfter:10,membersEvaluated:100,disruptions:[],newRejects:0,eligible:true,reasons:[]};
describe('member-facing disruption',()=>{
 it('counts a member once for multiple fills and different reasons',()=>{const t=new DisruptionTracker();t.record('a','m','Member',paid(100),paid(200));t.record('b','m','Member',paid(100),{responseStatus:'R',patientPayCents:0});expect(t.result()).toEqual([{memberId:'m',memberName:'Member',higherCost:true,accessChange:true,claimIds:['a','b']}]);});
 it('does not count lower costs or a paid claim with unchanged member cost',()=>{const t=new DisruptionTracker();t.record('a','m','Member',paid(100),paid(50));t.record('b','m','Member',paid(100),paid(100));expect(t.result()).toEqual([])});
 it('removes reversed fills without removing remaining disruption',()=>{const t=new DisruptionTracker();t.record('a','m','M',paid(0),paid(100));t.record('b','m','M',paid(0),paid(100));t.reverse('a');expect(t.result()[0].claimIds).toEqual(['b']);t.reverse('b');expect(t.result()).toEqual([])});
 it('does not mistake an existing rejection for a newly denied benefit',()=>{const t=new DisruptionTracker();t.record('a','m','M',{responseStatus:'R',patientPayCents:0},{responseStatus:'R',patientPayCents:0});expect(t.result()).toEqual([])});
});
describe('savings selection',()=>{
 it('enforces savings, NPS and disruption boundaries independently',()=>{expect(qualify(base,DEFAULT_GOALS)).toEqual([]);expect(qualify({...base,npsAfter:8},DEFAULT_GOALS)).toContain('Above NPS loss limit');expect(qualify({...base,savingsCents:0},DEFAULT_GOALS)).toContain('Below savings goal');});
 it('blocks cost transfers even if aggregate member cost falls',()=>{const o={...base,memberCostDeltaCents:-100,disruptions:[{memberId:'m',memberName:'M',higherCost:true,accessChange:false,claimIds:['c']}]};expect(qualify(o,DEFAULT_GOALS)).toContain('Increases member costs');expect(qualify(o,{...DEFAULT_GOALS,allowHigherCost:true})).toEqual([])});
 it('never recommends a new rejection as uncomplicated savings',()=>{expect(qualify({...base,newRejects:1},DEFAULT_GOALS)).toContain('New rejected fills require clinical review')});
 it('accepts exact tenth-point NPS thresholds',()=>{expect(qualify({...base,npsBefore:12.3,npsAfter:12.2},{...DEFAULT_GOALS,maxNpsLoss:0.1})).toEqual([])});
 it('ranks qualifying options before failed options and minimizes unique members',()=>{const a={...base,id:'a',disruptions:[{memberId:'m',memberName:'M',higherCost:true,accessChange:false,claimIds:['c']}]};const b={...base,id:'b',savingsCents:500};const c={...base,id:'c',eligible:false};expect(rankOptions([a,c,b]).map(o=>o.id)).toEqual(['b','a','c'])});
});
