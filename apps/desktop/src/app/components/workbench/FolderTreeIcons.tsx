import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

export function TreeFolderIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 18 18" {...props}>
      <path
        d="M1.9 5.1c0-.9.7-1.6 1.6-1.6h3.3c.5 0 .9.2 1.2.6l.8 1h5.7c.9 0 1.6.7 1.6 1.6v.9H1.9V5.1Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M1.8 7.1c.1-.8.8-1.4 1.6-1.4h11.2c.9 0 1.6.7 1.6 1.6v5.1c0 .9-.7 1.6-1.6 1.6H3.4c-.9 0-1.6-.7-1.6-1.6V7.1Z"
        fill="currentColor"
        opacity="0.92"
      />
      <path
        d="M3 7.9h12"
        opacity="0.42"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.1"
      />
    </svg>
  )
}

export function TreeFolderOpenIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 18 18" {...props}>
      <path
        d="M1.9 5.2c0-.9.7-1.6 1.6-1.6h3.2c.5 0 .9.2 1.2.6l.9 1.1h5.3c.9 0 1.6.7 1.6 1.6v1.3H1.9v-3Z"
        fill="currentColor"
        opacity="0.46"
      />
      <path
        d="M2.9 7.1h12.6c.9 0 1.5.8 1.3 1.6l-1.2 4.4c-.2.7-.8 1.2-1.6 1.2H3.6c-.8 0-1.4-.5-1.6-1.2L.8 8.7c-.2-.8.4-1.6 1.3-1.6h.8Z"
        fill="currentColor"
        opacity="0.94"
      />
      <path
        d="M3.1 8.4h10.7"
        opacity="0.44"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.1"
      />
    </svg>
  )
}

export function TreePrefixIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 18 18" {...props}>
      <path
        d="M1.9 5.1c0-.9.7-1.6 1.6-1.6h3.1c.5 0 .9.2 1.2.6l.8 1h5.7c.9 0 1.6.7 1.6 1.6v.9H1.9V5.1Z"
        fill="currentColor"
        opacity="0.42"
      />
      <path
        d="M1.8 7.1c.1-.8.8-1.4 1.6-1.4h11.2c.9 0 1.6.7 1.6 1.6v5.1c0 .9-.7 1.6-1.6 1.6H3.4c-.9 0-1.6-.7-1.6-1.6V7.1Z"
        fill="currentColor"
        opacity="0.84"
      />
      <path
        d="M5.2 10.8h7.6M5.2 8.8h7.6"
        opacity="0.95"
        stroke="var(--surface)"
        strokeLinecap="round"
        strokeWidth="1.05"
      />
    </svg>
  )
}
