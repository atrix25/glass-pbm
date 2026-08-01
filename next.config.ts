import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The Prisma client is generated into the source tree, and its native query
  // engine is loaded by path at runtime rather than by import, so Next's
  // tracer cannot see it. Without this the standalone bundle starts and then
  // fails on the first query.
  outputFileTracingIncludes: {
    "/**": ["./src/generated/prisma/**"],
  },
};

export default nextConfig;
