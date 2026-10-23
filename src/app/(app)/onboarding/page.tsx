import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {EmployerWorkspace} from '@/components/employer-workspace';
export default function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading employer setup…</p>}><EmployerWorkspace onboarding/></Suspense>}
