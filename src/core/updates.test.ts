import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWaitingUpdate, publishUpdate, subscribeUpdates } from './updates'

afterEach(() => publishUpdate(undefined))
describe('update notification lifetime', () => {
  it('retains an already-waiting update before the application subscribes', () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
    publishUpdate(worker)
    const listener = vi.fn(),
      unsubscribe = subscribeUpdates(listener)
    expect(getWaitingUpdate()).toBe(worker)
    publishUpdate(undefined)
    expect(listener).toHaveBeenCalledOnce()
    expect(getWaitingUpdate()).toBeUndefined()
    unsubscribe()
  })
})
