import { describe, expect, it } from 'vitest'

import type { ProviderMetaSummary } from './contracts'
import {
  applyValidatedProviderConnection,
  buildConnectedProviderState,
  deriveWorkspaceBootstrap,
  EMPTY_WORKSPACE_STATE,
  mergeProviderDraftsWithConnectedCommands,
} from './providerWorkspace'
import { INITIAL_PROVIDER_DRAFTS } from './contracts'

const configured = (provider: ProviderMetaSummary['provider'], details?: ProviderMetaSummary['details']): ProviderMetaSummary => ({
  provider,
  displayName: provider,
  configured: true,
  missing: [],
  requiresCli: provider.includes('code') || provider === 'codex',
  envVars: [],
  details,
})

describe('deriveWorkspaceBootstrap', () => {
  it('stays in setup when nothing is configured', () => {
    const result = deriveWorkspaceBootstrap([], EMPTY_WORKSPACE_STATE)

    expect(result.shouldEnterWorkspace).toBe(false)
    expect(result.activeProviderId).toBeNull()
    expect(result.setupProviderId).toBeNull()
  })

  it('restores workspace using persisted active provider when still configured', () => {
    const result = deriveWorkspaceBootstrap(
      [configured('gemini'), configured('codex')],
      {
        connectedProviderIds: ['codex', 'gemini'],
        activeProviderId: 'codex',
        lastSuccessfulProviderId: 'codex',
      },
      ['codex', 'gemini'],
    )

    expect(result.shouldEnterWorkspace).toBe(true)
    expect(result.connectedProviderIds).toEqual(['codex', 'gemini'])
    expect(result.activeProviderId).toBe('codex')
  })

  it('falls back to the last successful provider when persisted active is unavailable', () => {
    const result = deriveWorkspaceBootstrap(
      [configured('gemini'), configured('claude-code')],
      {
        connectedProviderIds: ['openai', 'gemini'],
        activeProviderId: 'openai',
        lastSuccessfulProviderId: 'gemini',
      },
      ['gemini'],
    )

    expect(result.connectedProviderIds).toEqual(['gemini'])
    expect(result.activeProviderId).toBe('gemini')
    expect(result.shouldEnterWorkspace).toBe(true)
  })

  it('stays in setup when providers are configured but there is no successful connection history', () => {
    const result = deriveWorkspaceBootstrap(
      [configured('gemini'), configured('claude-code')],
      EMPTY_WORKSPACE_STATE,
    )

    expect(result.shouldEnterWorkspace).toBe(false)
    expect(result.connectedProviderIds).toEqual([])
    expect(result.setupProviderId).toBe('gemini')
  })

  it('keeps the user in setup until this browser session validates the provider', () => {
    const result = deriveWorkspaceBootstrap(
      [configured('codex')],
      {
        connectedProviderIds: ['codex'],
        activeProviderId: 'codex',
        lastSuccessfulProviderId: 'codex',
      },
      [],
    )

    expect(result.shouldEnterWorkspace).toBe(false)
    expect(result.connectedProviderIds).toEqual([])
    expect(result.setupProviderId).toBe('codex')
  })
})

describe('provider workspace helpers', () => {
  it('builds persisted state from connected providers and active provider', () => {
    expect(buildConnectedProviderState(['gemini', 'codex'], 'codex')).toEqual({
      connectedProviderIds: ['gemini', 'codex'],
      activeProviderId: 'codex',
      lastSuccessfulProviderId: 'codex',
    })
  })

  it('merges helper-reported CLI commands into drafts', () => {
    const next = mergeProviderDraftsWithConnectedCommands(INITIAL_PROVIDER_DRAFTS, [
      configured('claude-code', { command: 'claude' }),
      configured('codex', { command: '/usr/local/bin/codex' }),
    ])

    expect(next['claude-code'].command).toBe('claude')
    expect(next.codex.command).toBe('/usr/local/bin/codex')
  })

  it('keeps the current active provider when adding another provider without switching', () => {
    expect(
      applyValidatedProviderConnection({
        connectedProviderIds: ['gemini'],
        activeProviderId: 'gemini',
        validatedProviderId: 'codex',
        makeActive: false,
      }),
    ).toEqual({
      connectedProviderIds: ['gemini', 'codex'],
      activeProviderId: 'gemini',
      lastSuccessfulProviderId: 'codex',
    })
  })
})
