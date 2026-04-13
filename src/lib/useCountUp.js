import { useEffect, useRef, useState } from 'react'

/*
  Smooth count-up animation for numeric display.
  Animates from the previous value to the new value using easeOutCubic.
*/
export function useCountUp(target, duration = 600) {
  const numericTarget = Number(target) || 0
  const [value, setValue] = useState(numericTarget)
  const prevTarget = useRef(numericTarget)

  useEffect(() => {
    if (prevTarget.current === numericTarget) return
    const start = prevTarget.current
    const diff = numericTarget - start
    const startTime = performance.now()
    let frame

    const step = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      const next = start + diff * eased
      setValue(Math.round(next * 100) / 100)
      if (progress < 1) {
        frame = requestAnimationFrame(step)
      } else {
        prevTarget.current = numericTarget
        setValue(numericTarget)
      }
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [numericTarget, duration])

  return value
}
