import type { Transition } from 'framer-motion'

export const SPRING: Transition = { type: 'spring', stiffness: 280, damping: 30, mass: 0.9 }
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 220, damping: 28, mass: 1 }

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 }
}

export const stagger = (i: number, base = 0.05) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { ...SPRING, delay: base + i * 0.055 }
})