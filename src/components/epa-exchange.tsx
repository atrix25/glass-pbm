"use client";

import { useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { EpaTransaction } from "@/lib/pa/epa";
import type { Questionnaire } from "@/lib/pa/questionnaire";

interface Props {
  transactions: EpaTransaction[];
  questionnaire: Questionnaire;
  unusedAnswers: string[];
}

export function EpaExchange({ transactions, questionnaire, unusedAnswers }: Props) {
  const [open, setOpen] = useState<number | null>(2);
  const prepopulated = questionnaire.item.filter((i) => i.readOnly);

  return (
    <Card>
      <CardHeader
        title="Electronic prior authorization exchange"
        description="The four NCPDP SCRIPT transactions this request was carried on. The plan supplies the questions at step 2, which is what lets an authorization be answered in one pass instead of a fax exchange — and is also where a plan could ask for clinical detail its published criteria never mention."
      />

      <ol className="divide-y divide-ink-100">
        {transactions.map((t) => {
          const expanded = open === t.step;
          return (
            <li key={t.step}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : t.step)}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-ink-50/60"
              >
                <span className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-900 text-[10.5px] font-semibold text-white">
                  {t.step}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-medium text-ink-900">
                      {t.name}
                    </span>
                    <Badge tone={t.from === "Plan" ? "accent" : "neutral"}>
                      {t.from === "Plan" ? "plan to prescriber" : "prescriber to plan"}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-700">
                    {t.summary}
                  </span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-500">
                    {t.highlight}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-ink-400 transition",
                    expanded && "rotate-90",
                  )}
                />
              </button>

              {expanded ? (
                <div className="border-t border-ink-100 bg-ink-50/40 px-5 py-4">
                  {t.step === 2 ? (
                    <QuestionSet questionnaire={questionnaire} />
                  ) : null}
                  <details className="mt-3 first:mt-0">
                    <summary className="cursor-pointer text-[11.5px] font-medium text-ink-600 hover:text-ink-900">
                      {t.step === 2
                        ? "The FHIR Questionnaire as sent"
                        : "The message payload"}
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded border border-ink-200 bg-white p-3 text-[11px] leading-relaxed text-ink-700">
                      {JSON.stringify(t.payload, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2 border-t border-ink-100 px-5 py-4 text-[11.5px] leading-relaxed text-ink-500">
        {prepopulated.length > 0 ? (
          <p>
            <span className="font-medium text-ink-700">
              {prepopulated.length} of {questionnaire.item.length} questions
            </span>{" "}
            were answered from the plan&apos;s own records and returned read-only.
            A prescriber is not asked to recall a claims history the plan already
            holds, and cannot overwrite the record the determination is made from.
          </p>
        ) : null}
        <p>
          {unusedAnswers.length === 0 ? (
            <>
              Every answer collected was used. No question was asked whose answer
              the criteria never read.
            </>
          ) : (
            <>
              {unusedAnswers.length} answer
              {unusedAnswers.length === 1 ? " was" : "s were"} collected but not
              reached, because an earlier step ended the form.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

function QuestionSet({ questionnaire }: { questionnaire: Questionnaire }) {
  return (
    <ul className="space-y-2">
      {questionnaire.item.map((item) => (
        <li
          key={item.linkId}
          className="rounded border border-ink-200 bg-white px-3 py-2.5"
        >
          <div className="flex items-start gap-2">
            <span className="font-mono text-[10.5px] text-ink-400">
              {item.linkId}
            </span>
            {item.readOnly ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-glass-700">
                <Lock className="h-2.5 w-2.5" />
                prepopulated
              </span>
            ) : null}
            <span className="ml-auto font-mono text-[10.5px] text-ink-400">
              {item.type}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-ink-800">{item.text}</p>

          {item.enableWhen?.length ? (
            <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
              Shown only when{" "}
              {item.enableWhen
                .map(
                  (w) =>
                    `${w.question} ${w.operator} ${
                      w.answerCoding?.code ??
                      w.answerString ??
                      String(w.answerBoolean)
                    }`,
                )
                .join(item.enableBehavior === "all" ? " and " : " or ")}
              . Derived from the criteria tree&apos;s own branches, not authored
              separately.
            </p>
          ) : null}

          {item.answerOption?.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {item.answerOption.map((o, i) => (
                <li key={i} className="text-[11px] text-ink-600">
                  &middot;{" "}
                  {o.valueCoding?.display ?? o.valueString ?? o.valueCoding?.code}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
