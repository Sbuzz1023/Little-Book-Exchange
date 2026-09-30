// Listing photos are shrunk in the browser before upload: phone photos are
// 2–5 MB, well past the server action body limit, and far bigger than any
// page ever shows them.
export const MAX_PHOTO_SIDE = 1600
const JPEG_QUALITY = 0.8

export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function resizedName(name: string) {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name}`)) }
    img.src = url
  })
}

// Scales the photo so its long side is at most MAX_PHOTO_SIDE and re-encodes it
// as JPEG. <img> applies the EXIF rotation, so the canvas copy comes out upright.
// Rejects if the browser can't decode the file — callers keep the original then.
export async function resizeImage(file: File): Promise<File> {
  const img = await loadImage(file)
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_PHOTO_SIDE)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')
  // JPEG has no transparency; paint white behind PNGs so it doesn't turn black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Could not encode photo')
  // Never hand back something bigger than what was picked.
  if (blob.size >= file.size && file.type === 'image/jpeg' && width === img.naturalWidth) return file
  return new File([blob], resizedName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
}
