import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {SavingsWorkspace} from '@/components/savings-workspace';
export default function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading savings workspace…</p>}><SavingsWorkspace/></Suspense>}
