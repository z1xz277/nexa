import { createElement, type ComponentType, type CSSProperties } from 'react'
import OpenAI from '@lobehub/icons/es/OpenAI'
import Meta from '@lobehub/icons/es/Meta'
import Google from '@lobehub/icons/es/Google'
import Gemma from '@lobehub/icons/es/Gemma'
import Gemini from '@lobehub/icons/es/Gemini'
import DeepSeek from '@lobehub/icons/es/DeepSeek'
import Qwen from '@lobehub/icons/es/Qwen'
import Mistral from '@lobehub/icons/es/Mistral'
import Nvidia from '@lobehub/icons/es/Nvidia'
import Microsoft from '@lobehub/icons/es/Microsoft'
import Moonshot from '@lobehub/icons/es/Moonshot'
import Zhipu from '@lobehub/icons/es/Zhipu'
import ZAI from '@lobehub/icons/es/ZAI'
import type { ProviderId } from '@shared/types'

export type LogoComponent = ComponentType<{ size?: number | string; style?: CSSProperties; className?: string }>

export interface ModelLogo {
  Icon: LogoComponent
  label: string
}

const GenericGlyph: LogoComponent = ({ size = 16, style, className }) =>
  createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style, className, 'aria-hidden': true },
    createElement('path', { d: 'M3 13V3l10 10V3', stroke: 'currentColor', strokeWidth: 1.4 })
  )

const GENERIC: ModelLogo = { Icon: GenericGlyph, label: 'Model' }

const MATCHERS: { test: RegExp; logo: ModelLogo }[] = [
  { test: /gemma/, logo: { Icon: Gemma as LogoComponent, label: 'Gemma' } },
  { test: /gemini/, logo: { Icon: Gemini as LogoComponent, label: 'Gemini' } },
  { test: /google/, logo: { Icon: Google as LogoComponent, label: 'Google' } },
  { test: /meta-llama|llama/, logo: { Icon: Meta as LogoComponent, label: 'Meta' } },
  { test: /deepseek/, logo: { Icon: DeepSeek as LogoComponent, label: 'DeepSeek' } },
  { test: /qwen|qwq/, logo: { Icon: Qwen as LogoComponent, label: 'Qwen' } },
  { test: /mistral|mixtral|devstral|codestral|ministral/, logo: { Icon: Mistral as LogoComponent, label: 'Mistral' } },
  { test: /nvidia|nemotron/, logo: { Icon: Nvidia as LogoComponent, label: 'NVIDIA' } },
  { test: /microsoft|phi-/, logo: { Icon: Microsoft as LogoComponent, label: 'Microsoft' } },
  { test: /openai|gpt-|chatgpt|\/o[134]/, logo: { Icon: OpenAI as LogoComponent, label: 'OpenAI' } },
  { test: /moonshot|kimi/, logo: { Icon: Moonshot as LogoComponent, label: 'Moonshot' } },
  { test: /z-ai/, logo: { Icon: ZAI as LogoComponent, label: 'Z.ai' } },
  { test: /glm|zhipu/, logo: { Icon: Zhipu as LogoComponent, label: 'Zhipu' } }
]

export function getModelLogo(modelId: string, provider?: ProviderId): ModelLogo {
  const id = modelId.toLowerCase()
  for (const matcher of MATCHERS) if (matcher.test.test(id)) return matcher.logo
  if (provider === 'nvidia') return MATCHERS.find((matcher) => matcher.logo.label === 'NVIDIA')!.logo
  return GENERIC
}
