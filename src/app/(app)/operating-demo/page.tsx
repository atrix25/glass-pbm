import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import {demoFeaturesEnabled} from '@/lib/config';
import {getClock} from '@/lib/session';
import {RealisticBook} from '@/components/realistic-book';
import {ConnectedDemo} from '@/components/connected-demo';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{id?:string;legacy?:string}>}){const q=await searchParams;if(!demoFeaturesEnabled())notFound();return <Suspense fallback={<p>Loading…</p>}>{q.legacy==='1'||q.id?.startsWith('cdm_')?<ConnectedDemo canRun={!(await getClock()).pinned}/>:<RealisticBook canRun={!(await getClock()).pinned}/>}</Suspense>;}
