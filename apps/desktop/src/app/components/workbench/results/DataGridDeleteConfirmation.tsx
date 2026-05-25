import { DeleteConfirmationPanel } from './DeleteConfirmationPanel'

interface DataGridDeleteConfirmationProps {
  rowNumber: number
  onCancel(): void
  onConfirm(): void
}

export function DataGridDeleteConfirmation({
  rowNumber,
  onCancel,
  onConfirm,
}: DataGridDeleteConfirmationProps) {
  return (
    <DeleteConfirmationPanel
      title={`Delete row ${rowNumber}?`}
      body="DataPad++ will run this guarded delete with confirmation."
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
