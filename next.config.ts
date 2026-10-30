import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary packages stay outside the server bundle.
  serverExternalPackages: ["sharp", "playwright-core", "@sparticuz/chromium", "@libsql/client", "libsql"],
  // Files loaded by computed paths at runtime, which tracing can't see: the serverless
  // Chromium binary, and playwright-core's package/browsers JSON (read when it loads).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/playwright-core/package.json", "./node_modules/playwright-core/browsers.json"],
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
