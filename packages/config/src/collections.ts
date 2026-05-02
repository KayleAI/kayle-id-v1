export function indexBy<T, K extends keyof T>(
  items: readonly T[],
  key: K
): Map<T[K], T> {
  return new Map(items.map((item) => [item[key], item] as const));
}
