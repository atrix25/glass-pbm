import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {GemmaWorkspace} from '@/components/gemma';
export default function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading Glass…</p>}><GemmaWorkspace/></Suspense>}
