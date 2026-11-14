export function activeFsDescriptors(list: Record<string, unknown>[]): Record<string, unknown>[]
export function activeFsId(id: string): string
export function fsHdrColorBase(id: string): string | undefined
export const fsModeId: string
export function fsInputRoute(
  map: unknown,
  base: string,
): { source: string; banks: Record<string, string> } | undefined
export function matchingDescriptor(
  list: Record<string, unknown>[],
  id: string,
): Record<string, unknown> | undefined
