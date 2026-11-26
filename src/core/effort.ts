import type { Effort } from '@shared/types'

// Effort maps to real agent behavior, not just a label:
// reasoning: OpenRouter reasoning.effort hint (ignored by non-reasoning models).
// reasoningBudget: token budget requested where the provider supports it.
// planSteps: max steps the model is asked to put in update_plan (0 skips planning).
// reviewPasses: extra self-review turns after edits before the run completes.
// maxToolIterations: hard cap on tool-call rounds per run.
// maxTokens: completion cap sent to the provider.
export interface EffortPolicy {
  reasoning: 'low' | 'medium' | 'high' | null
  reasoningBudget: number
  planSteps: number
  reviewPasses: number
  maxToolIterations: number
  maxTokens: number
}

export const EFFORT_POLICIES: Record<Effort, EffortPolicy> = {
  low:    { reasoning: null,     reasoningBudget: 0,     planSteps: 0,  reviewPasses: 0, maxToolIterations: 4,  maxTokens: 2048 },
  medium: { reasoning: 'low',    reasoningBudget: 2048,  planSteps: 4,  reviewPasses: 1, maxToolIterations: 8,  maxTokens: 4096 },
  high:   { reasoning: 'medium', reasoningBudget: 8192,  planSteps: 8,  reviewPasses: 2, maxToolIterations: 16, maxTokens: 8192 },
  max:    { reasoning: 'high',   reasoningBudget: 16384, planSteps: 12, reviewPasses: 3, maxToolIterations: 24, maxTokens: 16384 }
}

export const EFFORT_META: Record<Effort, { label: string; bars: number; description: string }> = {
  low:    { label: 'Low',    bars: 1, description: 'Direct answers, no planning, 4 tool rounds.' },
  medium: { label: 'Medium', bars: 2, description: 'Short plan, one self-review, 8 tool rounds.' },
  high:   { label: 'High',   bars: 3, description: 'Full plan, two reviews, deeper reasoning budget.' },
  max:    { label: 'Max',    bars: 4, description: 'Largest budget, three reviews, 24 tool rounds.' }
}

export const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'max']