import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const names = [
  'manifest.json',
  'policy.js',
  'fs-parameters.js',
  'legacy-fs1.js',
  'worker.js',
  'content.js',
  'approve.html',
  'approve.js',
  'status.html',
  'style.css',
  'README.md',
  'PRIVACY.md',
]
const out = resolve('.artifacts/signalshade-connect')
await mkdir(out, { recursive: true })
// Dependency-free ZIP writer (stored entries, CRC32). All paths are a fixed allowlist.
const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
const local = [],
  central = []
let offset = 0
for (const name of names) {
  const bytes = await readFile(`extension/${name}`),
    filename = Buffer.from(name)
  await copyFile(`extension/${name}`, resolve(out, name))
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(33, 12)
  header.writeUInt32LE(crc32(bytes), 14)
  header.writeUInt32LE(bytes.length, 18)
  header.writeUInt32LE(bytes.length, 22)
  header.writeUInt16LE(filename.length, 26)
  local.push(header, filename, bytes)
  const entry = Buffer.alloc(46)
  entry.writeUInt32LE(0x02014b50)
  entry.writeUInt16LE(20, 4)
  entry.writeUInt16LE(20, 6)
  entry.writeUInt16LE(33, 14)
  entry.writeUInt32LE(crc32(bytes), 16)
  entry.writeUInt32LE(bytes.length, 20)
  entry.writeUInt32LE(bytes.length, 24)
  entry.writeUInt16LE(filename.length, 28)
  entry.writeUInt32LE(offset, 42)
  central.push(entry, filename)
  offset += header.length + filename.length + bytes.length
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50)
end.writeUInt16LE(names.length, 8)
end.writeUInt16LE(names.length, 10)
end.writeUInt32LE(directory.length, 12)
end.writeUInt32LE(offset, 16)
const zip = Buffer.concat([...local, directory, end])
await writeFile('.artifacts/signalshade-connect.zip', zip)
await writeFile(
  '.artifacts/signalshade-connect.sha256',
  `${createHash('sha256').update(zip).digest('hex')}  signalshade-connect.zip\n`,
)
console.log(`Built SignalShade Connect (${zip.length} bytes) at .artifacts/signalshade-connect.zip`)
