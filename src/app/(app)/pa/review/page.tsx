import Link from "next/link";
import { ArrowLeft, Bot, ShieldCheck } from "lucide-react";
import { Card, CardHeader, SectionTitle, Stat } from "@/components/ui";
import { PaReviewConsole } from "@/components/pa-review";
import { ExceptionIntake } from "@/components/exception-intake";
import {
  getIntakeOptions,
  getReviewQueue,
  ON_DUTY_PHARMACIST,
} from "@/lib/queries/pa";
import { getClock } from "@/lib/session";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PharmacistReviewConsole() {
  const clock = await getClock();
  const [queue, targets] = await Promise.all([
    getReviewQueue(clock),
    getIntakeOptions(clock),
  ]);

  const total =
    queue.signature.length + queue.unresolved.length + queue.noCriteria.length;

  return (
    <div className="space-y-5">
      <Link
        href="/pa"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 transition hover:text-ink-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Prior authorization queue
      </Link>

      <SectionTitle description="The work that automation could not finish, and the one kind it is not permitted to finish. A traversal that reaches an approve edge is recorded on the spot and never appears here. A traversal that reaches a deny edge stops, unrecorded, and waits on this screen for a licensed reviewer to sign it or overturn it.">
        Pharmacist review
      </SectionTitle>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Waiting on a pharmacist"
            value={formatNumber(total)}
            tone={queue.signature.length > 0 ? "accent" : "default"}
            sub={`${queue.signature.length} recommended refusals unsigned, ${queue.unresolved.length} unresolved traversals, ${queue.noCriteria.length} with no transcribed form`}
          />
          <Stat
            label="Approved by automation"
            value={formatNumber(queue.recordedByAutomation)}
            tone="positive"
            sub="in the last 24 simulated hours, each citing the step that approved it"
          />
          <Stat
            label="Refusals released"
            value={formatNumber(queue.deniedToday)}
            sub="in the same window, every one of them signed by a person"
          />
          <Stat
            label="Refusals by automation"
            value={formatNumber(queue.everDeniedByAutomation)}
            tone={queue.everDeniedByAutomation === 0 ? "positive" : "negative"}
            sub={
              queue.everDeniedByAutomation === 0
                ? "across the whole book, which is the invariant this console exists to keep"
                : "which should be impossible; the authorisation check has been bypassed"
            }
          />
        </div>
      </Card>

      <Card className="border-glass-600/25 bg-glass-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-glass-700" />
          <div>
            <h2 className="text-[13.5px] font-semibold text-glass-900">
              Why the split is here and not in a policy document
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-glass-900/75">
              An approval reached by walking published criteria is checkable: it
              names the numbered step that produced it, and if the traversal is
              wrong the member received a medicine they were entitled to anyway.
              A refusal is a clinical judgment that carries appeal rights, and it
              needs a named reviewer who can be asked why. So the rule is a
              function every write path has to pass through rather than a
              paragraph on a page — and the button marked{" "}
              <span className="inline-flex items-center gap-1 font-medium">
                <Bot className="h-3.5 w-3.5" />
                try to record it as automation
              </span>{" "}
              sends exactly that write and shows you the server rejecting it.
            </p>
          </div>
        </div>
      </Card>

      <PaReviewConsole
        signature={queue.signature}
        unresolved={queue.unresolved}
        noCriteria={queue.noCriteria}
        reviewer={ON_DUTY_PHARMACIST}
        nowIso={clock.now.toISOString()}
      />

      <Card>
        <CardHeader
          title="Intake: exceptions, appeals, and grievances"
          description="The paths a member has when the answer was no. Each one is filed as its own request with its own clock rather than as an edit to the record it contests, because an appeal that mutates what it appeals against destroys the evidence of what was first decided and by whom."
        />
        <ExceptionIntake targets={targets} />
      </Card>
    </div>
  );
}
