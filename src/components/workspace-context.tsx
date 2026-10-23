'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
export function WorkspaceContext({date}:{date:string}){const path=usePathname();if(['/workspace','/onboarding'].includes(path))return null;return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4 text-xs text-slate-500"><Link className="font-medium text-slate-800" href="/workspace">Example employers <span className="px-2 text-slate-300">/</span> Steel Potatoes reference</Link><span>Reference benefit · Evidence through {date.slice(0,10)}</span></div>}
