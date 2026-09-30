type PhotoFields = {
  cover_url?: string | null
  photo_url?: string | null
  photo_url_2?: string | null
  photo_url_3?: string | null
}

// Photos for the listing detail gallery: the book cover always leads, followed
// by any seller-uploaded photos (skipping one that duplicates the cover).
export function listingPhotos(listing: PhotoFields): string[] {
  const all = [listing.cover_url, listing.photo_url, listing.photo_url_2, listing.photo_url_3]
  return Array.from(new Set(all.filter((url): url is string => !!url)))
}

// Small listing thumbnails (Dashboard rows, the home page's Recently added):
// always the stock cover, so each one reads as the book itself. Older listings from before Open Library
// matching have no cover — those fall back to the seller's first photo.
export function thumbnailUrl(listing: Pick<PhotoFields, 'cover_url' | 'photo_url'> | null | undefined): string | null {
  return listing?.cover_url || listing?.photo_url || null
}
