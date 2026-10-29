import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary packages stay outside the server bundle.
  serverExternalPackages: ["sharp", "playwright-core"],
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
