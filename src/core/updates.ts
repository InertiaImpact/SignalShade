// A stored snapshot avoids losing an update notification before React subscribes.
let waitingWorker: ServiceWorker | undefined
const listeners = new Set<() => void>()
export function publishUpdate(worker: ServiceWorker | undefined) {
  waitingWorker = worker
  listeners.forEach((listener) => listener())
}
export const getWaitingUpdate = () => waitingWorker
export function subscribeUpdates(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
