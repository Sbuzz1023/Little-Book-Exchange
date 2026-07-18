-- Little Book Exchange — full schema
-- Paste this into Supabase SQL Editor and click Run

-- Profiles (auto-created on signup via trigger)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  username text unique,
  city text not null default '',
  state text not null default '',
  phone text not null default '',
  contact_preference text not null default 'email' check (contact_preference in ('email', 'phone')),
  address text not null default '',
  address_unit text not null default '',
  share_address boolean not null default true,
  pickup_description text not null default '',
  share_pickup boolean not null default true,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Public profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  -- Must be schema-qualified: this trigger fires inside GoTrue's own
  -- transaction (as supabase_auth_admin), whose search_path doesn't
  -- include public, so the bare table name fails to resolve.
  insert into public.profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'contact_preference', 'email'),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'address_unit', ''),
    coalesce((new.raw_user_meta_data->>'share_address')::boolean, true),
    coalesce(new.raw_user_meta_data->>'pickup_description', ''),
    coalesce((new.raw_user_meta_data->>'share_pickup')::boolean, true)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Listings
create table if not exists listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  author text not null,
  condition text not null check (condition in ('Good', 'Fair', 'Well-Loved', 'good', 'fair', 'well-loved')),
  price numeric(8,2) default null,
  description text,
  photo_url text,
  city text not null default '',
  genre text,
  format text,
  status text not null default 'active' check (status in ('active', 'sold', 'given')),
  pickup_description text,
  created_at timestamptz default now()
);

alter table listings enable row level security;
create policy "Listings are viewable by everyone" on listings for select using (true);
create policy "Users can insert own listings" on listings for insert with check (auth.uid() = user_id);
create policy "Users can update own listings" on listings for update using (auth.uid() = user_id);
create policy "Users can delete own listings" on listings for delete using (auth.uid() = user_id);

-- Conversations
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references listings(id) on delete cascade not null,
  buyer_id uuid references profiles(id) on delete cascade not null,
  seller_id uuid references profiles(id) on delete cascade not null,
  exchange_status text not null default 'none' check (exchange_status in ('none', 'requested', 'confirmed')),
  created_at timestamptz default now(),
  unique(listing_id, buyer_id)
);

-- Migration (run if table already exists):
-- ALTER TABLE conversations ADD COLUMN IF NOT EXISTS exchange_status text NOT NULL DEFAULT 'none' CHECK (exchange_status IN ('none', 'requested', 'confirmed'));

alter table conversations enable row level security;
create policy "Participants can view conversations" on conversations
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);
create policy "Buyers can create conversations" on conversations
  for insert with check (auth.uid() = buyer_id);

-- Messages
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id uuid references profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

alter table messages enable row level security;
create policy "Participants can view messages" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );
create policy "Participants can send messages" on messages
  for insert with check (
    auth.uid() = sender_id and
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- Enable realtime for messages
alter publication supabase_realtime add table messages;

-- Storage bucket for book photos
insert into storage.buckets (id, name, public)
values ('book-photos', 'book-photos', true)
on conflict (id) do nothing;

create policy "Anyone can view photos" on storage.objects
  for select using (bucket_id = 'book-photos');
create policy "Authenticated users can upload photos" on storage.objects
  for insert with check (bucket_id = 'book-photos' and auth.role() = 'authenticated');
create policy "Users can delete own photos" on storage.objects
  for delete using (bucket_id = 'book-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ── Migration: address privacy toggles ────────────────────────────────────────
-- Run this block in Supabase SQL Editor if the tables already exist:
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_address boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_pickup boolean NOT NULL DEFAULT true;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pickup_description text;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: multi-photo listings ───────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS photo_url_2 text,
  ADD COLUMN IF NOT EXISTS photo_url_3 text;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: saved listings ─────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
create table if not exists saved_listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  listing_id uuid references listings(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, listing_id)
);

alter table saved_listings enable row level security;

create policy "Users can view own saved listings" on saved_listings
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can save listings" on saved_listings
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can unsave own listings" on saved_listings
  for delete to authenticated using (auth.uid() = user_id);
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: TBR (to be read) list ──────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
create table if not exists tbr_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null default '',
  author text not null default '',
  city text not null default '',
  state text not null default '',
  created_at timestamptz default now(),
  constraint tbr_title_or_author check (title <> '' or author <> '')
);

alter table tbr_entries enable row level security;

create policy "Users can view own tbr entries" on tbr_entries
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can add tbr entries" on tbr_entries
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can delete own tbr entries" on tbr_entries
  for delete to authenticated using (auth.uid() = user_id);
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: library locations ──────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
create table if not exists library_locations (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references profiles(id) on delete cascade not null,
  name text not null,
  type text not null check (type in ('lfl', 'library', 'bookstore', 'fair')),
  lat double precision not null,
  lng double precision not null,
  street text not null default '',
  city text not null default '',
  description text not null default '',
  start_date date,
  end_date date,
  created_at timestamptz default now(),
  constraint fair_requires_dates check (
    type <> 'fair' or (start_date is not null and end_date is not null and end_date >= start_date)
  )
);

alter table library_locations enable row level security;

create policy "Locations are viewable by everyone" on library_locations
  for select using (true);

create policy "Authenticated users can add locations" on library_locations
  for insert to authenticated with check (auth.uid() = created_by);

create policy "Anyone can clean up expired fairs" on library_locations
  for delete using (type = 'fair' and end_date < current_date);
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: admin location editing + location reports ─────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Without this, any signed-in user could set their own is_admin to true, since
-- the existing "Users can update own profile" policy allows self-updates to
-- any column. This trigger keeps is_admin unchanged unless the actor making
-- the update is already an admin. auth.uid() is null for direct SQL editor
-- updates (no PostgREST session), so the very first admin grant still works
-- by running an update directly here.
create or replace function prevent_is_admin_self_grant()
returns trigger as $$
begin
  if new.is_admin = true and old.is_admin = false and auth.uid() is not null then
    if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
      new.is_admin := false;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists guard_is_admin_grant on profiles;
create trigger guard_is_admin_grant before update on profiles
  for each row execute procedure prevent_is_admin_self_grant();

create table if not exists location_reports (
  id uuid default gen_random_uuid() primary key,
  location_id uuid references library_locations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) on delete cascade not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution text check (resolution in ('edited', 'removed', 'dismissed')),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table location_reports enable row level security;

create policy "Authenticated users can file reports" on location_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

create policy "Admins can view all reports" on location_reports
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can resolve reports" on location_reports
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can update any location" on library_locations
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete any location" on library_locations
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: exchange completion, history, and seller ratings ──────────────

-- 1. Exchanges can now be marked complete
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_exchange_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_exchange_status_check
  CHECK (exchange_status IN ('none', 'requested', 'confirmed', 'completed'));

-- 2. Per-user history hide (the shared conversation row survives; each side can
-- hide their own copy independently without affecting the other party), and a
-- timestamp for when the exchange actually completed (History's "date" column
-- needs this — created_at is when the conversation started, not when it ended).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS buyer_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3. Conversations never had an UPDATE policy — confirmExchange, the new
-- completion action, and the hide action all need one.
create policy "Participants can update conversations" on conversations
  for update using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- Admins need to read conversations too (e.g. AdminClient's Reviews tab looks
-- up the listing/book title via conversations) — without this, an admin who
-- isn't a participant gets an empty result and every review shows "Unknown".
create policy "Admins can view all conversations" on conversations
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

-- 4. Auto-complete the listing when the exchange completes. A trigger (not an
-- RLS policy letting buyers UPDATE listings directly) because RLS can't be
-- scoped to a single column — a buyer-facing listings UPDATE policy would let
-- a buyer rewrite the seller's title/price/description too. security definer
-- mirrors the existing prevent_is_admin_self_grant trigger's approach.
create or replace function complete_exchange_marks_listing_sold()
returns trigger as $$
begin
  if new.exchange_status = 'completed' and old.exchange_status is distinct from 'completed' then
    update listings set status = 'sold' where id = new.listing_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists mark_listing_sold_on_completion on conversations;
create trigger mark_listing_sold_on_completion after update on conversations
  for each row execute procedure complete_exchange_marks_listing_sold();

-- 5. Seller ratings (one per completed exchange, buyer -> seller only)
create table if not exists reviews (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null unique,
  seller_id uuid references profiles(id) on delete cascade not null,
  reviewer_id uuid references profiles(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  text text,
  flagged boolean not null default false,
  created_at timestamptz default now()
);

alter table reviews enable row level security;

create policy "Reviews are viewable by everyone" on reviews for select using (true);

create policy "Buyers can review a completed exchange" on reviews
  for insert with check (
    auth.uid() = reviewer_id and
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and c.buyer_id = auth.uid()
      and c.seller_id = reviews.seller_id
      and c.exchange_status = 'completed'
    )
  );

create policy "Admins can moderate reviews" on reviews
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete reviews" on reviews
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: pending transaction lock ───────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given'));
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: RPCs for buyer-side listing lock/unlock ────────────────────────
-- Buyers aren't the listing owner, so the existing "Users can update own
-- listings" RLS policy (auth.uid() = user_id) blocks them from updating a
-- listing's status directly. A broad buyer-facing UPDATE policy isn't safe
-- either — RLS can't be scoped to a single column, so it would let a buyer
-- rewrite the seller's title/price/description too (same reasoning as the
-- complete_exchange_marks_listing_sold trigger above). These two
-- security-definer RPCs expose exactly one narrow, safe mutation each.
-- Accepted risk: any authenticated user can call this to lock an arbitrary
-- active listing to 'pending' without following through with a real
-- purchase request. requestPurchase's catch block calls reopen_listing to
-- release the lock on most downstream failures, but reopen_listing's own
-- authorization check (owner, or a buyer with a 'requested' conversation)
-- can't be satisfied if the conversation insert itself is what failed — in
-- that one sub-path the listing stays 'pending' with no conversation. The
-- seller's "Reset to Active" control (My Listings tab, DashboardClient.tsx)
-- is the manual recovery for that case and for a deliberately malicious
-- caller who never creates a conversation at all. Automatic expiry or
-- rate limiting is deferred.
create or replace function lock_listing_for_request(p_listing_id uuid)
returns boolean as $$
declare
  updated_id uuid;
begin
  update listings set status = 'pending'
  where id = p_listing_id and status = 'active'
  returning id into updated_id;
  return updated_id is not null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function reopen_listing(p_listing_id uuid)
returns boolean as $$
declare
  updated_id uuid;
begin
  update listings set status = 'active'
  where id = p_listing_id
    and status = 'pending'
    and (
      user_id = auth.uid()
      or exists (
        select 1 from conversations
        where listing_id = p_listing_id
          and buyer_id = auth.uid()
          and exchange_status = 'requested'
      )
    )
  returning id into updated_id;
  return updated_id is not null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function lock_listing_for_request(uuid) to authenticated;
grant execute on function reopen_listing(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: seller can deny a purchase request ─────────────────────────────
-- conversations only ever had a DELETE policy for the buyer ("buyer can cancel
-- conversations" in rls-policies.sql — this file's inline policies never had
-- a DELETE policy at all). denyPurchase (app/profile/actions.ts) needs the
-- seller to be able to delete the conversation row too, or the delete silently
-- matches 0 rows and the request never actually clears from the seller's
-- Exchanges tab, even though the listing itself still correctly reopens.
-- Run this block in Supabase SQL Editor:
create policy "Sellers can deny conversations" on conversations
  for delete using (auth.uid() = seller_id);
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: in-app notifications (Phase 1) ─────────────────────────────────
-- Run this block in Supabase SQL Editor:

-- 1. notifications table. No INSERT policy for `authenticated` — every row is
-- written either by a security-definer trigger function below (which runs as
-- the function owner and bypasses RLS, same pattern as
-- complete_exchange_marks_listing_sold) or by create_notification() (also
-- security definer). A regular client can never forge a notification into
-- someone else's feed.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  type text not null check (type in ('message', 'purchase_request', 'purchase_decision', 'tbr_match', 'pickup')),
  entity_id uuid not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "Users can view their own notifications" on notifications
  for select using (auth.uid() = user_id);

create policy "Users can mark their own notifications read" on notifications
  for update using (auth.uid() = user_id);

create index if not exists notifications_user_unread_idx on notifications (user_id, read);
create index if not exists notifications_entity_type_idx on notifications (entity_id, type);

-- 2. messages gains a `kind` column so one trigger can classify 4 of the 5
-- notification types without string-sniffing message bodies. Ordinary chat
-- sends (MessagesTab.tsx) are untouched — they default to 'chat'.
alter table messages add column if not exists kind text not null default 'chat'
  check (kind in ('chat', 'purchase_request', 'confirmation', 'pickup'));

-- 3. profiles gains 5 notification preference toggles, matching the existing
-- flat-boolean style already used for share_address / share_pickup.
alter table profiles
  add column if not exists notify_message boolean not null default true,
  add column if not exists notify_purchase_request boolean not null default true,
  add column if not exists notify_purchase_decision boolean not null default true,
  add column if not exists notify_tbr_match boolean not null default true,
  add column if not exists notify_pickup boolean not null default true;

-- 4. Regex-escape helper mirroring lib/tbrMatch.ts's escapeRegex(), used by
-- the listings trigger below. Character-by-character substitution avoids the
-- ambiguity of hand-building a POSIX/ARE bracket expression for the special-
-- character class.
create or replace function tbr_escape_regex(v text) returns text as $$
declare
  result text := '';
  c text;
  specials text := '.^$*+?()[]{}|\';
begin
  for i in 1..length(v) loop
    c := substr(v, i, 1);
    if position(c in specials) > 0 then
      result := result || '\' || c;
    else
      result := result || c;
    end if;
  end loop;
  return result;
end;
$$ language plpgsql immutable;

-- 5. messages trigger — covers `message`, `purchase_request`,
-- `purchase_decision` (confirmed), and `pickup`. requestPurchase,
-- confirmExchange, and completeExchange (Tasks 3-4) each insert a message
-- with a specific `kind`; this is the only place that turns those inserts
-- into notifications, so nothing in application code calls
-- create_notification() for these four cases.
create or replace function notify_on_message()
returns trigger as $$
declare
  v_conv conversations%rowtype;
  v_recipient uuid;
  v_type text;
  v_pref boolean;
  v_title text;
begin
  select * into v_conv from conversations where id = new.conversation_id;
  if not found then
    return new;
  end if;

  v_recipient := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;

  v_type := case new.kind
    when 'purchase_request' then 'purchase_request'
    when 'confirmation'     then 'purchase_decision'
    when 'pickup'            then 'pickup'
    else 'message'
  end;

  select case v_type
    when 'purchase_request'  then notify_purchase_request
    when 'purchase_decision' then notify_purchase_decision
    when 'pickup'             then notify_pickup
    else notify_message
  end into v_pref
  from profiles where id = v_recipient;

  if v_pref is distinct from true then
    return new;
  end if;

  v_title := case v_type
    when 'purchase_request'  then 'New purchase request'
    when 'purchase_decision' then 'Purchase request update'
    when 'pickup'             then 'Book picked up'
    else 'New message'
  end;

  insert into notifications (user_id, type, entity_id, title, body)
  values (v_recipient, v_type, new.conversation_id, v_title, left(new.body, 200));

  return new;
exception when others then
  raise warning 'notify_on_message failed: %', sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists notify_on_message_trigger on messages;
create trigger notify_on_message_trigger after insert on messages
  for each row execute procedure notify_on_message();

-- 6. listings trigger — covers `tbr_match`, including "notify me if it
-- reopens" (fires on ANY transition to 'active', not just creation, so it
-- covers denyPurchase's direct status update and cancelPurchase's
-- reopen_listing() RPC the same way, regardless of which path changed the
-- row). Mirrors the word-boundary rule in lib/tbrMatch.ts's
-- tbrMatchPattern() — any change to one must be mirrored in the other.
create or replace function notify_tbr_matches()
returns trigger as $$
declare
  v_entry record;
  v_seller_state text;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select state into v_seller_state from profiles where id = new.user_id;

  for v_entry in
    select t.id, t.user_id
    from tbr_entries t
    join profiles p on p.id = t.user_id
    where t.user_id <> new.user_id
      and p.notify_tbr_match = true
      and (t.title = '' or new.title ~* ('(^|\W)' || tbr_escape_regex(t.title) || '(\W|$)'))
      and (t.author = '' or new.author ~* ('(^|\W)' || tbr_escape_regex(t.author) || '(\W|$)'))
      and (t.city = '' or new.city ~* ('(^|\W)' || tbr_escape_regex(t.city) || '(\W|$)'))
      and (t.state = '' or t.state = v_seller_state)
  loop
    insert into notifications (user_id, type, entity_id, title, body)
    values (v_entry.user_id, 'tbr_match', v_entry.id, 'A book on your TBR is available', new.title || ' by ' || new.author);
  end loop;

  return new;
exception when others then
  raise warning 'notify_tbr_matches failed: %', sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists notify_tbr_matches_trigger on listings;
create trigger notify_tbr_matches_trigger after insert or update on listings
  for each row execute procedure notify_tbr_matches();

-- 7. create_notification RPC — the one event with no message insert to hook:
-- denyPurchase (Task 4) deletes the conversation outright rather than
-- posting to it.
drop function if exists create_notification(uuid, text, uuid, text, text);
create or replace function create_notification(
  p_user_id uuid, p_type text, p_entity_id uuid
) returns void as $$
declare
  v_title text;
  v_body text;
begin
  if not exists (
    select 1 from conversations
    where id = p_entity_id
      and auth.uid() in (buyer_id, seller_id)
      and p_user_id in (buyer_id, seller_id)
      and p_user_id <> auth.uid()
  ) then
    return;
  end if;

  v_title := case p_type
    when 'purchase_decision' then 'Purchase request declined'
    else 'Notification'
  end;
  v_body := case p_type
    when 'purchase_decision' then 'The seller declined your purchase request.'
    else ''
  end;

  insert into notifications (user_id, type, entity_id, title, body)
  select p_user_id, p_type, p_entity_id, v_title, v_body
  from profiles
  where id = p_user_id
  and (case p_type
    when 'purchase_request'  then notify_purchase_request
    when 'purchase_decision' then notify_purchase_decision
    when 'pickup'             then notify_pickup
    when 'tbr_match'          then notify_tbr_match
    else notify_message
  end);
exception when others then
  raise warning 'create_notification failed: %', sqlerrm;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function create_notification(uuid, text, uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
