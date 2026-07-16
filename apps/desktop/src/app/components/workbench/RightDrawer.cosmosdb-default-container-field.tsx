import { FormField } from './RightDrawer.primitives'

export function CosmosDbDefaultContainerField({
  value,
  onChange,
}: {
  value: string
  onChange(value: string | undefined): void
}) {
  return (
    <FormField label="Default container">
      <input
        aria-label="Cosmos DB default container"
        value={value}
        placeholder="orders"
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </FormField>
  )
}
