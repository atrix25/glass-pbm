import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {BenefitChanges} from '@/components/benefit-changes';
export default function Page(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p className="p-8 text-sm text-ink-500">Loading benefit changes…</p>}><BenefitChanges/></Suspense>}
