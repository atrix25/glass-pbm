import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {ContractExtractionWorkspace} from '@/components/contract-extraction-workspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{run?:string;tab?:string;term?:string;area?:string}>}){if(!demoFeaturesEnabled())notFound();const q=await searchParams;return <ContractExtractionWorkspace id={q.run} tab={q.tab} term={q.term} area={q.area}/>;}
