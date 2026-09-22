import { notFound } from 'next/navigation';
import { demoFeaturesEnabled } from '@/lib/config';
import { DataCheckPage } from '@/components/data-check-page';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{run?:string}>}){if(!demoFeaturesEnabled())notFound();return <DataCheckPage id={(await searchParams).run}/>;}
