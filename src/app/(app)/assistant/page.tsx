import { demoFeaturesEnabled } from "@/lib/config";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Assistant } from "@/components/assistant";
import { SectionTitle } from "@/components/ui";
import { getActiveMemberId } from "@/lib/session";
import { setActiveMember } from "@/app/actions/session";
import { DEMO_MEMBER_BY_ID, DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const GENERAL_PROMPTS = [
  "What have I paid for prescriptions this year?",
  "Is there a cheaper alternative to what I am taking?",
  "Where can I fill a specialty prescription?",
];

export default async function AssistantPage() {
  const activeId = await getActiveMemberId();
  const member =
    (await prisma.member.findUnique({ where: { id: activeId } })) ??
    (await prisma.member.findFirst({ where: { id: DEMO_MEMBER_STORIES[0].id } }));
  if (!member) throw new Error("No members seeded");

  const story = DEMO_MEMBER_BY_ID[member.id];
  const suggestions = story
    ? [story.prompt, ...GENERAL_PROMPTS.slice(0, 2)]
    : GENERAL_PROMPTS;

  return (
    <div className="space-y-4">
      <SectionTitle description={"Member service, with answers drawn from plan rules."}>
        Member service
      </SectionTitle>

      {demoFeaturesEnabled() && <Link href="/member-calls" className="inline-flex rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-glass-700">Simulate a member call →</Link>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-ink-500">Asking as</span>
        {DEMO_MEMBER_STORIES.map((m) => (
          <form key={m.id} action={setActiveMember}>
            <input type="hidden" name="memberId" value={m.id} />
            <input type="hidden" name="next" value="/assistant" />
            <button
              type="submit"
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] transition",
                m.id === member.id
                  ? "border-glass-600 bg-glass-600 text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-glass-400 hover:text-glass-800",
              )}
            >
              {m.name}
              <span
                className={cn(
                  "ml-1.5 text-[11px]",
                  m.id === member.id ? "text-white/65" : "text-ink-400",
                )}
              >
                {m.tag}
              </span>
            </button>
          </form>
        ))}
        <Link
          href={`/members/${member.id}`}
          className="ml-auto text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
        >
          Open this member&apos;s record
        </Link>
      </div>

      {story ? (
        <p className="rounded-lg border border-ink-200 bg-ink-50/60 px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-800">{story.name}:</span>{" "}
          {story.story}
        </p>
      ) : null}

      <Assistant
        key={member.id}
        memberId={member.id}
        memberName={`${member.firstName} ${member.lastName}`}
        suggestions={suggestions}
      />
    </div>
  );
}
