import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ContractLanguage} from '../src/components/assurance-contract-language';
import {makeFixture} from '../src/lib/assurance/fixture';
const cutoff='2026-05-01';
function record(){return makeFixture('tennessee','source-test',true).book.records[0];}
describe('contract language evidence',()=>{
 it('does not present legacy synthetic requirements as contract quotations',()=>{
  const html=renderToStaticMarkup(React.createElement(ContractLanguage,{record:record(),cutoff}));
  expect(html).toContain('Original text not loaded');expect(html).not.toContain('<blockquote');
 });
 it('preserves source text and citation alongside the requirement',()=>{
  const r=record();r.requirements[0].source={kind:'contract',text:'A verified test excerpt.\nSecond paragraph.',document:'Test agreement',location:'Section 2, page 3',recordedAt:'2026-01-01',url:'https://example.com/agreement.pdf#page=3'};
  const html=renderToStaticMarkup(React.createElement(ContractLanguage,{record:r,cutoff}));
  expect(html).toContain('A verified test excerpt.\nSecond paragraph.');expect(html).toContain('Section 2, page 3');expect(html).toContain('Contract excerpt');
 });
 it('suppresses future source evidence and flags conflicting requirements',()=>{
  const r=record();r.requirements[0].source={kind:'contract',text:'Future text',document:'Future',location:'p1',recordedAt:'2027-01-01'};
  r.requirements.push({...r.requirements[0],id:'conflict'});
  const html=renderToStaticMarkup(React.createElement(ContractLanguage,{record:r,cutoff}));
  expect(html).not.toContain('Future text');expect(html).toContain('Conflicting terms');
 });
});
