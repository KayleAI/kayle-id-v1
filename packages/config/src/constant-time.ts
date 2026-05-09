/**
 * Compares two strings without short-circuiting on the first mismatching byte.
 * The loop runs over the longer input so length mismatch does not create a
 * separate early-return timing path for secret-derived values.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  // biome-ignore lint/suspicious/noBitwiseOperators: constant-time length accumulator
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < maxLength; index++) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time XOR/OR accumulator
    mismatch |= aCode ^ bCode;
  }

  return mismatch === 0;
}
