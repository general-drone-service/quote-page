import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/quote/generate-and-save": ["./src/lib/pdf/fonts/**/*"],
  },
};

export default nextConfig;
