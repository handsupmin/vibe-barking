export function isProviderSessionFatalError(message?: string): boolean {
  if (!message) {
    return false
  }

  return [
    /please login again/i,
    /does not have access to claude/i,
    /authentication[_\s-]*failed/i,
    /not authenticated/i,
    /unauthorized/i,
    /invalid api key/i,
  ].some((pattern) => pattern.test(message))
}
