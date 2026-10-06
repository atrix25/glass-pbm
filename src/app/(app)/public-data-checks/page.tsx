import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {getClock} from '@/lib/session';
import {PublicDataChecks} from '@/components/public-data-checks';
export const dynamic='force-dynamic';
export default async function Page(){if(!demoFeaturesEnabled())notFound();const clock=await getClock();return <Suspense fallback={<p>Loading…</p>}><PublicDataChecks canRun={!clock.pinned}/></Suspense>;}
