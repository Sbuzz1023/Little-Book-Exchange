const DESCRIPTION_MAX_LENGTH = 500

export type ParsedListingForm = {
  title: string
  author: string
  condition: string
  price: number | null
  description: string | null
  genre: string | null
  format: string | null
  pickup_description: string | null
}

export function parseListingForm(formData: FormData): ParsedListingForm {
  const priceRaw = formData.get('price') as string
  const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null
  return {
    title:       formData.get('title')       as string,
    author:      formData.get('author')      as string,
    condition:   formData.get('condition')   as string,
    price,
    description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
    genre:       (formData.get('genre')       as string) || null,
    format:      (formData.get('format')      as string) || null,
    pickup_description: (formData.get('pickup_description') as string) || null,
  }
}
