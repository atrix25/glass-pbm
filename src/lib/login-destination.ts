/** Accept only same-site destinations and avoid returning to public sign-in pages. */
export function loginDestination(next: string | null): string {
  const fallback = "/workspace";
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\x00-\x20]/.test(next)) return fallback;
  try {
    const url = new URL(next, "https://sapphire.invalid");
    if (url.origin !== "https://sapphire.invalid" || ["/", "/login", "/login/"].includes(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
