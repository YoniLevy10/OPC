import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow e2e/prod builds to avoid racing a concurrent `next dev` on `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Ops desk mutates via server actions then redirects to the same URL.
  // Default client router cache can keep the pre-lock ticket tree mounted.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
  // pdfkit loads Helvetica via package imports (#standard-fonts/*); NFT misses
  // those files and a failed QR PDF can unrecoverably kill the Node isolate.
  serverExternalPackages: ['@react-pdf/renderer', 'pdfkit', 'fontkit'],
  outputFileTracingIncludes: {
    '/api/reports/export': [
      './src/assets/fonts/**/*',
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/pdfkit/js/data/**/*',
    ],
    '/api/cron/monthly-report': [
      './src/assets/fonts/**/*',
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/pdfkit/js/data/**/*',
    ],
    '/api/stores/qr-batch': [
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/pdfkit/js/data/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
