import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Build-time env validation plugin.
 * Runs during `vite build` (and on dev-server start) so misconfigured
 * testnet/mainnet deployments fail before any assets are compiled.
 */
function envValidationPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'oversync-env-validation',
    // Only validate during actual builds, not during vitest / dev server.
    apply: 'build',
    buildStart() {
      const errors: string[] = [];

      const apiBase = env['VITE_API_BASE_URL']?.trim();
      if (!apiBase) {
        errors.push('VITE_API_BASE_URL is required (e.g. http://localhost:3001)');
      } else if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
        errors.push(`VITE_API_BASE_URL must be a valid HTTP(S) URL (got "${apiBase}")`);
      }

      const networkMode = (env['VITE_NETWORK'] ?? env['VITE_NETWORK_MODE'])?.trim();
      if (!networkMode) {
        errors.push("VITE_NETWORK is required ('testnet' or 'mainnet')");
      } else if (networkMode !== 'testnet' && networkMode !== 'mainnet') {
        errors.push(`VITE_NETWORK must be 'testnet' or 'mainnet' (got "${networkMode}")`);
      }

      const mainnetEnabled = env['VITE_MAINNET_ENABLED'] === 'true';
      const auditConfirmed = env['VITE_MAINNET_AUDIT_CONFIRMED'] === 'true';
      if (mainnetEnabled && !auditConfirmed) {
        errors.push(
          'VITE_MAINNET_ENABLED=true requires VITE_MAINNET_AUDIT_CONFIRMED=true. ' +
          'Complete docs/DEPLOYMENT.md#mainnet-rollout-checklist first.'
        );
      }

      if (errors.length > 0) {
        throw new Error(
          'Frontend build aborted — fix these env vars:\n' +
          errors.map((e) => `  - ${e}`).join('\n')
        );
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  const isProduction = mode === 'production';

  return {
    plugins: [react(), envValidationPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: Number(env.VITE_APP_PORT) || 5173,
      host: env.VITE_APP_HOST || 'localhost',
      open: false,
      cors: true,
    },
    // Strip all console.* calls and debugger statements from production
    // bundles. Local development still logs normally. This avoids leaking
    // wallet addresses, order payloads, balances and other runtime state
    // through devtools when users hit the public deployment.
    esbuild: isProduction
      ? {
          drop: ['console', 'debugger'],
          legalComments: 'none',
        }
      : {},
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Disable inline source maps in production to avoid handing reviewers
      // a fully reconstructable source tree from the public bundle.
      sourcemap: isProduction ? false : true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            ui: ['@rainbow-me/rainbowkit', 'wagmi'],
            crypto: ['ethers'],
          },
        },
      },
    },
    define: {
      // Expose environment variables to the client
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    // Environment variables validation
    envPrefix: 'VITE_',
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'ethers',
        '@rainbow-me/rainbowkit',
        'wagmi',
      ],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
}) 