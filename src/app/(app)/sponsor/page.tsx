import { notFound } from 'next/navigation';
import { OfferingWorkspace } from '@/components/offering-workspace';
import { parseOffering, type Query } from '@/lib/offering/model';
import { demoFeaturesEnabled } from '@/lib/config';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Query>}) {
  if (!demoFeaturesEnabled()) notFound();
  const input = parseOffering(await searchParams);
  return <OfferingWorkspace input={input} view="sponsor"/>;
}
