import type { ButtonHTMLAttributes, ComponentType, SVGProps } from 'react'
import {
  JsonIcon,
  MoveDownIcon,
  MoveUpIcon,
  TrashIcon,
} from '../icons'

export type QueryBuilderIconAction = 'json' | 'move-down' | 'move-up' | 'remove'

interface QueryBuilderIconButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'aria-label' | 'children' | 'title' | 'type'
  > {
  action: QueryBuilderIconAction
  label: string
}

const ACTION_ICONS: Record<
  QueryBuilderIconAction,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  json: JsonIcon,
  'move-down': MoveDownIcon,
  'move-up': MoveUpIcon,
  remove: TrashIcon,
}

export function QueryBuilderIconButton({
  action,
  className,
  label,
  ...buttonProps
}: QueryBuilderIconButtonProps) {
  const Icon = ACTION_ICONS[action]

  return (
    <button
      {...buttonProps}
      type="button"
      className={`query-builder-icon-button query-builder-icon-button--${action}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
    >
      <Icon className="query-builder-icon-button__icon" />
    </button>
  )
}
