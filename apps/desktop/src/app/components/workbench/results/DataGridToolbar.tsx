interface DataGridToolbarProps {
  filter: string
  onFilterChange(value: string): void
}

export function DataGridToolbar({
  filter,
  onFilterChange,
}: DataGridToolbarProps) {
  return (
    <div className="data-grid-toolbar">
      <label className="data-grid-filter">
        <input
          type="search"
          aria-label="Find in results"
          value={filter}
          placeholder="Find in results"
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </label>
    </div>
  )
}
