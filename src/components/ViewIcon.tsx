import { Grid2X2 } from 'lucide-react'

const iconsByWord = new Map([
  ['soccer', '⚽'],
  ['futsal', '⚽'],
  ['football', '🏈'],
  ['basketball', '🏀'],
  ['baseball', '⚾'],
  ['softball', '🥎'],
  ['volleyball', '🏐'],
  ['hockey', '🏒'],
  ['lacrosse', '🥍'],
  ['tennis', '🎾'],
  ['golf', '⛳'],
  ['swimming', '🏊'],
  ['wrestling', '🤼'],
  ['racing', '🏁'],
  ['concert', '🎵'],
  ['music', '🎵'],
  ['esports', '🎮'],
  ['interview', '🎙️'],
])

export function ViewIcon({ title }: { title: string }) {
  const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const icon = words.map((word) => iconsByWord.get(word)).find(Boolean)
  return icon ? (
    <span className="view-icon" aria-hidden="true">
      {icon}
    </span>
  ) : (
    <Grid2X2 size={17} aria-hidden="true" />
  )
}
