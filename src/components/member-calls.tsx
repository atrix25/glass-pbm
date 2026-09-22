"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Check, Loader2, Phone, Play, Square, Volume2 } from "lucide-react";
import { MEMBER_CALL_SCENARIOS, scenarioMemberId } from "@/lib/member-call-scenarios";
import type { MemberAnswer } from "@/lib/agents/member-service/agent";
import { WorkStepCard } from "@/components/assistant";

type Answer = Omit<MemberAnswer, "runId">;
type Turn = { question: string; answer?: Answer; error?: string };

const subscribeAudio = () => () => {};
const readAudio = () => "speechSynthesis" in window;
const noAudio = () => false;

export function MemberCalls() {
  const [scenarioId, setScenarioId] = useState(MEMBER_CALL_SCENARIOS[0].id);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const audioAvailable = useSyncExternalStore(subscribeAudio, readAudio, noAudio);
  const [speaking, setSpeaking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const scenario = MEMBER_CALL_SCENARIOS.find(s => s.id === scenarioId)!;
  const answer = turns[selected]?.answer;

  useEffect(() => {
    return () => {
      controller.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function stopAudio() { window.speechSynthesis?.cancel(); setSpeaking(false); }
  function stop() { controller.current?.abort(); stopAudio(); }
  function choose(id: string) {
    stopAudio(); setScenarioId(id); setTurns([]); setSelected(0); setInput("");
  }

  async function run(questions: string[], fresh = false) {
    if (controller.current || !questions.length) return;
    stopAudio();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setInput("");
    let index = fresh ? 0 : turns.length;
    if (fresh) setTurns([]);
    try {
      for (const question of questions) {
        if (active.signal.aborted) break;
        const position = index++;
        setTurns(previous => [...previous, { question }]);
        setSelected(position);
        try {
          const response = await fetch("/api/member-calls", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memberId: scenarioMemberId(scenarioId), question }),
            signal: active.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "The agent could not finish.");
          if (active.signal.aborted) throw new Error("Call stopped.");
          setTurns(previous => previous.map((turn, i) => i === position ? { question, answer: result } : turn));
        } catch (error) {
          const message = active.signal.aborted ? "Call stopped." : error instanceof Error ? error.message : "Connection interrupted. Try again.";
          setTurns(previous => previous.map((turn, i) => i === position ? { question, error: message } : turn));
          break;
        }
      }
    } finally { controller.current = null; setBusy(false); }
  }

  function listen() {
    if (!answer || !audioAvailable) return;
    stopAudio();
    const text = [`Member. ${turns[selected].question}`, `Agent. ${answer.paragraphs.join(" ")}`].join(" ");
    const speech = new SpeechSynthesisUtterance(text);
    speech.rate = 0.95;
    speech.onend = speech.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(speech);
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
      <span className="rounded-full border border-glass-600/20 bg-glass-50 px-3 py-1 font-medium text-glass-800">Call simulator</span>
      <span>Scripted caller · Rules-based agent · No phone connection</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {MEMBER_CALL_SCENARIOS.map(s => <button key={s.id} disabled={busy} onClick={() => choose(s.id)} aria-pressed={scenarioId === s.id}
        className={`rounded-xl border p-4 text-left transition disabled:opacity-50 ${scenarioId === s.id ? "border-glass-600 bg-glass-50/40 ring-1 ring-glass-600" : "border-ink-200 bg-white hover:border-ink-400"}`}>
        <span className="block text-xs text-ink-500">{s.member}</span>
        <span className="mt-2 block text-sm font-semibold text-ink-900">{s.title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-500">{s.description}</span>
      </button>)}
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="flex items-center gap-3"><Phone className="h-4 w-4 text-glass-700" /><div><h2 className="text-sm font-semibold">{scenario.member}</h2><p className="mt-0.5 text-xs text-ink-500">{scenario.title}</p></div></div>
          <button onClick={() => busy ? stop() : void run(scenario.questions, true)} className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-xs font-medium text-white hover:bg-ink-700">
            {busy ? <Square size={13} /> : <Play size={13} />}{busy ? "Stop call" : turns.length ? "Replay call" : "Start call"}
          </button>
        </div>
        <div className="min-h-[320px] space-y-6 p-5" aria-live="polite" aria-busy={busy}>
          {!turns.length && <div className="flex min-h-[280px] flex-col items-center justify-center text-center"><Phone className="mb-4 h-7 w-7 text-ink-300" /><p className="text-sm font-medium text-ink-800">Ready to call</p><p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-500">Start this scenario or type a member question. Each reply uses the demo member’s plan and records.</p></div>}
          {turns.map((turn, i) => <div key={i} className="space-y-3">
            <div className="ml-auto max-w-[90%] rounded-xl bg-ink-900 px-4 py-3 text-sm leading-relaxed text-white"><span className="mb-1 block text-[10px] uppercase tracking-wider text-white/60">Member</span>{turn.question}</div>
            {turn.answer ? <div className={`rounded-xl border p-4 ${selected === i ? "border-glass-600/30 bg-glass-50/20" : "border-ink-100 bg-ink-50/40"}`}>
              <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Member service</span><button onClick={() => { stopAudio(); setSelected(i); }} aria-pressed={selected === i} className="text-xs font-medium text-glass-700 underline underline-offset-4">View checks</button></div>
              {turn.answer.paragraphs.map((p,j) => <p key={j} className="mt-2 text-sm leading-relaxed text-ink-800">{p}</p>)}
              <p className="mt-3 text-xs font-medium text-ink-500">{turn.answer.handoffPacket ? "Staff review recommended" : "Response complete"} · {turn.answer.work.length} checks</p>
            </div> : turn.error ? <p role="alert" className="text-sm text-rose-700">{turn.error}</p> : <p className="flex items-center gap-2 text-xs text-ink-500"><Loader2 size={14} className="animate-spin" />Checking member records…</p>}
          </div>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); if (input.trim()) void run([input.trim()]); }} className="border-t border-ink-100 p-4">
          <div className="flex gap-2"><input aria-label="Member question" maxLength={2000} value={input} onChange={e => setInput(e.target.value)} placeholder="Type a member question…" className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm" /><button aria-label="Send question" disabled={busy || !input.trim()} className="rounded-lg bg-ink-900 px-3 text-white disabled:opacity-30"><ArrowUp size={16} /></button></div>
          <p className="mt-2 text-[11px] text-ink-400">Include the drug and details in each question. Conversation memory is not enabled.</p>
        </form>
      </section>
      <aside className="space-y-4 rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Agent work</h2>{answer && audioAvailable && <button onClick={speaking ? stopAudio : listen} className="flex items-center gap-1.5 text-xs text-glass-700"><Volume2 size={14} />{speaking ? "Stop audio" : "Listen"}</button>}</div>
        <p className="text-xs leading-relaxed text-ink-500">{answer ? `Question ${selected + 1} · ${answer.work.length} checks. Expand a check to inspect its source data.` : "The agent’s checks and recommended handoff appear here."}</p>
        {answer?.work.map((step,i) => <WorkStepCard key={`${selected}-${i}`} step={step as Parameters<typeof WorkStepCard>[0]["step"]} index={i} />)}
        {answer?.handoffPacket && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="text-xs font-semibold text-amber-950">Recommended handoff</h3><p className="mt-2 text-sm text-amber-950">{answer.handoffPacket.suggestedOwner}</p><p className="mt-2 text-xs leading-relaxed text-amber-900">{answer.handoffPacket.reason}</p><p className="mt-3 text-[11px] text-amber-800">Simulation only. No ticket or employee assignment created.</p></div>}
        {answer && !answer.handoffPacket && <p className="flex items-center gap-2 text-xs text-glass-800"><Check size={14} />No handoff proposed</p>}
        <p className="border-t border-ink-100 pt-4 text-[11px] leading-relaxed text-ink-400">Uses the existing member-service tools. Simulated calls do not change benefits or enter staff queues. Transcript stays in this tab. Listen uses browser read-aloud.</p>
      </aside>
    </div>
  </div>;
}
