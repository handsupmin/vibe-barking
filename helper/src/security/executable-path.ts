const SAFE_EXECUTABLE = /^[A-Za-z0-9_./:-]+$/;

export function assertSafeExecutablePath(
	value: string,
	label = "executable path",
): void {
	if (!SAFE_EXECUTABLE.test(value)) {
		throw new Error(`Unsafe ${label}.`);
	}
}
