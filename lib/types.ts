export type Profile = {
  id: string
  name: string
  username?: string
  city: string
  created_at: string
}

export type ListingCondition = 'good' | 'fair' | 'well-loved'
export type ListingStatus = 'active' | 'pending' | 'sold' | 'given' | 'paused'

export type Listing = {
  id: string
  user_id: string
  title: string
  author: string
  condition: ListingCondition
  price: number | null
  description: string | null
  photo_url: string | null
  city: string
  status: ListingStatus
  genre?: string
  format?: string
  created_at: string
  profiles?: Profile
  is_bundle?: boolean
  bundle_name?: string | null
  book_count?: number
}

export type Conversation = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  created_at: string
  listings?: Listing
  buyer?: Profile
  seller?: Profile
  messages?: Message[]
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  profiles?: Profile
}
