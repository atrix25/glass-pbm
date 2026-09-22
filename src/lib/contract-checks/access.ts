import "server-only";
import { authMode } from "@/lib/config";
import { getSessionUser } from "@/lib/session";
export async function authenticatedStaff(){
  const mode=authMode();
  if(mode==="session"||mode==="oidc")return ["admin","ops","plan_sponsor"].includes((await getSessionUser())?.role??"");
  return true; // Basic credentials are verified by the existing request proxy.
}
export function sameOrigin(request:Request){
  try{return new URL(request.headers.get("origin")??"").host===(request.headers.get("x-forwarded-host")??request.headers.get("host")??new URL(request.url).host);}catch{return false;}
}
