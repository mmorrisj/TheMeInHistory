import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Era Packs are read from the filesystem at request time on the server.
  // Keep the YAML out of the client bundle entirely.
  serverExternalPackages: ["yaml"],
};

export default nextConfig;
