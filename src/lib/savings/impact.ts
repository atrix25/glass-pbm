export type Disruption = { memberId:string; memberName:string; higherCost:boolean; accessChange:boolean; claimIds:string[] };
/** Collect member-facing changes across all evaluated fills, before UI truncation. */
export class DisruptionTracker {
  private fills=new Map<string,{memberId:string;memberName:string;higherCost:boolean;accessChange:boolean}>();
  record(claimId:string,memberId:string,memberName:string,before:{responseStatus:string;patientPayCents:number},after:{responseStatus:string;patientPayCents:number}) {
    const higherCost=after.patientPayCents>before.patientPayCents;
    const accessChange=before.responseStatus==='P'&&after.responseStatus==='R';
    if(higherCost||accessChange)this.fills.set(claimId,{memberId,memberName,higherCost,accessChange});
  }
  reverse(claimId:string){this.fills.delete(claimId)}
  result():Disruption[]{const members=new Map<string,Disruption>();for(const [id,fill] of this.fills){const m=members.get(fill.memberId)??{memberId:fill.memberId,memberName:fill.memberName,higherCost:false,accessChange:false,claimIds:[]};m.higherCost ||= fill.higherCost;m.accessChange ||= fill.accessChange;m.claimIds.push(id);members.set(fill.memberId,m)}return [...members.values()].sort((a,b)=>a.memberId.localeCompare(b.memberId));}
}
