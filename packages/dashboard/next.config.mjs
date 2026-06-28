/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module — keep it external instead of bundling it
  // into the server build.
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // onnxruntime-web (in-browser YOLO) references Node builtins it never uses in
  // the browser bundle — stub them so the client build resolves cleanly.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    }
    return config
  },
}

export default nextConfig
