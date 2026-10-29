import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary packages stay outside the server bundle.
  serverExternalPackages: ["sharp", "playwright-core", "@sparticuz/chromium", "@libsql/client", "libsql"],
  // The serverless Chromium binary is loaded by path at runtime, so tracing can't see it.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
