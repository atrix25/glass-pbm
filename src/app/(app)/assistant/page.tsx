import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {ServiceWorkspace} from '@/components/service-workspace';
import {getActiveMemberId} from '@/lib/session';
import {demoFeaturesEnabled} from '@/lib/config';
export const dynamic='force-dynamic';
export default async function AssistantPage(){if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading member service…</p>}><ServiceWorkspace initialMember={await getActiveMemberId()}/></Suspense>}
