import { describe, expect, it } from 'vitest';
import { calculateOffering, DEFAULT_OFFERING, parseOffering, offeringQuery } from '../src/lib/offering/model';
describe('illustrative commercial offering', () => {
  it('balances employer and member economics without retaining rebates', () => {
    const x = calculateOffering(DEFAULT_OFFERING);
    expect(x.gross).toBe(15600); expect(x.member).toBe(3120);
    expect(x.rebate).toBe(4200); expect(x.topUp).toBe(0);
    expect(x.net).toBe(9180); expect(x.employerAnnual).toBe(27540000);
    expect(x.net + x.member + x.rebate + x.topUp).toBe(x.gross + x.fee);
    expect(x.contributionAnnual).toBe(750000);
  });
  it('funds guarantee shortfalls separately without counting rebates twice', () => {
    const x=calculateOffering({...DEFAULT_OFFERING, rebate:30});
    expect(x.topUp).toBe(1000); expect(x.net).toBe(9380);
    expect(x.contribution).toBe(-750); expect(x.rebate).toBe(3000);
  });
  it('uses independent client drug pricing for drug-level rebate arrangements', () => {
    const x=calculateOffering({...DEFAULT_OFFERING, model:'drug-rebate', drugPrice:200, acquisition:1});
    expect(x.gross).toBe(20000); expect(x.net).toBe(12700);
  });
  it('shows member tradeoffs without claiming utilization savings', () => {
    const core=calculateOffering({...DEFAULT_OFFERING,benefits:'core'});
    const choice=calculateOffering({...DEFAULT_OFFERING,benefits:'choice'});
    expect(core.gross).toBe(choice.gross); expect(core.rebate).toBe(choice.rebate);
    expect(core.member-choice.member).toBe(choice.net-core.net);
  });
  it('keeps sensitivity top-ups and PBM contribution consistent', () => {
    const x=calculateOffering(DEFAULT_OFFERING);
    expect(x.adverse.guaranteePayment).toBe(1290000);
    expect(x.adverse.contribution).toBe(-540000);
    expect(x.favorable.employer).toBeLessThan(x.employerAnnual);
    expect(x.adverse.employer).toBeGreaterThan(x.employerAnnual);
  });
  it('normalizes invalid inputs and preserves explicit zero and negative net credits', () => {
    expect(parseOffering({members:'0',fee:'NaN',model:'bad',benefits:'bad',rebate:'0'})).toEqual({...DEFAULT_OFFERING,members:1,rebate:0});
    expect(parseOffering({members:'Infinity',fee:'-9'}).fee).toBe(0);
    expect(calculateOffering({...DEFAULT_OFFERING,rebate:200}).net).toBeLessThan(0);
    expect(parseOffering(Object.fromEntries(new URLSearchParams(offeringQuery(DEFAULT_OFFERING))))).toEqual(DEFAULT_OFFERING);
  });
});
