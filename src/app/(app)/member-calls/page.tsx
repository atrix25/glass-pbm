import { notFound } from "next/navigation";
import { demoFeaturesEnabled } from "@/lib/config";
import { SectionTitle } from "@/components/ui";
import { MemberCalls } from "@/components/member-calls";

export const dynamic = "force-dynamic";
export default function MemberCallsPage() {
  if (!demoFeaturesEnabled()) notFound();
  return <div className="space-y-6">
    <SectionTitle description="Simulated members. Actual service-agent responses.">Member calls</SectionTitle>
    <MemberCalls />
  </div>;
}
