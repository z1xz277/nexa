import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const base = (size: number, props: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props
})

export const IconFolder = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M1.5 4.5v8h13v-6h-6l-1.5-2h-5.5z" /></svg>
)
export const IconChip = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="4" y="4" width="8" height="8" /><path d="M6 1.5v2.5M10 1.5v2.5M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5" /></svg>
)
export const IconClip = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M12.5 7.5l-4.8 4.8a3 3 0 01-4.2-4.2l5.5-5.5a2 2 0 012.8 2.8l-5.4 5.4a1 1 0 01-1.4-1.4l4.6-4.6" /></svg>
)
export const IconArrowUp = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></svg>
)
export const IconSearch = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
)
export const IconPause = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M5.5 3v10M10.5 3v10" /></svg>
)
export const IconPlay = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4.5 3l8 5-8 5z" /></svg>
)
export const IconStop = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="3.5" y="3.5" width="9" height="9" /></svg>
)
export const IconX = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
)
export const IconMinus = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M3 8h10" /></svg>
)
export const IconSquare = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="3.5" y="3.5" width="9" height="9" /></svg>
)
export const IconWindowRestore = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="2.5" y="4.5" width="8" height="8" /><path d="M5.5 2.5h7a1 1 0 011 1v7h-2" /></svg>
)
export const IconAlert = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M8 1.5L14.5 13H1.5L8 1.5z" /><path d="M8 5.5v3.5M8 11.5v.1" /></svg>
)
export const IconInfo = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 4.5v.1" /></svg>
)
export const IconChevron = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 6l4 4 4-4" /></svg>
)
export const IconFile = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13" /></svg>
)
export const IconTerminal = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M2.5 4l4 4-4 4M8.5 12h5" /></svg>
)
export const IconCode = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M5.5 4L1.5 8l4 4M10.5 4l4 4-4 4" /></svg>
)
export const IconActivity = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M1.5 8h3l2-5 3 10 2-5h3" /></svg>
)
export const IconSettings = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>
)
export const IconPlus = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M8 3v10M3 8h10" /></svg>
)
export const IconRestore = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M2.5 8a5.5 5.5 0 105.5-5.5H4M2.5 2.5V6H6" /></svg>
)
export const IconCheck = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M2.5 8.5l3.5 3.5 7.5-8" /></svg>
)
export const IconEdit = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10zM9.5 4l2.5 2.5" /></svg>
)
export const IconRefresh = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 1.5V4.5h-3" /></svg>
)
export const IconSidebar = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="1.5" y="2.5" width="13" height="11" /><path d="M6 2.5v11" /></svg>
)
export const IconAsk = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 112.6 1.6c-.6.3-.9.7-.9 1.3M8 11.4v.1" /></svg>
)
export const IconAgent = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><path d="M8 1.5l5.5 3v5L8 14.5l-5.5-3v-5zM8 5.5v5M5.5 7l2.5 1.5L10.5 7" /></svg>
)
export const IconUnlocked = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)}><rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5.5 7V4.5a2.5 2.5 0 015 0V7M8 10v1.5" /></svg>
)