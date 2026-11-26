import type { ModelInfo, ProviderId } from '@shared/types'

export function chooseModel(
  models: ModelInfo[],
  current: { id: string; provider: ProviderId } | null,
  preferredId: string | null | undefined
): { id: string; provider: ProviderId } | null {
  if (current && models.some((model) => model.id === current.id && model.provider === current.provider)) return current
  const selected = models.find((model) => model.id === preferredId) ?? models[0]
  return selected ? { id: selected.id, provider: selected.provider } : null
}
