// Past this release speed (px/ms) a drag counts as a flick: the sheet moves
// one snap point in the flick's direction instead of to the nearest point.
const FLICK_VELOCITY = 0.5

// Where a bottom sheet should settle after a drag. `height` is the sheet's
// visible height at release, `velocity` is px/ms (positive = moving up), and
// `snaps` are the allowed visible heights, ascending.
export function resolveSnap(height: number, velocity: number, snaps: number[]): number {
  if (velocity > FLICK_VELOCITY) {
    return snaps.find(s => s > height) ?? snaps[snaps.length - 1]
  }
  if (velocity < -FLICK_VELOCITY) {
    return [...snaps].reverse().find(s => s < height) ?? snaps[0]
  }
  return snaps.reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best))
}
