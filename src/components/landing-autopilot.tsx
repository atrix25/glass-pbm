'use client';

import { useEffect, useState } from 'react';
import { Eye, SlidersHorizontal, Sparkles, ShieldCheck, Play, Pause, RotateCcw, ArrowRight } from 'lucide-react';

type Phase = 'idle' | 'watch' | 'evaluate' | 'review' | 'apply' | 'verify' | 'done';
const content: Record<Phase, { title: string; detail: string; step: number }> = {
  idle: { title: 'A new option. A better plan.', detail: 'Play a biosimilar example from discovery to follow-up.', step: -1 },
  watch: { title: 'New biosimilar identified', detail: 'Sapphire identifies an alternative for clinical and economic review.', step: 0 },
  evaluate: { title: 'Tradeoffs evaluated', detail: 'Compare net cost, eligible members and the support needed to transition.', step: 1 },
  review: { title: 'Ready for your review', detail: 'The proposed change waits for simulated employer and clinical approval.', step: 2 },
  apply: { title: 'Approved change applied', detail: 'The example plan is updated and simulated member support is prepared.', step: 2 },
  verify: { title: 'Results compared', detail: 'Check observed simulation results against the original projection.', step: 3 },
  done: { title: 'A follow-up, already identified', detail: 'Savings are below projection and one access issue needs attention. The next cycle investigates why.', step: 3 },
};
const steps = [
  { label: 'Watch', Icon: Eye, x: 50, y: 12 },
  { label: 'Evaluate', Icon: SlidersHorizontal, x: 85, y: 50 },
  { label: 'Improve', Icon: Sparkles, x: 50, y: 88 },
  { label: 'Verify', Icon: ShieldCheck, x: 15, y: 50 },
];
const next: Partial<Record<Phase, Phase>> = { watch: 'evaluate', evaluate: 'review', apply: 'verify', verify: 'done' };
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700';

export function LandingAutopilot() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    const hide = () => { if (document.hidden) setPlaying(false); };
    update(); media.addEventListener('change', update); document.addEventListener('visibilitychange', hide);
    return () => { media.removeEventListener('change', update); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => {
    if (!playing || reducedMotion || !next[phase]) return;
    const timer = window.setTimeout(() => setPhase(next[phase]!), 2200);
    return () => window.clearTimeout(timer);
  }, [phase, playing, reducedMotion]);
  const current = content[phase];
  const observed = phase === 'verify' || phase === 'done';
  const projected = !['idle', 'watch'].includes(phase);
  const start = () => { setPhase('watch'); setPlaying(true); };

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_48px_-24px_rgba(30,64,175,0.22)]">
    <div className="px-5 pt-5 sm:px-7 sm:pt-7"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Steel Potatoes · Example employer</p><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-blue-800">Simulated cycle</span></div></div>
    <div className="relative mx-auto my-3 hidden h-72 max-w-md sm:block" aria-hidden="true">
      <svg viewBox="0 0 400 288" className="absolute inset-0 h-full w-full" fill="none"><ellipse cx="200" cy="144" rx="140" ry="109" stroke="#dbeafe" strokeWidth="2" strokeDasharray="5 6"/><path d="M294 59l14 1-2-14M294 229l-2 14 14-2M104 229l-14-1 2 14M106 59l2-14-14 2" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>{current.step>=0&&<circle r="4" fill="#2563eb" className="transition-[offset-distance] duration-700 motion-reduce:transition-none" style={{offsetPath:"path('M 200 20 C 288 20 360 76 360 144 C 360 212 288 268 200 268 C 112 268 40 212 40 144 C 40 76 112 20 200 20')",offsetDistance:(phase==='done'?100:current.step*25)+'%'}}/>}</svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-700 text-white"><Sparkles size={21}/></div><p className="text-base font-semibold tracking-tight">Your plan</p><p className="mt-1 text-[11px] text-slate-500">{phase==='review'?'You stay in control':phase==='done'?'The next improvement starts here':'Watch. Improve. Repeat.'}</p></div>
      {steps.map(({ label, Icon, x, y },i) => <div key={label} style={{left:x+'%',top:y+'%'}} className={'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border px-3 py-2.5 text-xs font-medium '+(current.step===i?'border-blue-600 bg-blue-700 text-white shadow-md':'border-slate-200 bg-white text-slate-600')}><Icon size={14}/>{label}</div>)}
    </div>
    <ol className="mx-5 my-6 space-y-2 border-l border-blue-100 pl-4 sm:hidden" aria-label="Optimization cycle">{steps.map(({label,Icon},i)=><li key={label} aria-current={current.step===i?'step':undefined} className={'flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs '+(current.step===i?'bg-blue-700 font-medium text-white':'text-slate-500')}><Icon size={15}/><span>{i+1}. {label}</span></li>)}</ol>
    <div className="border-t border-slate-100 px-5 py-5 sm:px-7">
      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-24"><h3 className="text-sm font-semibold">{current.title}</h3><p className="mt-2 text-xs leading-relaxed text-slate-500">{current.detail}</p></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {phase==='idle'||phase==='done'?<button onClick={start} className={button+' bg-blue-700 text-white hover:bg-blue-800'}>{phase==='idle'?<Play size={13}/>:<RotateCcw size={13}/>} {phase==='idle'?'Play example':'Replay example'}</button>:phase==='review'?<button onClick={()=>{setPhase('apply');setPlaying(true)}} className={button+' bg-blue-700 text-white hover:bg-blue-800'}>Simulate approval <ArrowRight size={13}/></button>:reducedMotion?<button onClick={()=>setPhase(next[phase]!)} className={button+' bg-blue-700 text-white'}>Next step <ArrowRight size={13}/></button>:<button onClick={()=>setPlaying(!playing)} className={button+' border border-slate-200 text-slate-700 hover:bg-slate-50'}>{playing?<Pause size={13}/>:<Play size={13}/>} {playing?'Pause':'Continue'}</button>}
        {phase!=='idle'&&<button onClick={()=>{setPhase('idle');setPlaying(false)}} className={button+' text-slate-500 hover:bg-slate-50'}>Reset</button>}
      </div>
    </div>
    <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 sm:px-7">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 text-[11px]"><span className="font-medium text-slate-600">Example results</span><span className="text-right text-slate-500">Projected</span><span className="text-right text-slate-500">Observed*</span>
        {[['Net savings / fill','$120','$112'],['Members transitioned','20','18'],['Access issues','0','1']].map(([label,estimate,result])=><div key={label} className="contents"><span className="py-1 text-slate-600">{label}</span><span className="tnum py-1 text-right text-slate-800">{projected?estimate:'—'}</span><span className={'tnum py-1 text-right '+(observed?'text-amber-800':'text-slate-400')}>{observed?result:'—'}</span></div>)}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">*Synthetic outcomes, not live monitoring or realized savings. This example does not change a benefit or send messages.</p>
    </div>
  </div>;
}
