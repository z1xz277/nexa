import { getModelLogo } from '@core/logos'
import type { ProviderId } from '@shared/types'

export function Wordmark() {
  return (
    <span className="inline-flex items-baseline gap-2 select-none">
      <svg width="15" height="15" viewBox="0 0 1024 1024" fill="none" aria-hidden className="self-center">
        <path d="M236 768C236 506 414 326 768 236C768 566 626 768 236 768ZM326 674L354 702L702 354L674 326Z" fill="currentColor" fillRule="evenodd" />
      </svg>
      <span className="text-[14px] font-semibold tracking-[-0.02em]">Nexa</span>
    </span>
  )
}

export function ModelLogo({
  modelId,
  provider,
  selected = false,
  size = 16
}: {
  modelId: string
  provider?: ProviderId
  selected?: boolean
  size?: number
}) {
  const { Icon } = getModelLogo(modelId, provider)
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{ color: 'currentColor', width: size, height: size, pointerEvents: 'none' }}
    >
      <Icon size={size} />
    </span>
  )
}