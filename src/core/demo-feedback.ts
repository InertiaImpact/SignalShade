import type { Workspace } from './types'

const listeners = new Set<(labels: string[]) => void>()
export function subscribeDemoChanges(listener: (labels: string[]) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function notifyDemoChange(labels: string[]) {
  if (labels.length) listeners.forEach((listener) => listener([...new Set(labels)]))
}

// Compare operator-visible device settings, not polling timestamps or pending flags.
export function changedDemoLabels(before: Workspace, after: Workspace): string[] {
  const view = (workspace: Workspace) =>
    new Map([
      ...workspace.devices
        .filter((d) => d.simulated)
        .map(
          (d) =>
            [
              d.id,
              {
                label: d.label,
                settings: JSON.stringify([
                  d.label,
                  d.model,
                  d.address,
                  d.armed,
                  workspace.channels
                    .filter((c) => c.deviceId === d.id)
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((c) => [
                      c.id,
                      c.label,
                      c.locked,
                      c.source,
                      c.format,
                      c.context,
                      Object.entries(c.values).sort(([a], [b]) => a.localeCompare(b)),
                    ]),
                ]),
              },
            ] as const,
        ),
      ...(workspace.recorders ?? [])
        .filter((r) => r.simulated)
        .map(
          (r) =>
            [
              r.id,
              {
                label: r.label,
                settings: JSON.stringify([
                  r.label,
                  r.model,
                  r.address,
                  r.warningMinutes,
                  !!r.autoConnect,
                ]),
              },
            ] as const,
        ),
    ])
  const previous = view(before),
    next = view(after)
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter((id) => previous.get(id)?.settings !== next.get(id)?.settings)
    .map((id) => (next.get(id) ?? previous.get(id))!.label)
}
