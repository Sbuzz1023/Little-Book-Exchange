# Little Book Exchange — Design Spec
**Date:** 2026-06-23

## Overview

A local peer-to-peer used book marketplace inspired by the Little Free Library movement. Neighbors list books to sell or give away; other neighbors browse, message, and arrange local pickup. No payment processing — money changes hands offline.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR for SEO on listing pages; clean routing |
| Backend / DB | Supabase | Auth, PostgreSQL, file storage, realtime messaging |
| Styling | Tailwind CSS | Utility-first; easy to implement the custom color palette |
| Hosting | Vercel | Free tier; zero-config Next.js deploys |

---

## Visual Design

**Theme:** Folk art / Little Free Library — playful, hand-crafted, community warmth.

**Color palette:**
- Orange `#f97316` — primary accent, buttons, borders
- Teal `#0d9488` — secondary actions, Free badge
- Yellow `#fbbf24` — decorative, warmth
- Cream `#fffbf0` — page background
- Charcoal `#2d2d2d` — body text

**Typography:**
- Headings: Pacifico (Google Fonts) — handwritten cursive
- Body/UI: Nunito (Google Fonts) — friendly rounded sans-serif

**Signature motifs:**
- Scalloped/wavy orange borders between page sections (SVG)
- Kid-drawing SVG wallpaper in the hero: stick figure family, houses, smiling sun, rainbow, flowers, butterfly, cat, bird, stars
- Book cards with gradient color covers and condition/price badges
- Rounded corners, drop shadows with offset (box-shadow: 0 5px 0 ...)

---

## Pages & Routes

### `/` — Homepage (public)
- Nav: logo, Browse, Post a Book, Sign In, Join Free
- Hero section with full kid-drawing SVG wallpaper background
- City search bar + category filter (All / For Sale / Free)
- Book listings grid (scoped to entered city, default to all if no city set)
- "How It Works" 4-step section
- CTA banner: "Join Your Community"
- Footer

### `/listings` — Browse (public)
- Full-page listings grid with city search and filters
- Filter chips: All, For Sale, Free, Just Listed
- Each card: book cover (photo or colored placeholder), title, author, condition badge, price/FREE tag, city

### `/listings/[id]` — Book Detail (public)
- Full listing: photo, title, author, condition, price or "Free", description, seller first name, city
- "Message Seller" button — prompts login if not authenticated

### `/post` — Post a Listing (auth required)
- Form fields: book title, author, condition (Good / Fair / Well-Loved), price (leave blank = Free), description (optional), photo upload
- City auto-filled from user profile
- On submit: creates listing in Supabase, redirects to listing detail page

### `/messages` — Inbox (auth required)
- Conversation list grouped by listing
- Each conversation shows listing title, other user's name, last message preview, timestamp
- Clicking opens the conversation thread
- Realtime updates via Supabase realtime subscription

### `/messages/[id]` — Conversation Thread (auth required)
- Message bubbles (sender right, receiver left)
- Text input + send button
- Listing summary card at top (title, price, photo)
- Realtime: new messages appear without refresh

### `/profile` — User Profile (auth required)
- Edit name, city
- "My Listings" tab: user's active listings with edit/delete/mark-as-gone actions
- Listing status options: Active, Sold, Given Away

### `/auth/signup` — Sign Up
- Email + password
- Name + city collected on signup
- Supabase Auth handles session

### `/auth/signin` — Sign In
- Email + password
- Redirect to previous page after login

---

## Data Model

### `profiles` table (extends Supabase `auth.users`)
```
id          uuid (FK → auth.users.id)
name        text
city        text
created_at  timestamptz
```

### `listings` table
```
id          uuid
user_id     uuid (FK → profiles.id)
title       text
author      text
condition   enum('good', 'fair', 'well-loved')
price       numeric (null = free)
description text (nullable)
photo_url   text (nullable)
city        text
status      enum('active', 'sold', 'given')
created_at  timestamptz
```

### `conversations` table
```
id          uuid
listing_id  uuid (FK → listings.id)
buyer_id    uuid (FK → profiles.id)
seller_id   uuid (FK → profiles.id)
created_at  timestamptz
```
One conversation per buyer per listing. Unique constraint on `(listing_id, buyer_id)`.

### `messages` table
```
id               uuid
conversation_id  uuid (FK → conversations.id)
sender_id        uuid (FK → profiles.id)
body             text
created_at       timestamptz
```

---

## Auth & Security

- Supabase Auth handles email/password sign-up and sign-in
- Row Level Security (RLS) policies:
  - `listings`: public read; insert/update/delete only by `user_id = auth.uid()`
  - `conversations`: readable only by `buyer_id = auth.uid()` OR `seller_id = auth.uid()`
  - `messages`: readable only if user is participant in the conversation
  - `profiles`: public read of name and city; update only by owner
- File storage bucket `book-photos`: public read, authenticated write

---

## Key User Flows

**Browse without account:**
Homepage → enter city → see listings → click listing → see detail → click "Message Seller" → redirected to sign in

**Post a book:**
Sign in → Post a Book → fill form → submit → listing live → visible in browse

**Respond to a listing:**
Browse → click listing → "Message Seller" → conversation created → inbox thread → arrange pickup

**Manage listings:**
Profile → My Listings → mark as Sold/Given Away or delete

---

## Out of Scope

- Payment processing (cash/Venmo handled offline)
- Shipping / delivery
- Book search by ISBN or barcode
- Reviews or ratings
- National / cross-city browsing
- Mobile app (web-responsive only)
