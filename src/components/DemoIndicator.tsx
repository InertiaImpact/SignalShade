import { useEffect, useRef, useState } from 'react'
import { subscribeDemoChanges } from '../core/demo-feedback'

export function DemoIndicator({ simulated, total }: { simulated: number; total: number }) {
  const [ping, setPing] = useState(0)
  const [active, setActive] = useState(false)
  const [labels, setLabels] = useState<string[]>([])
  const lastPing = useRef(-Infinity)
  useEffect(
    () =>
      subscribeDemoChanges((names) => {
        setLabels(names)
        const now = Date.now()
        if (now - lastPing.current < 700) return
        lastPing.current = now
        setActive(true)
        setPing((n) => n + 1)
      }),
    [],
  )
  useEffect(() => {
    if (!ping) return
    const timer = setTimeout(() => setActive(false), 700)
    return () => clearTimeout(timer)
  }, [ping])
  useEffect(() => {
    if (!simulated) {
      setActive(false)
      setLabels([])
      lastPing.current = -Infinity
    }
  }, [simulated])
  const mode = simulated ? (simulated === total ? 'DEMO' : 'MIXED') : total ? 'LIVE' : 'NO DEVICES'
  return (
    <span
      className={`mode-pill ${simulated ? 'demo' : ''}`}
      title={
        simulated
          ? labels.length
            ? `Demo device updated: ${labels.join(', ')}. These targets are simulated.`
            : `${simulated} demo device${simulated === 1 ? '' : 's'} — simulated controls.`
          : total
            ? 'Live devices'
            : 'No devices added'
      }
    >
      <span aria-hidden="true" />
      {mode}
      {simulated > 0 && active && <i key={ping} className="demo-ping" aria-hidden="true" />}
    </span>
  )
}
