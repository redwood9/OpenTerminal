import type { NextConfig } from "next";

// API requests are proxied by web/app/api/[...path]/route.ts instead of a
// rewrite here, so the shared API key can be attached server-side. See
// web/lib/api-key.ts.
const nextConfig: NextConfig = {
  // Avoid `output: "standalone"`: Next's file-tracing mkdir race fails on some
  // NAS filesystems (QNAP) and crash-loops the web image. Plain `next start` is reliable.
};

export default nextConfig;
