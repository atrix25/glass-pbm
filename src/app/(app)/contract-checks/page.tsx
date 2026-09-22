import { notFound } from "next/navigation";
import { demoFeaturesEnabled } from "@/lib/config";
import { ContractCheckPage } from "@/components/contract-check-page";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{run?:string;tab?:string}>}){
 if(!demoFeaturesEnabled())notFound();const q=await searchParams;return <ContractCheckPage runId={q.run} tab={q.tab}/>;
}
