import { useState } from 'react'
import { desk } from '../core/store'
import type { DeskView, Workspace } from '../core/types'
import { message } from '../adapters/aja'
import { Modal } from './Modal'

export function ViewDialog({
  workspace,
  view,
  close,
  saved,
}: {
  workspace: Workspace
  view?: DeskView
  close: () => void
  saved: (id: string) => void
}) {
  const [name, setName] = useState(view?.name ?? '')
  const [cards, setCards] = useState(view?.cards ?? [])
  const [error, setError] = useState('')
  const available = [
    ...workspace.channels.map((channel) => ({ id: channel.id, label: channel.label, gang: false })),
    ...workspace.gangs.map((gang) => ({ id: gang.id, label: gang.name, gang: true })),
  ]
  return (
    <Modal title={view ? 'Edit view' : 'Create view'} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          try {
            const id = view?.id ?? crypto.randomUUID()
            desk.saveView({ id, name, cards })
            saved(id)
          } catch (error) {
            setError(message(error))
          }
        }}
      >
        <label className="field">
          View name
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="member-list" role="group" aria-label="Cards in view">
          {available.map(({ id, label, gang }) => (
            <label className="check-row" key={id}>
              <input
                type="checkbox"
                checked={cards.includes(id)}
                onChange={(event) =>
                  setCards(
                    event.target.checked ? [...cards, id] : cards.filter((card) => card !== id),
                  )
                }
              />
              {label}
              {gang && ' · Gang card'}
            </label>
          ))}
          {!available.length && <p className="muted">Add a device or gang first.</p>}
        </div>
        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {view && (
            <button
              type="button"
              className="button"
              onClick={() => {
                desk.deleteView(view.id)
                close()
              }}
            >
              Delete view
            </button>
          )}
          <button className="button primary" disabled={!name.trim() || !cards.length}>
            Save view
          </button>
        </div>
      </form>
    </Modal>
  )
}
