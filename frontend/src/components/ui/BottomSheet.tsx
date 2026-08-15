import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Mobile-first sheet: slides up from the bottom on phones, centers as a
 * dialog on desktop. Backdrop closes on click; Esc handled by <dialog>.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('click', onClick)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('click', onClick)
    }
  }, [onClose])

  if (!open) return null

  return createPortal(
    <dialog ref={ref} className="m-0 h-full max-h-full w-full bg-transparent sm:m-auto sm:h-auto sm:max-w-md">
      <div className="sheet-panel sheet-desktop flex h-full flex-col overflow-hidden rounded-t-[20px] bg-surface shadow-docked sm:h-auto sm:max-h-[85vh] sm:rounded-[20px]">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-semibold text-ink-950">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 transition-colors hover:bg-canvas active:bg-brand-50"
          >
            <X size={22} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2 sm:pb-6">{children}</div>
      </div>
    </dialog>,
    document.body,
  )
}
