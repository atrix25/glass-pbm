import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {PlanStudio} from '@/components/plan-studio';
export default function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading plan options…</p>}><PlanStudio/></Suspense>}
