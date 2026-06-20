import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export function GlassPanel({ children, className = '' }: Props) {
  return <div className={`glass ${className}`.trim()}>{children}</div>
}
