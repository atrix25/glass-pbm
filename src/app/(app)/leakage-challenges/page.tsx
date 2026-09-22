import { notFound } from 'next/navigation';
import { demoFeaturesEnabled } from '@/lib/config';
import { ChallengePage } from '@/components/leakage-challenge-page';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{run?:string;tab?:string;test?:string}>}){
 if(!demoFeaturesEnabled())notFound();const q=await searchParams;return <ChallengePage runId={q.run} tab={q.tab} testId={q.test}/>;
}
