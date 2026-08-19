"use client";

import Link from "next/link";
import {
  AnswerLinks,
  BusyIndicator,
  ChatComposer,
  ChatLayout,
  ChatWindow,
  CitationList,
  QuestionBubble,
  useAgentChat,
  WelcomeIntro,
  WorkPanel,
  type AgentAnswerBase,
  type Turn,
} from "@/components/agent-chat";

interface HandoffPacket {
  reason: string;
  memberName: string;
  cardholderId: string;
  question: string;
  established: string[];
  suggestedOwner: string;
}

interface Answer extends AgentAnswerBase {
  drug: string | null;
  handoff: string | null;
  handoffPacket: HandoffPacket | null;
}

const TOOL_LABEL: Record<string, string> = {
  getMemberProfile: "Read the member record",
  getAccumulators: "Read out-of-pocket accumulators",
  getClaims: "Search claims history",
  explainClaim: "Pull one claim's derivation",
  checkCoverage: "Look up the formulary entry",
  estimateCost: "Price a fill through the engine",
  getPriorAuthStatus: "Read prior authorization records",
  explainCriteria: "Open the published criteria",
  findAlternatives: "Search the formulary for alternatives",
  refillEligibility: "Compute refill timing",
  findPharmacies: "Search the pharmacy network",
};

export function Assistant({
  memberId,
  memberName,
  suggestions,
}: {
  memberId: string;
  memberName: string;
  suggestions: string[];
}) {
  // A new member means a new conversation. Carrying Margaret's thread into
  // David's view would show one member's numbers under another's name.
  const { turns, input, setInput, busy, send, scrollRef, last } =
    useAgentChat<Answer>({
      endpoint: "/api/assistant",
      buildBody: (question) => ({ question, memberId }),
      resetKey: memberId,
    });

  return (
    <ChatLayout
      workPanel={
        <WorkPanel
          answer={last}
          busy={busy}
          description="The agent chooses one question at a time and looks at the answer before choosing the next. The rules engine answers all of them."
          toolLabels={TOOL_LABEL}
          showStepCitations
          emptyWork={
            /*
             * A refusal is the one answer that reaches no tools, and an empty
             * panel next to it reads as a fault rather than as the point. The
             * decision not to look anything up is itself the work.
             */
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/50 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-900">
                No tool was called
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-950">
                The agent read the question, decided it was not one the
                plan&rsquo;s data can answer, and stopped there. Looking up
                coverage would have produced a confident reply to a question
                nobody asked.
              </p>
            </div>
          }
          footer={(answer) => (
            <>
              Routed as{" "}
              <span className="font-medium text-ink-700">{answer.intent}</span>
              {answer.drug ? (
                <>
                  {" "}
                  on{" "}
                  <span className="font-medium text-ink-700">
                    {answer.drug}
                  </span>
                </>
              ) : null}
              . No figure in the reply was produced by the language layer.{" "}
              <Link
                href={`/agents/runs/${answer.runId}`}
                className="text-glass-700 hover:text-glass-900"
              >
                Full trace
              </Link>
              .
            </>
          )}
        />
      }
    >
      <ChatWindow
        scrollRef={scrollRef}
        composer={
          <ChatComposer
            input={input}
            onInputChange={setInput}
            busy={busy}
            onSend={send}
            placeholder={`Ask as ${memberName}…`}
            chips={turns.length > 0 ? suggestions.slice(0, 3) : []}
          />
        }
      >
        {turns.length === 0 ? (
          <WelcomeIntro
            title="Member service, answering as itself"
            description={
              <>
                You are asking on behalf of {memberName}. Every figure in the
                reply is returned by a tool that reads this plan&apos;s
                documents and this member&apos;s adjudicated claims. The panel
                on the right shows each call the agent made and what came back,
                so any answer can be checked rather than trusted.
              </>
            }
            suggestions={suggestions}
            onPick={send}
          />
        ) : (
          <div className="space-y-6">
            {turns.map((turn, i) => (
              <Exchange key={i} turn={turn} />
            ))}
            {busy ? (
              <BusyIndicator label="Reading the plan documents and this member's claims" />
            ) : null}
          </div>
        )}
      </ChatWindow>
    </ChatLayout>
  );
}

// ---------------------------------------------------------------------------

/** The handoff reason is a label, and it has to end before the next sentence. */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function Exchange({ turn }: { turn: Turn<Answer> }) {
  return (
    <div className="space-y-3">
      <QuestionBubble question={turn.question} />
      {turn.answer ? (
        <div className="max-w-[92%]">
          <div className="space-y-3 rounded-2xl rounded-bl-md bg-ink-50 px-4 py-3.5">
            {turn.answer.paragraphs.map((p, i) => (
              <p key={i} className="text-[13.5px] leading-relaxed text-ink-800">
                {p}
              </p>
            ))}
          </div>

          <AnswerLinks links={turn.answer.links} />

          {turn.answer.handoffPacket ? (
            <div className="mt-2 rounded-xl border border-amber-300/70 bg-amber-50/60 px-3.5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-amber-900">
                Handed to a person, with the context attached
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-amber-950">
                {sentence(turn.answer.handoffPacket.reason)} The ticket goes to{" "}
                {turn.answer.handoffPacket.suggestedOwner.toLowerCase()}
                {turn.answer.handoffPacket.established.length > 0
                  ? `, with everything the agent already established, so nobody asks ${turn.answer.handoffPacket.memberName.split(" ")[0]} the same questions again.`
                  : ", who is the only person who can answer it."}
              </p>
              {turn.answer.handoffPacket.established.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {turn.answer.handoffPacket.established.map((e, i) => (
                    <li
                      key={i}
                      className="text-[11.5px] leading-snug text-amber-900"
                    >
                      · {e}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <CitationList citations={turn.answer.citations} />
        </div>
      ) : null}
    </div>
  );
}
