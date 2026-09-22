import {adjudicate,type AdjudicationContext} from '@/lib/engine/adjudicate';
import type {Book,Specimen,Values} from './types';
/** Actual production adjudication function, bound to isolated synthetic contexts. */
export function engineResult(record:Specimen,book:Book):Values{
 const variant=String(record.basis.variant),benefit=book.records.find(r=>r.id===record.dependencies[0]);
 const ctx:AdjudicationContext={
 request:{dateOfService:new Date(record.serviceAt),cardholderId:record.memberId,personCode:'01',serviceProviderId:'1111111111',productServiceId:'00000000001',rxNumber:record.claimId,fillNumber:0,quantityDispensed:30,daysSupply:30,dawCode:'0',usualAndCustomaryCents:5000,ingredientCostSubmittedCents:1000},
 member:{id:record.memberId,diagnosisCodes:[]},eligibility:variant==='eligibility'?null:{id:'span',effectiveDate:new Date('2026-01-01'),benefitPlanId:'sandbox'},
 plan:{id:'sandbox',name:'Synthetic terms',lineOfBusiness:'Commercial',deductibleIndividual:0,deductibleIntegratedWithMedical:false,rxOopLimitIndividual:60000,federalOopLimitIndividual:100000,dawPenaltyEnabled:false,specialtyChannelRestricted:false,costShareRules:[{level:'1',channel:'Retail',costShareType:'Copay',copayCents:Number(benefit?.actual.copayCents??500),accumulatesToRxOop:true,accumulatesToFederalOop:true}]},
 drug:{id:'drug',ndc11:'00000000001',name:'Synthetic generic',monyCode:'Y',isBrandLabel:false,isSpecialty:false,nadacPerUnit:1,unitOfMeasure:'EA',packageSize:1},
 formularyEntry:{level:'1',requiresPA:variant==='pa',requiresStep:variant==='step',hasQuantityLimit:variant==='quantity',qlQuantity:10,qlDays:30,qlUnit:'EA',qlBasis:'dispensing-unit',diagnosisRestricted:false,mandatorySpecialty:false,notCovered:variant==='coverage',planExclusion:false,requiredDiagnosisCodes:[]},
 pharmacy:{id:'pharmacy',npi:'1111111111',name:'Synthetic pharmacy',pharmacyType:'Chain',isDesignatedSpecialty:false,is340B:false,inNetwork:variant!=='network'},
 contract:{id:'synthetic',model:'PassThrough',retailMaxDaysSupply:34,discountExclusions:[],rebateExclusions:[],rebateMemberShareThresholdBps:10000,rebatePassThroughBps:10000,rates:[{channel:'Retail',drugClass:'All',dispensingFeeCents:100,lesserOfArms:['SUBMITTED'],includeUandC:false}]},
 priorFills:[],approvedPAs:[],accumulators:{rxOopAccumulatedCents:variant==='accumulator'?59900:0,federalOopAccumulatedCents:0,deductibleAccumulatedCents:0}};
 const out=adjudicate(ctx);
 if(variant==='reversal')return {status:'Reversed',billedCents:0,memberCents:0,planCents:0};
 return {status:out.responseStatus,billedCents:out.totalBilledCents,memberCents:out.patientPayCents,planCents:out.planPaidCents};
}
