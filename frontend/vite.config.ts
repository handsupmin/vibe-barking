import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type UserConfig } from 'vite'

export interface HelperProxyEnv {
  HELPER_HOST?: string
  HELPER_PORT?: string
  VITE_HELPER_PROXY_TARGET?: string
}

export function getHelperProxyTarget(env: HelperProxyEnv): string {
  if (env.VITE_HELPER_PROXY_TARGET) {
    return env.VITE_HELPER_PROXY_TARGET
  }

  const host = env.HELPER_HOST || '127.0.0.1'
  const port = env.HELPER_PORT || '4318'

  return `http://${host}:${port}`
}

export function createViteConfig(env: HelperProxyEnv): UserConfig {
  const helperProxyTarget = getHelperProxyTarget(env)
  const apiProxy = {
    target: helperProxyTarget,
    changeOrigin: true,
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiProxy,
      },
    },
    preview: {
      proxy: {
        '/api': apiProxy,
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as HelperProxyEnv
  return createViteConfig(env)
})
