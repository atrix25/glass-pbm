'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function ReferenceContext(){
 const path=usePathname();
 if(['/sponsor','/offering','/business'].includes(path))return null;
 return <div className="border-b border-ink-200 bg-amber-50/60 px-4 py-2.5 text-xs leading-relaxed text-ink-600 sm:px-6 lg:px-8"><strong className="font-medium text-ink-800">Reference workflow</strong> · Synthetic Wisconsin/Navitus book. These records do not implement the Caremark offering assumptions. <Link href="/offering" className="ml-1 underline underline-offset-2">Return to offering</Link></div>;
}

export function ReferenceOnly({children}:{children:React.ReactNode}){const path=usePathname();return ['/sponsor','/offering','/business'].includes(path)?null:children;}
