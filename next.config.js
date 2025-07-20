/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Add fallback for node-specific modules
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        os: false,
        url: false,
        assert: false,
        util: false,
      };
    }

    return config;
  },

  // Make sure Google Cloud packages are treated as external on client side
  experimental: {
    serverComponentsExternalPackages: ['@google-cloud/storage'],
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig; 