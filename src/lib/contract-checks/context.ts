import "server-only";
import { cookies } from "next/headers";
import { demoFeaturesEnabled } from "@/lib/config";
import { SPONSOR_COOKIE, sponsorKey } from "./profiles";
export async function selectedSponsor() {
  return sponsorKey(demoFeaturesEnabled() ? (await cookies()).get(SPONSOR_COOKIE)?.value : undefined);
}
