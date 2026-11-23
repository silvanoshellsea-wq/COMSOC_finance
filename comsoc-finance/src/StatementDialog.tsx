import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

export default function StatementDialog({ title, close, children }: {
  title: string; close: () => void; children: (dismiss: () => void) => ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])
  function dismiss() {
    ref.current?.close()
    close()
  }
  return <dialog ref={ref} className="demo-entry-dialog" aria-labelledby={titleId} onCancel={(event) => {
    event.preventDefault()
    dismiss()
  }}>
    <div className="demo-entry-heading mb-4">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="demo-icon" aria-label="Close form" onClick={dismiss}>×</button>
    </div>
    {children(dismiss)}
  </dialog>
}
