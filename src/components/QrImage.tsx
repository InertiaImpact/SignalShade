import { useEffect, useState } from 'react'

export function QrImage({
  link,
  label,
  unavailable,
}: {
  link: string
  label: string
  unavailable: string
}) {
  const [code, setCode] = useState<{ count: number; pixels: string } | null>()
  useEffect(() => {
    let current = true
    void import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, link.length > 2331 ? 'L' : 'M')
        qr.addData(link)
        qr.make()
        const count = qr.getModuleCount()
        let pixels = ''
        for (let row = 0; row < count; row++)
          for (let col = 0; col < count; col++)
            if (qr.isDark(row, col)) pixels += `M${col} ${row}h1v1h-1z`
        if (current) setCode({ count, pixels })
      })
      .catch(() => {
        if (current) setCode(null)
      })
    return () => {
      current = false
    }
  }, [link])
  if (!code) return <p role="status">{code === null ? unavailable : 'Preparing QR…'}</p>
  return (
    <svg
      className="diagnostic-qr"
      role="img"
      aria-label={label}
      viewBox={`-4 -4 ${code.count + 8} ${code.count + 8}`}
      shapeRendering="crispEdges"
    >
      <rect x="-4" y="-4" width={code.count + 8} height={code.count + 8} fill="white" />
      <path d={code.pixels} fill="black" />
    </svg>
  )
}
