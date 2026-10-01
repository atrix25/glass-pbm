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

interface Answer extends AgentAnswerBase {
  briefingMarkdown: string | null;
  handoff: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  getBookSnapshot: "Read the book snapshot",
  getContractReports: "Pull contract report sections",
  getTrendDrivers: "Compute the PMPM trend bridge",
  getTopSpend: "Rank top drugs and classes",
  getSettlementSnapshot: "Read settlement and receivables",
  getGuaranteeScorecard: "Read the operational scorecard",
  getHighCostDrugUm: "List UM rules on top-spend drugs",
  searchFormularyUm: "Search the formulary UM index",
  getPriorAuthOverview: "Read PA queue and determinations",
  getMacOverview: "Read MAC list and appeals",
  getMemberExperience: "Compute census NPS and drivers",
  getIntegrityOverview: "Read program integrity signals",
  getRejectOverview: "Summarize claim reject codes",
  getClinicalOverview: "Read clinical alert screening",
  getEligibilityOverview: "Read eligibility feed status",
  lookupClaims: "Search the claim ledger",
  getClaimDetail: "Open one claim's derivation",
  composeReportBriefing: "Compose a report briefing",
};

export function DataAgent({ suggestions }: { suggestions: string[] }) {
  const { turns, input, setInput, busy, send, scrollRef, last } =
    useAgentChat<Answer>({
      endpoint: "/api/data-agent",
      buildBody: (question) => ({ question }),
    });

  return (
    <ChatLayout
      workPanel={
        <WorkPanel
          answer={last}
          busy={busy}
          description="Tools read the sponsor rollups and contract reports. No figure in the reply was produced by the language layer alone."
          toolLabels={TOOL_LABEL}
          footer={(answer) => (
            <>
              Routed as{" "}
              <span className="font-medium text-ink-700">{answer.intent}</span>
              .{" "}
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
            placeholder="Ask about the book, guarantees, rebates, trends…"
            chips={turns.length > 0 ? suggestions.slice(0, 3) : []}
          />
        }
      >
        {turns.length === 0 ? (
          <WelcomeIntro
            title="Data agent for the plan book"
            description={
              <>
                Ask for totals, contract reports, trend drivers, or a composed
                briefing. Every figure is returned by a query over the claim
                ledger — the same numbers as the sponsor and reports pages. The
                panel on the right shows each tool call.
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
              <BusyIndicator label="Querying the claim ledger and contract reports" />
            ) : null}
          </div>
        )}
      </ChatWindow>
    </ChatLayout>
  );
}

function Exchange({ turn }: { turn: Turn<Answer> }) {
  return (
    <div className="space-y-3">
      <QuestionBubble question={turn.question} />
      {turn.answer ? (
        <div className="max-w-[92%]">
          <div className="space-y-3 rounded-2xl rounded-bl-md bg-ink-50 px-4 py-3.5">
            {turn.answer.paragraphs.map((p, i) =>
              p === "——" ? (
                <hr key={i} className="border-ink-200" />
              ) : p.startsWith("#") ? (
                <p
                  key={i}
                  className="text-[13px] font-semibold leading-relaxed text-ink-900"
                >
                  {p.replace(/^#+\s*/, "")}
                </p>
              ) : (
                <p
                  key={i}
                  className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-800"
                >
                  {p}
                </p>
              ),
            )}
          </div>

          <AnswerLinks links={turn.answer.links} />

          <CitationList citations={turn.answer.citations} />
        </div>
      ) : null}
    </div>
  );
}
