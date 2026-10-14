import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  distDir:
    process.env.DOCUCRAFT_COVERAGE === "1" ? ".next-coverage" : ".next",
};

export default nextConfig;
