import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@media-track/workflow"],
  // Cache Components: PPR becomes the default rendering model. "use cache"
  // builds the static shell; runtime reads live inside Suspense holes.
  cacheComponents: true,
};

export default nextConfig;
