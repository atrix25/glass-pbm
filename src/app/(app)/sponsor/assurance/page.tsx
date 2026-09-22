import Link from "next/link";
import { demoFeaturesEnabled } from "@/lib/config";
import { recentSimulations, simulation } from "@/lib/rebate-protection/service";
import { RebateDelivery } from "@/components/rebate-protection-view";
import { getClock } from "@/lib/session";
import { getSponsorAssurance } from "@/lib/queries/sponsor-assurance";
import { SponsorAssurance } from "@/components/sponsor-assurance";

export const dynamic = "force-dynamic";

export default async function AssurancePage() {
  const clock=await getClock();
  const data=await getSponsorAssurance(clock);
  const recent=demoFeaturesEnabled()?await recentSimulations():[];
  const demo=recent[0]?await simulation(recent[0].id,clock.now):null;
  return <div className="space-y-6"><SponsorAssurance data={data}/>{demo?<RebateDelivery run={demo}/>:demoFeaturesEnabled()?<Link href="/rebate-protection" className="block rounded-xl border border-ink-200 bg-white p-6 text-sm">Rebate delivery · Open synthetic proof →</Link>:null}</div>;
}
