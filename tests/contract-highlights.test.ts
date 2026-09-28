import {describe,it,expect} from 'vitest';
import {locatePassage,sourceHighlights} from '../src/lib/contract-extraction/highlights';
import source from '../data/contract-extraction/wisconsin.json';
const words=[{text:'The',box:[10,10,20,20],line:'1'},{text:'contract',box:[22,10,60,20],line:'1'},{text:'applies.',box:[10,25,40,35],line:'2'}];
describe('contract page highlights',()=>{
 it('boxes each referenced line and normalizes whitespace',()=>{
  expect(locatePassage(words,'The   contract\napplies.')).toEqual([{x:10,y:10,width:50,height:10},{x:10,y:25,width:30,height:10}]);
 });
 it('does not infer paraphrases, partial words, or ambiguous locations',()=>{
  expect(locatePassage(words,'The agreement applies.')).toEqual([]);
  expect(locatePassage(words,'contract applies')).toEqual([]);
  expect(locatePassage([...words,...words],'The contract applies.')).toEqual([]);
  expect(locatePassage(words,'')).toEqual([]);
 });
 it('finds the real utilization management clause on the original page',()=>{
  const quote='The CONTRACTOR shall have utilization management processes that are evidence-based and focus on quality, positive PARTICIPANT outcomes, and cost savings.';
  const result=sourceHighlights(59,source.sha256,[{page:59,quote,matched:true}]);
  expect(result?.missing).toBe(0);expect(result?.boxes).toHaveLength(2);
  expect(result?.boxes[0].y).toBeCloseTo(203.509,2);
  expect(result?.boxes[1].width).toBeGreaterThan(300);
 });
 it('retains missing evidence and rejects the wrong document or page',()=>{
  expect(sourceHighlights(59,'other',[])).toBeNull();
  expect(sourceHighlights(99,source.sha256,[])).toBeNull();
  const result=sourceHighlights(59,source.sha256,[{page:59,quote:'The CONTRACTOR',matched:false},{page:59,quote:'Invented requirement',matched:true},{page:60,quote:'elsewhere',matched:true}]);
  expect(result?.boxes).toEqual([]);expect(result?.missing).toBe(2);
 });
});
