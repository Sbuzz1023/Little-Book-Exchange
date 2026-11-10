import { parseListingForm, parseBundleBooks, type ParsedListingForm } from './parseListingForm'

export type ListingPhotos = { photo_url: string | null; photo_url_2: string | null; photo_url_3: string | null }
export type BundleBook = ReturnType<typeof parseBundleBooks>[number]
export type ListingPayload = ParsedListingForm & ListingPhotos & { is_bundle: boolean; bundle_name: string | null }

// The shape create_listing / update_listing (supabase/schema.sql, shared
// backend 2/6) expect. The database re-validates everything.
export function buildListingPayload(formData: FormData, photos: ListingPhotos): { listing: ListingPayload; books: BundleBook[] } {
  const isBundle = formData.get('is_bundle') === 'true'
  return {
    listing: {
      ...parseListingForm(formData),
      ...photos,
      is_bundle: isBundle,
      bundle_name: ((formData.get('bundle_name') as string) || '').trim() || null,
    },
    books: isBundle ? parseBundleBooks(formData) : [],
  }
}

const LISTING_ERRORS: Record<string, string> = {
  needs_match: 'Please search and select your book from the results — it can\'t be posted without a match.',
  invalid_listing: 'Please fill in the title, author and condition.',
  invalid_photo: 'One of your photos could not be saved. Please try adding it again.',
  pending_request: 'This listing has a pending purchase request and can\'t be edited right now.',
  sold: 'This book has already been sold and can\'t be edited.',
  not_allowed: 'You can\'t edit this listing.',
}

export function listingErrorMessage(code: string): string {
  return LISTING_ERRORS[code] ?? 'Something went wrong. Please try again.'
}
