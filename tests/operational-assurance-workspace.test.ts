import {describe,it,expect} from 'vitest';
import {ASSURANCE_AREAS,assurancePosition,relatedRequirements,visibleExtraction} from '../src/lib/operational-assurance/catalog';
import {initial,type Requirement} from '../src/lib/contract-extraction/core';
describe('operational assurance evidence boundaries',()=>{
 it('shows eight independent areas with authority and required actual evidence',()=>{
  expect(new Set(ASSURANCE_AREAS.map(a=>a.id)).size).toBe(8);
  for(const a of ASSURANCE_AREAS){expect(a.authority.length).toBeGreaterThan(0);expect(a.actual).toBeTruthy();expect(a.next).toBeTruthy();}
 });
 it('never treats missing actual records as a pass or zero discrepancies',()=>{
  expect(assurancePosition()).toEqual({recordsChecked:0,areasVerified:0,areasMissingEvidence:8,discrepancies:null,status:'Unable to verify'});
 });
 it('does not use client guarantee clauses as manufacturer obligations',()=>{
  const r={id:'term-1',title:'Commercial rebate guarantee',area:'Guarantee eligibility',interpretation:'Client guarantee',citations:[]} as unknown as Requirement;
  expect(relatedRequirements('guarantees',[r])).toEqual([r]);expect(relatedRequirements('manufacturer',[r])).toEqual([]);
 });
 it('requires recorded model extraction, correct sponsor and source, and no future completion',()=>{
  const state=initial(),cutoff=new Date('2026-09-28T12:00:00Z');state.status='Complete';state.execution='model';state.finishedAt='2026-09-28T11:00:00Z';
  expect(visibleExtraction(state,'wisconsin',cutoff)).toBe(true);
  expect(visibleExtraction(state,'tennessee',cutoff)).toBe(false);
  state.finishedAt='2026-09-28T13:00:00Z';expect(visibleExtraction(state,'wisconsin',cutoff)).toBe(false);
  state.finishedAt=null;expect(visibleExtraction(state,'wisconsin',cutoff)).toBe(false);
 });
});
