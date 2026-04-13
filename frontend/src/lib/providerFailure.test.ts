import { describe, expect, it } from 'vitest'

import { isProviderSessionFatalError } from './providerFailure'

describe('isProviderSessionFatalError', () => {
  it('detects login and auth blockers that require revalidation', () => {
    expect(
      isProviderSessionFatalError(
        'Your organization does not have access to Claude. Please login again or contact your administrator.',
      ),
    ).toBe(true)
    expect(isProviderSessionFatalError('authentication_failed')).toBe(true)
  })

  it('does not mark generic generation failures as fatal auth blockers', () => {
    expect(isProviderSessionFatalError('Codex CLI timed out after 180000ms.')).toBe(false)
    expect(isProviderSessionFatalError('Preview load failed with status 404')).toBe(false)
  })
})
