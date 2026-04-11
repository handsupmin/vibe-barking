import { describe, expect, it } from 'vitest'

import { createViteConfig, getHelperProxyTarget } from './vite.config'

describe('getHelperProxyTarget', () => {
  it('defaults to the local helper origin', () => {
    expect(getHelperProxyTarget({})).toBe('http://127.0.0.1:4318')
  })

  it('prefers an explicit Vite proxy target when provided', () => {
    expect(
      getHelperProxyTarget({
        VITE_HELPER_PROXY_TARGET: 'http://127.0.0.1:9999',
        HELPER_HOST: '0.0.0.0',
        HELPER_PORT: '4318',
      }),
    ).toBe('http://127.0.0.1:9999')
  })
})

describe('vite proxy wiring', () => {
  it('proxies /api to the local helper in dev and preview', () => {
    const resolved = createViteConfig({})

    expect(resolved.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:4318',
      changeOrigin: true,
    })
    expect(resolved.preview?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:4318',
      changeOrigin: true,
    })
  })
})
