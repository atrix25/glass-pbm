import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {getClock} from '@/lib/session';
import {ConnectedDemo} from '@/components/connected-demo';
export const dynamic='force-dynamic';
export default async function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading…</p>}><ConnectedDemo canRun={!(await getClock()).pinned}/></Suspense>;}
