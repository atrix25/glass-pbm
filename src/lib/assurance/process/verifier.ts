import type {Area,Artifact,ProcessState} from './types';
// Independent financial benchmark. This module imports no processor, engine or detector.
export const EXPECTED:Partial<Record<Area,Artifact>>={
 contract:{network:'Preferred',outOfNetworkCovered:false,copayCents:500,paRequired:false,stepRequired:false,quantityLimit:90,clientEligible:true,manufacturerEligible:true},
 drugs:{classification:'Brand',limitedDistribution:false,formularyTier:'1',covered:true,retail90Eligible:true,minimumDays:84,maximumDays:90,maintenanceChoice:false,retailFillsAllowed:2},
 rates:{feeCents:110,effectiveFrom:'2026-04-01'},
 claims:{evaluated:2,netPlanCents:610,netMemberCents:500},
 manufacturer:{entitledCents:300,receivedCents:300,uncollectedCents:0,period:'2026Q2',accepted:true},
 guarantees:{rateCents:400,obligationCents:400,forecastCents:400,topupCents:100,employerEntitlementCents:400},
 client:{claimChargesCents:610,feeCents:50,rebateCreditCents:300,guaranteeCreditCents:100,netInvoiceCents:260,period:'2026-04'},
 notices:{recipient:'Benefits lead',deadline:'2026-05-02',deliveredAt:'2026-05-01T00:00:00.000Z'},
};
export function compare(id:Area,output:Artifact|null){return output!==null&&Object.entries(EXPECTED[id]!).every(([k,v])=>output[k]===v);}
export function complete(state:ProcessState){return Object.values(state.steps).every(s=>s.status==='Released'&&s.checks.length>0&&s.checks.every(c=>c.status==='Passed'))&&!!state.tests?.cases.length&&state.tests.cases.every(t=>t.passed);}
