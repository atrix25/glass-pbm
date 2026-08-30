/**
 * Turns tool output into something a member can read.
 *
 * Every sentence here is a template whose blanks are filled from tool results.
 * There is no arithmetic in this file and no restating of a number that a tool
 * did not return, which is the property that makes the answers checkable. When
 * an API key is present the language model rewrites the prose, but it is given
 * the same tool output and told the same thing: do not compute.
 */

import type { Citation, ToolResult } from "./tools";
import { formatRxOopEligibleLevels } from "@/lib/rx-oop";

export interface ToolRun {
  tool: string;
  args: unknown;
  because: string;
  error: string | null;
  result: unknown;
}

export interface ComposedAnswer {
  paragraphs: string[];
  citations: Citation[];
  /** Links the UI turns into buttons under the answer. */
  links: { label: string; href: string }[];
  /** Set when the agent is deliberately refusing to answer. */
  handoff?: string;
}

type Data = Record<string, unknown>;

function pick(runs: ToolRun[], tool: string): ToolResult<Data> | null {
  const run = runs.find((r) => r.tool === tool && r.result && !r.error);
  return (run?.result as ToolResult<Data>) ?? null;
}

function pickAll(runs: ToolRun[], tool: string): ToolResult<Data>[] {
  return runs
    .filter((r) => r.tool === tool && r.result && !r.error)
    .map((r) => r.result as ToolResult<Data>);
}

/**
 * Questions the agent should not answer, no matter how good the data is.
 *
 * The line is not "is this about a drug", because every question here is about
 * a drug. It is "does answering this require knowing something about this
 * person's body". Coverage, price and channel do not. Whether a medicine suits
 * them, at what dose, alongside what else, does, and a benefit administrator
 * who answers those has quietly started practising without a licence.
 *
 * The list errs towards refusing. A member who is told to ask their prescriber
 * about something the agent could have answered has lost a minute. The other
 * kind of mistake is not recoverable, which is why the patterns cover the
 * indirect phrasings — "is this okay with", "can I drink" — and not only the
 * ones with the word "safe" in them.
 */
const CLINICAL = [
  /should i (take|stop|switch|use|be on|keep taking|continue)/i,
  /(is|are) (it|this|that|they|these) safe/i,
  /\bis \w[\w\s'-]{0,40} safe\b/i,
  /safe (to|with|for) /i,
  /side effect/i,
  /interact(s|ion|ions)? with/i,
  /\bwith my other (medication|med|drug|prescription)/i,
  /\btake .{0,30}\btogether\b/i,
  /dosage|what dose|which dose|how much should i take|how many should i take/i,
  /\bdose .{0,20}(should|do) i\b/i,
  /am i allergic|allergic to/i,
  /instead of my/i,
  /diagnos/i,
  /\bcan i drink\b|\bwith alcohol\b/i,
  /\bwhile (pregnant|breastfeeding|nursing)\b|\bif i('m| am) pregnant\b/i,
  /\bis (it|this) working\b|\bwhy do i feel\b/i,
  /\bskip a dose\b|\bmissed (a )?dose\b|\bdouble up\b/i,
];

export function clinicalRefusal(question: string): string | null {
  if (!CLINICAL.some((r) => r.test(question))) return null;
  return "That is a clinical question, and I am not the right place for it. I can tell you what your plan covers and what it will cost, but whether a medication is right for you is between you and your prescriber. If you want, I can look up what the plan pays for an alternative once your prescriber names one.";
}

/** Present the request the member actually asked about first. */
function asksAboutDenial(question: string): boolean {
  return /\bdenied\b|denial|turned down|rejected my (request|pa|prior)|why was.*(not|n.t) approv/i.test(
    question,
  );
}

function humanRole(role: unknown): string {
  const r = String(role ?? "").toLowerCase();
  if (r === "ai" || r === "auto" || r === "system") return "automated review";
  if (r === "pharmacist") return "a pharmacist";
  if (r === "physician" || r === "md") return "a physician reviewer";
  if (r === "technician") return "a pharmacy technician";
  return r ? `a ${r}` : "";
}

export function compose(
  question: string,
  intent: string,
  runs: ToolRun[],
): ComposedAnswer {
  // One entry per source document. Two tools citing the same contract at
  // different clauses is one document with two locators, not two sources.
  const links: { label: string; href: string }[] = [];
  const byDoc = new Map<string, Citation & { locators: string[] }>();
  for (const run of runs) {
    const r = run.result as ToolResult | undefined;
    for (const c of r?.citations ?? []) {
      const existing = byDoc.get(c.sourceId);
      if (existing) {
        if (c.locator && !existing.locators.includes(c.locator)) {
          existing.locators.push(c.locator);
        }
      } else {
        byDoc.set(c.sourceId, {
          ...c,
          locators: c.locator ? [c.locator] : [],
        });
      }
    }
  }
  const citations: Citation[] = [...byDoc.values()].map((c) => ({
    sourceId: c.sourceId,
    title: c.title,
    publisher: c.publisher,
    url: c.url,
    locator: c.locators.join(" · ") || undefined,
  }));

  const refusal = clinicalRefusal(question);
  if (refusal) {
    return { paragraphs: [refusal], citations: [], links: [], handoff: "clinical" };
  }

  /*
   * The narrative follows the intent the planner committed to, not whichever
   * tool happens to be in the result set. Inferring it from tool presence
   * meant that any plan touching getAccumulators produced an out-of-pocket
   * lecture, including "how much is my atorvastatin".
   */
  const writers: Record<string, () => string[] | null> = {
    "unknown-drug": () => composeUnknownDrug(runs),
    "oop-limit": () => composeAccumulators(runs, links),
    "pa-status": () => composePriorAuth(runs, links, question),
    refill: () => composeRefill(runs),
    "cost-quote": () => composeCostQuote(runs, links),
    cheaper: () => composeAlternatives(runs),
    coverage: () => composeCoverage(runs),
    "claim-question": () => composeClaims(runs, links),
    pharmacy: () => composePharmacies(runs),
  };

  // Fall back through the other writers only if the intended one had no data
  // to work with, so a near-miss on routing still produces a useful answer.
  const ordered = [
    writers[intent],
    ...Object.entries(writers)
      .filter(([k]) => k !== intent)
      .map(([, fn]) => fn),
  ].filter(Boolean) as (() => string[] | null)[];

  let paragraphs: string[] | null = null;
  for (const write of ordered) {
    paragraphs = write();
    if (paragraphs && paragraphs.length > 0) break;
  }

  return {
    paragraphs: paragraphs ?? composeFallback(runs),
    citations,
    links,
  };
}

// ---------------------------------------------------------------------------

function composeAccumulators(
  runs: ToolRun[],
  links: { label: string; href: string }[],
): string[] | null {
  const acc = pick(runs, "getAccumulators");
  if (!acc) return null;
  const d = acc.data;
  const claims = pick(runs, "getClaims");

  const out: string[] = [];

  if (d.prescriptionLimitReached) {
    out.push(
      `You have reached the ${d.prescriptionLimit} prescription out-of-pocket limit, and you are right that you are still being charged. Those are both true at the same time, which is confusing, and it is worth being precise about why.`,
    );
    const levels = Array.isArray(d.levelsThatCountTowardPrescriptionLimit)
      ? formatRxOopEligibleLevels(
          d.levelsThatCountTowardPrescriptionLimit as string[],
        )
      : "Level 1 and Level 2";
    const outside = (d.paidOutsidePrescriptionLimit ??
      d.paidOnLevel3And4ThatDoesNotCount) as string;
    out.push(
      `Your plan has two separate limits. The ${d.prescriptionLimit} one only counts what you pay on ${levels} drugs. Cost share at other levels does not count toward it. You have paid ${d.totalPaidThisYear} in total this year: ${d.appliedToPrescriptionLimit} of that reached the ${d.prescriptionLimit} limit, and ${outside} came from fills that sit outside it.`,
    );
    out.push(
      `What you are still paying on now runs against the second limit, the federal out-of-pocket maximum of ${d.federalLimit}. You are at ${d.federalApplied} against that one.`,
    );
  } else {
    const levels = Array.isArray(d.levelsThatCountTowardPrescriptionLimit)
      ? formatRxOopEligibleLevels(
          d.levelsThatCountTowardPrescriptionLimit as string[],
        )
      : "Level 1 and Level 2";
    out.push(
      `You have paid ${d.totalPaidThisYear} for prescriptions this year. Of that, ${d.appliedToPrescriptionLimit} counts toward your ${d.prescriptionLimit} prescription out-of-pocket limit, so you have ${d.prescriptionLimitRemaining} to go before ${levels} drugs become free for the rest of the year.`,
    );
    const outside = (d.paidOutsidePrescriptionLimit ??
      d.paidOnLevel3And4ThatDoesNotCount) as string | undefined;
    if (outside && outside !== "$0.00") {
      out.push(
        `The gap between those two numbers is ${outside}, and it is not an error. Cost share on fills that sit outside the ${d.prescriptionLimit} limit under this plan counts toward the federal out-of-pocket maximum of ${d.federalLimit} instead.`,
      );
    }
  }

  const rows = (claims?.data as unknown as Data[] | undefined) ?? [];
  const offenders = Array.isArray(rows)
    ? rows.filter(
        (c) =>
          c.status === "paid" &&
          c.countsTowardPrescriptionLimit === false &&
          c.memberPaid !== "$0.00",
      )
    : [];
  if (offenders.length > 0) {
    const names = Array.from(new Set(offenders.map((c) => String(c.drug))));
    out.push(
      names.length === 1
        ? `The fill doing this is your ${names[0]}. It shows the full arithmetic if you want to check it.`
        : `The fills doing this are ${listOf(names.slice(0, 3))}${names.length > 3 ? `, among ${names.length} in total` : ""}. Each one shows the full arithmetic if you want to check it.`,
    );
    const first = offenders[0];
    if (first?.claimId) {
      links.push({
        label: `See the ${first.drug} claim`,
        href: `/claims/${first.claimId}`,
      });
    }
  }
  links.push({ label: "My claims and spending", href: "/members" });
  return out;
}

// ---------------------------------------------------------------------------

function composePriorAuth(
  runs: ToolRun[],
  links: { label: string; href: string }[],
  question: string,
): string[] | null {
  const pa = pick(runs, "getPriorAuthStatus");
  if (!pa) return null;
  const requests = (pa.data.requests as Data[]) ?? [];
  if (requests.length === 0) {
    return [
      "There are no prior authorization requests on file for you. If a pharmacy told you one is needed, it means your prescriber has not sent it yet. The form is on the Navitus site, and the plan has 72 hours to decide a standard request once it arrives, or 24 hours if your prescriber marks it urgent.",
    ];
  }

  const out: string[] = [];
  const approved = requests.filter((r) => r.determination === "Approved");
  const denied = requests.filter((r) => r.determination === "Denied");
  const denialFirst = asksAboutDenial(question) && denied.length > 0;

  const writeDenied = () => {
    for (const r of denied) {
      out.push(
        `Your ${r.drug} request was denied${r.decided ? ` on ${r.decided}` : ""}, and I can tell you exactly where it stopped. It was denied at step ${r.decidingStep} of the ${r.criteriaDocument} criteria, on the question "${r.decidingQuestion}"${r.denialReason ? `. The recorded reason: ${r.denialReason}` : "."}`,
      );
      out.push(
        `This is a paperwork outcome, not a judgment about whether you need the drug. The criteria ask for a documented trial of specific therapies first, or a documented reason you cannot take them. If your prescriber has that history and it was not on the form, resubmitting with it is usually enough. You also have the right to appeal, and your prescriber can request an expedited review if waiting would harm you.`,
      );
      if (r.detailUrl) {
        links.push({
          label: "See exactly which step denied it",
          href: String(r.detailUrl),
        });
      }
    }
  };

  const writeApproved = () => {
    for (const r of approved) {
      const who = humanRole(r.decidedBy);
      const lead = denialFirst
        ? `There is good news attached to this. A later ${r.drug} request was approved`
        : `Your ${r.drug} prior authorization is approved`;
      out.push(
        `${lead}${r.approvedThrough ? ` through ${r.approvedThrough}` : ""}${r.approvedForDays ? `, an approval of ${r.approvedForDays} days` : ""}.${r.decidingStep ? ` It cleared at step ${r.decidingStep} of the published criteria: "${r.decidingQuestion}"` : ""}${r.decided ? ` The decision was made on ${r.decided}${who ? ` by ${who}` : ""}.` : ""}`,
      );
      out.push(
        denialFirst
          ? `So the therapy is covered now. The difference between the two requests was documentation, not medicine: the second one recorded why the required alternatives were not options for you.`
          : `You do not need to do anything before the approval ends. When it does, your prescriber has to submit a continuation request, and the criteria for continuing are different from the criteria for starting.`,
      );
      if (r.detailUrl) {
        links.push({
          label: `Full ${r.drug} decision record`,
          href: String(r.detailUrl),
        });
      }
    }
  };

  if (denialFirst) {
    writeDenied();
    writeApproved();
  } else {
    writeApproved();
    writeDenied();
  }

  const criteria = pick(runs, "explainCriteria");
  if (criteria && (criteria.data.steps as unknown[])?.length) {
    const steps = criteria.data.steps as Data[];
    out.push(
      `For reference, coverage of ${criteria.data.scope} is decided by walking ${steps.length} numbered questions in the ${criteria.data.criteriaDocument} form. It is a published document, not an internal policy, and the step numbers here are the step numbers printed on it.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

function composeRefill(runs: ToolRun[]): string[] | null {
  const r = pick(runs, "refillEligibility");
  if (!r) return null;
  const d = r.data;
  if (d.found === false) {
    return [String(r.summary)];
  }
  const which = d.rejectedOn
    ? `That was your ${d.drug}, turned away on ${d.rejectedOn}.`
    : "";

  if (d.eligibleNow) {
    const staleDays = d.rejectedOn
      ? Math.floor(
          (Date.now() - Date.parse(String(d.rejectedOn))) / 86_400_000,
        )
      : 0;
    if (staleDays > 30) {
      return [
        `${which} That rejection has long since cleared. The fill before it was ${d.lastFilled} for ${d.daysSupplyDispensed} days, and the plan allowed the refill from ${d.eligibleForRefillOn}, so you were free to pick it up ${d.daysSupplyDispensed ? `${Math.floor((Date.parse(String(d.eligibleForRefillOn)) - Date.parse(String(d.rejectedOn))) / 86_400_000)} days after the pharmacy turned you away` : "shortly afterward"}.`,
        `If a pharmacy is telling you "too soon" today, it is about a different prescription. Tell me which one and I will date it exactly.`,
      ];
    }
    return [
      `${which} You can fill it now. The last one went through on ${d.lastFilled} for ${d.daysSupplyDispensed} days, and the plan allows a refill once ${d.thresholdPercent}% of that supply has elapsed, which was ${d.eligibleForRefillOn}. If the pharmacy is still getting a rejection today, it is something other than refill timing and I can look at the actual claim.`.trim(),
    ];
  }
  return [
    `${which} Not yet, but soon. The last fill went through on ${d.lastFilled} for a ${d.daysSupplyDispensed}-day supply, and the plan allows the next one once ${d.thresholdPercent}% of that supply has elapsed. That date is ${d.eligibleForRefillOn}, which is ${d.daysToWait} ${Number(d.daysToWait) === 1 ? "day" : "days"} from today.`.trim(),
    `The rule exists so the plan is not paying for medication that piles up unused, and it applies to everyone rather than being a decision about you. If you are traveling or genuinely out early, your pharmacy can request a vacation override and the plan will usually grant it.`,
  ];
}

// ---------------------------------------------------------------------------

function composeCostQuote(
  runs: ToolRun[],
  links: { label: string; href: string }[],
): string[] | null {
  const est = pick(runs, "estimateCost");
  if (!est) return null;
  const d = est.data;
  const cov = pick(runs, "checkCoverage");

  if (d.found === false) {
    return [String(est.summary)];
  }
  if (d.wouldPay === false) {
    return [
      `A fill of ${d.drug} today would not go through. The rejection would be ${d.rejectCode}, ${d.rejectReason}.`,
      String(d.memberExplanation ?? ""),
    ].filter(Boolean);
  }

  const free = d.memberPays === "$0.00";
  const out: string[] = [
    free
      ? `Nothing. A ${d.daysSupply}-day supply of ${d.drug} at ${d.pharmacy} costs you ${d.memberPays}, and the plan covers the full ${d.totalCostOfFill}.`
      : `A ${d.daysSupply}-day supply of ${d.drug} at ${d.pharmacy} would cost you ${d.memberPays}. The full cost of the fill is ${d.totalCostOfFill}, and the plan pays the remaining ${d.planPays}.`,
  ];
  if (cov) {
    const level = String(cov.data.benefitLevel);
    out.push(
      level === "$0"
        ? `${d.drug} is on the plan's preventive list, which is covered in full with no cost share at all. There is no copay and no coinsurance on it.`
        : `${d.drug} is a Level ${level} drug on your formulary, which means ${cov.data.costShare}. ${d.countsTowardPrescriptionLimit ? "What you pay counts toward your $600 prescription out-of-pocket limit." : "What you pay on this one does not count toward the $600 prescription limit, only toward the federal maximum."}`,
    );
    if (cov.data.priorAuthorizationRequired) {
      out.push(
        `One thing to know before you go: this drug requires prior authorization, so your prescriber has to get it approved first or the pharmacy will turn you away.`,
      );
    }
    if (cov.data.specialtyPharmacyRequired) {
      out.push(
        `It also has to be filled at Lumicera or UW Health Specialty Pharmacy. A retail counter cannot fill it under this plan.`,
      );
    }
  }
  if (!free) {
    out.push(
      `This is not an estimate from a lookup table. I ran the quote through the same engine that processes your real claims, against today's date, so it is the number the pharmacy would see.`,
    );
    links.push({ label: "How this price is built", href: "/methodology" });
  }
  return out;
}

// ---------------------------------------------------------------------------

function composeAlternatives(runs: ToolRun[]): string[] | null {
  const alt = pick(runs, "findAlternatives");
  if (!alt) return null;
  const alternatives = (alt.data.alternatives as Data[]) ?? [];
  const current = alt.data.current as Data | undefined;

  if (alternatives.length === 0) {
    const sameLevel = Number(alt.data.comparableAtSameLevel ?? 0);
    if (sameLevel > 0) {
      return [
        `There is nothing cheaper. ${current?.drug} is Level ${current?.level}, and the ${sameLevel} comparable ${sameLevel === 1 ? "drug" : "drugs"} the plan covers in the same class ${sameLevel === 1 ? "sits" : "sit"} at the same level, so switching would not change what you pay.`,
        `That is common for specialty therapies. The place where cost actually moves for you is the out-of-pocket limits rather than the choice of drug, and I can tell you where you stand against those if it is useful.`,
      ];
    }
    return [
      `I could not find a lower-level alternative to ${current?.drug ?? "that drug"}. I compared within the same therapeutic class, the same route of administration, and the same specialty status, and nothing covered by the plan came back at a lower level.`,
    ];
  }
  const lines = alternatives
    .slice(0, 4)
    .map(
      (a) =>
        `${a.drug} is Level ${a.level} (${a.costShare})${a.priorAuthorizationRequired ? ", though it needs prior authorization" : ""}`,
    );
  return [
    `${current?.drug} sits at Level ${current?.level} on your plan. In the same therapeutic class there ${alternatives.length === 1 ? "is one option" : `are ${alternatives.length} options`} at a lower level: ${listOf(lines)}.`,
    `Whether any of these is right for you is a question for your prescriber, not for me. What I can say is what the plan would charge. If your prescriber agrees to switch and writes a new prescription, the pharmacy can fill it and the lower cost share applies immediately.`,
  ];
}

// ---------------------------------------------------------------------------

function composeCoverage(runs: ToolRun[]): string[] | null {
  const cov = pick(runs, "checkCoverage");
  if (!cov) return null;
  const d = cov.data;
  if (d.found === false) {
    return [
      `I could not find a product matching that name on your plan's formulary. If you can give me the exact name as printed on the bottle, or the NDC number from the label, I can check it properly.`,
    ];
  }
  if (d.planExclusion) {
    return [
      `${d.drug} is excluded from the pharmacy benefit entirely. That is not a coverage level or a prior authorization situation; the plan does not pay for it at all, and prior authorization will not change that.`,
    ];
  }
  if (d.onFormulary === false) {
    return [
      `${d.drug} is not on the plan's formulary, so it is not covered. Your prescriber can request a formulary exception, or you can ask about a covered alternative in the same class.`,
    ];
  }

  const out = [
    `${d.drug} is covered at Level ${d.benefitLevel}, which means ${d.costShare}. ${d.countsTowardPrescriptionLimit ? "What you pay counts toward your $600 prescription out-of-pocket limit." : "What you pay does not count toward the $600 prescription limit, only the federal maximum."}`,
  ];
  const conditions: string[] = [];
  if (d.priorAuthorizationRequired)
    conditions.push("your prescriber has to get prior authorization first");
  if (d.stepTherapyRequired)
    conditions.push("the plan requires a documented trial of another therapy first");
  if (d.quantityLimit) conditions.push(`there is a quantity limit: ${d.quantityLimit}`);
  if (d.diagnosisRestriction)
    conditions.push(`it is covered only for ${d.diagnosisRestriction}`);
  if (d.specialtyPharmacyRequired)
    conditions.push(
      "it must be filled at Lumicera or UW Health Specialty Pharmacy rather than a retail counter",
    );
  if (conditions.length > 0) {
    out.push(
      `There ${conditions.length === 1 ? "is one condition" : `are ${conditions.length} conditions`} attached: ${listOf(conditions)}.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

function composeClaims(
  runs: ToolRun[],
  links: { label: string; href: string }[],
): string[] | null {
  const claims = pick(runs, "getClaims");
  if (!claims) return null;
  const rows = claims.data as unknown as Data[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return ["I do not see any claims on file for you this year."];
  }

  const rejected = rows.filter((r) => r.status === "rejected");
  const out: string[] = [];

  if (rejected.length > 0) {
    const r = rejected[0];
    out.push(
      `Your ${r.drug} fill at ${r.pharmacy} on ${r.date} was rejected: ${sentence(r.rejectReason)}`,
    );
    if (rejected.length > 1) {
      out.push(
        `There ${rejected.length === 2 ? "is one more" : `are ${rejected.length - 1} more`} rejected in the last few months as well: ${listOf(rejected.slice(1, 4).map((x) => `${x.drug} on ${x.date}, ${trimPeriod(String(x.rejectReason))}`))}.`,
      );
    }
    if (r.claimId) {
      links.push({
        label: "See the full rejection detail",
        href: `/claims/${r.claimId}`,
      });
    }
    return out;
  }

  const recent = rows.slice(0, 4);
  out.push(
    `Your most recent fills: ${listOf(recent.map((c) => `${c.drug} on ${c.date}, ${c.memberPaid} of a ${c.totalCost} total`))}.`,
  );
  out.push(
    `Every one of those has the complete derivation behind it, down to what the pharmacy paid to acquire the drug. Ask me about any one of them and I can walk through it.`,
  );
  if (recent[0]?.claimId) {
    links.push({
      label: `Open the ${recent[0].drug} claim`,
      href: `/claims/${recent[0].claimId}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

function composePharmacies(runs: ToolRun[]): string[] | null {
  const ph = pick(runs, "findPharmacies");
  if (!ph) return null;
  const rows = ph.data as unknown as Data[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return ["I could not find in-network pharmacies matching that."];
  }
  const specialty = rows.filter((r) => r.designatedSpecialty);
  const out = [
    `There are ${rows.length} in-network pharmacies I can see: ${listOf(rows.slice(0, 5).map((r) => `${r.name} in ${r.city}`))}${rows.length > 5 ? ", among others" : ""}.`,
  ];
  if (specialty.length > 0) {
    out.push(
      `For specialty medications the plan designates ${listOf(specialty.map((s) => String(s.name)))}. Specialty drugs will not process anywhere else.`,
    );
  }
  out.push(
    `Filling outside the network means the plan pays nothing, so it is worth checking before you transfer a prescription.`,
  );
  return out;
}

// ---------------------------------------------------------------------------

function composeFallback(runs: ToolRun[]): string[] {
  const profile = pick(runs, "getMemberProfile");
  const acc = pick(runs, "getAccumulators");
  const out: string[] = [];
  if (profile?.data.name) {
    out.push(
      `You are covered under the ${profile.data.plan} for ${profile.data.planYear}, effective ${profile.data.coverageEffective}.`,
    );
  }
  if (acc) {
    out.push(
      `You have paid ${acc.data.totalPaidThisYear} for prescriptions this year, ${acc.data.appliedToPrescriptionLimit} of which counts toward your ${acc.data.prescriptionLimit} prescription out-of-pocket limit.`,
    );
  }
  out.push(
    `I am not certain what you are asking. I can help with what a drug will cost, whether something is covered, why a claim was rejected, where your prior authorization stands, when you can refill, and how much you have paid toward your limits. If you rephrase it I will try again, or I can hand this to a person.`,
  );
  return out;
}

// ---------------------------------------------------------------------------

function composeUnknownDrug(runs: ToolRun[]): string[] | null {
  const run = runs.find((r) => r.tool === "checkCoverage");
  if (!run) return null;
  const args = (run.args ?? {}) as { drugName?: string };
  const named = args.drugName ?? "that drug";

  return [
    `I could not find ${named} in the plan's drug file, so I have nothing reliable to tell you about how it would be covered. It may be spelled differently, it may be sold under another name, or it may simply not be a product this plan lists.`,
    `If you can give me the name as it appears on the bottle or the prescription, I will look it up properly. I would rather say I do not know than guess at a benefit level and have you plan around a number that is not real.`,
  ];
}

/** Reject messages sometimes already end in a period, sometimes do not. */
function trimPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

function sentence(s: unknown): string {
  const t = String(s ?? "").trim();
  return t.endsWith(".") ? t : `${t}.`;
}

function listOf(items: (string | number)[]): string {
  const s = items.map(String);
  if (s.length === 0) return "";
  if (s.length === 1) return s[0];
  if (s.length === 2) return `${s[0]} and ${s[1]}`;
  return `${s.slice(0, -1).join(", ")}, and ${s.at(-1)}`;
}
