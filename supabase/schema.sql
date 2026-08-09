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
  -- NOTE: the credit-ledger migration at the bottom of this file replaces this
  -- function to also seed email_verified/phone_verified. Same convention as
  -- complete_exchange_marks_listing_sold — the later create-or-replace wins on
  -- a full-file run, and existing deployments get it by running that block.
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
-- denyPurchase marks the conversation 'declined' outright rather than
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

-- ── Migration: declined purchase requests survive as History entries ─────────
-- Run this block in Supabase SQL Editor:

-- denyPurchase now marks a conversation 'declined' instead of deleting it, so
-- the buyer's purchase_decision notification (create_notification, above) has
-- a permanent row to point at — Phase 1 has no notification feed UI, so a
-- notification is only ever visible via a highlighted row; deleting the
-- conversation left decline notifications with nothing to highlight.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_exchange_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_exchange_status_check
  CHECK (exchange_status IN ('none', 'requested', 'confirmed', 'completed', 'declined'));
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: drop the now-obsolete seller-delete policy on conversations ────
-- Run this block in Supabase SQL Editor:

-- "Sellers can deny conversations" (added in the "seller can deny a purchase
-- request" migration above) let a seller DELETE a conversation row, back when
-- denyPurchase deleted on decline. denyPurchase now UPDATEs to 'declined'
-- instead (see the "declined purchase requests survive as History entries"
-- migration above) — the whole point of that change was to keep the row
-- around so the buyer's decline notification has something to point at.
-- Leaving this policy in place would let a seller undo that via a raw
-- DELETE call. Nothing in the app calls it anymore.
DROP POLICY IF EXISTS "Sellers can deny conversations" ON conversations;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: paused listings ────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given', 'paused'));
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: credit ledger foundation ───────────────────────────────────────

-- 1. Real balance + verification/bonus tracking on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_bonus_claimed boolean NOT NULL DEFAULT false;

-- 2. book_count defaults to 1 (today's single-book behavior). The separate
-- bundle-listings feature populates it for multi-book listings later.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS book_count integer NOT NULL DEFAULT 1;

-- 3. Transaction ledger
create table if not exists credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  amount integer not null, -- positive = credited, negative = spent
  reason text not null check (reason in ('purchase_spent', 'sale_earned', 'onboarding_bonus', 'admin_adjustment')),
  listing_id uuid references listings(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  created_at timestamptz default now()
);

alter table credit_transactions enable row level security;
create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policy for `authenticated` — every row is written by
-- security-definer trigger functions or the admin action, same pattern
-- notifications already uses.

-- 4. Sync Supabase Auth's own verification state onto profiles.
-- Every function in this block pins `set search_path = public, pg_temp`:
-- SECURITY DEFINER does NOT reset search_path, and this chain is reached from
-- GoTrue's own transaction on auth.users, which runs as supabase_auth_admin —
-- a role whose search_path does not include public, so unqualified table names
-- would fail to resolve and abort GoTrue's transaction (i.e. the user's email
-- or phone confirmation would fail outright). Same reason lock_listing_for_request
-- pins it, and the same failure mode handle_new_user's comment documents.
create or replace function sync_verification_status()
returns trigger as $$
begin
  update public.profiles
  set email_verified = (new.email_confirmed_at is not null),
      phone_verified  = (new.phone_confirmed_at is not null)
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_auth_user_verification_change on auth.users;
create trigger on_auth_user_verification_change
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row execute procedure sync_verification_status();

-- 5. Award the onboarding bonus the moment all three conditions are met.
create or replace function maybe_award_onboarding_bonus(p_user_id uuid)
returns void as $$
declare
  v_profile profiles%rowtype;
  v_books integer;
begin
  select * into v_profile from profiles where id = p_user_id;
  if v_profile.onboarding_bonus_claimed then return; end if;
  if not (v_profile.email_verified and v_profile.phone_verified) then return; end if;

  select coalesce(sum(book_count), 0) into v_books from listings where user_id = p_user_id;
  if v_books < 3 then return; end if;

  -- `and onboarding_bonus_claimed = false` makes the award atomic: the check
  -- above and this update are separate statements, so two concurrent trigger
  -- chains could both pass the check. The row lock this UPDATE takes means the
  -- loser re-evaluates the predicate against the winner's committed row and
  -- matches zero rows — so the second insert below is skipped too.
  update profiles set credits = credits + 1, onboarding_bonus_claimed = true
  where id = p_user_id and onboarding_bonus_claimed = false;
  if not found then return; end if;

  insert into credit_transactions (user_id, amount, reason) values (p_user_id, 1, 'onboarding_bonus');
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function maybe_award_onboarding_bonus(uuid) from public;

create or replace function trg_award_bonus_on_verification()
returns trigger as $$
begin
  if (new.email_verified and new.phone_verified) and
     (old.email_verified is distinct from new.email_verified or old.phone_verified is distinct from new.phone_verified) then
    perform maybe_award_onboarding_bonus(new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists award_bonus_on_verification on profiles;
create trigger award_bonus_on_verification
  after update of email_verified, phone_verified on profiles
  for each row execute procedure trg_award_bonus_on_verification();

create or replace function trg_award_bonus_on_listing()
returns trigger as $$
begin
  perform maybe_award_onboarding_bonus(new.user_id);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists award_bonus_on_listing on listings;
create trigger award_bonus_on_listing
  after insert on listings
  for each row execute procedure trg_award_bonus_on_listing();

-- 6. Retroactive backfill: sync existing auth.users verification state, then
-- evaluate every existing user once. Safe to re-run.
do $$
declare v_id uuid;
begin
  -- Both writes below are direct, top-level writes to profiles' credit and
  -- verification columns, so the prevent_credit_self_grant guard added at the
  -- bottom of this file would revert them (it only trusts writes nested inside
  -- another trigger's cascade). Set the same transaction-local bypass flag
  -- admin_update_user_credits uses. On the very first run the guard doesn't
  -- exist yet and this is a harmless no-op; it matters when re-running this
  -- block on a database that already has the guard. Wrapped in a DO block so
  -- the flag and the writes are guaranteed to share one transaction.
  perform set_config('app.bypass_credit_guard', 'true', true);

  update profiles p set
    email_verified = (u.email_confirmed_at is not null),
    phone_verified  = (u.phone_confirmed_at is not null)
  from auth.users u where u.id = p.id;

  for v_id in select id from profiles loop
    perform maybe_award_onboarding_bonus(v_id);
  end loop;
end $$;

-- 7. Move credits buyer -> seller the moment an exchange completes. Extends
-- the existing completed-exchange trigger function (already fires
-- `after update on conversations` — no trigger-registration change needed).
create or replace function complete_exchange_marks_listing_sold()
returns trigger as $$
declare
  v_book_count integer;
begin
  if new.exchange_status = 'completed' and old.exchange_status is distinct from 'completed' then
    update listings set status = 'sold' where id = new.listing_id returning book_count into v_book_count;

    update profiles set credits = credits - v_book_count where id = new.buyer_id;
    update profiles set credits = credits + v_book_count where id = new.seller_id;

    insert into credit_transactions (user_id, amount, reason, listing_id, conversation_id)
    values (new.buyer_id, -v_book_count, 'purchase_spent', new.listing_id, new.id);
    insert into credit_transactions (user_id, amount, reason, listing_id, conversation_id)
    values (new.seller_id, v_book_count, 'sale_earned', new.listing_id, new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- 8. The Wallet tab's transaction history is exactly
-- `where user_id = ? order by created_at desc` — index it, same as the
-- equivalent notifications indexes above.
create index if not exists credit_transactions_user_created_idx
  on credit_transactions(user_id, created_at desc);

-- 9. Seed email_verified/phone_verified at signup. sync_verification_status
-- only fires on UPDATE of auth.users; with GoTrue auto-confirm enabled,
-- email_confirmed_at is already set at INSERT time and no UPDATE ever follows,
-- which would leave email_verified false forever and make the onboarding bonus
-- permanently unreachable for that user. Body is otherwise identical to the
-- original definition at the top of this file (replaced here, same convention
-- as complete_exchange_marks_listing_sold above).
create or replace function handle_new_user()
returns trigger as $$
begin
  -- Must be schema-qualified: this trigger fires inside GoTrue's own
  -- transaction (as supabase_auth_admin), whose search_path doesn't
  -- include public, so the bare table name fails to resolve.
  insert into public.profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup, email_verified, phone_verified, zip, lat, lng)
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
    coalesce((new.raw_user_meta_data->>'share_pickup')::boolean, true),
    (new.email_confirmed_at is not null),
    (new.phone_confirmed_at is not null),
    coalesce(new.raw_user_meta_data->>'zip', ''),
    (new.raw_user_meta_data->>'lat')::double precision,
    (new.raw_user_meta_data->>'lng')::double precision
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
-- (trigger on_auth_user_created is unchanged — already fires after insert on auth.users)
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: prevent client self-grant of credit/verification columns ──────
-- Same problem, same fix shape as prevent_is_admin_self_grant above: RLS can't
-- be scoped to a column, and "Users can update own profile" (auth.uid() = id)
-- lets any authenticated user PATCH their own credits/verification flags
-- directly via the REST API. This guard reverts those four columns on any
-- write that isn't nested inside another trigger's cascade (pg_trigger_depth()
-- > 1 covers every legitimate internal writer: sync_verification_status,
-- trg_award_bonus_on_verification, trg_award_bonus_on_listing, and
-- complete_exchange_marks_listing_sold all reach this UPDATE from inside
-- another trigger). The one legitimate depth-1 writer is
-- admin_update_user_credits, which sets a transaction-local bypass flag
-- immediately before its own UPDATE — see that function below. (The one-time
-- backfill in the migration above sets the same flag too, so re-running that
-- block on a database that already has this guard still works.)
create or replace function prevent_credit_self_grant()
returns trigger as $$
begin
  if pg_trigger_depth() = 1
     and coalesce(current_setting('app.bypass_credit_guard', true), 'false') <> 'true' then
    new.credits                  := old.credits;
    new.email_verified           := old.email_verified;
    new.phone_verified           := old.phone_verified;
    new.onboarding_bonus_claimed := old.onboarding_bonus_claimed;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists prevent_credit_self_grant_trigger on profiles;
create trigger prevent_credit_self_grant_trigger before update on profiles
  for each row execute procedure prevent_credit_self_grant();

-- Admin credit adjustment: SECURITY DEFINER so it can write profiles/
-- credit_transactions despite their RLS, but only after verifying the caller
-- is an admin itself (the authoritative check — requireAdmin in the calling
-- TS action is a fast-path/UX guard only, not the security boundary).
create or replace function admin_update_user_credits(p_user_id uuid, p_credits integer)
returns boolean as $$
declare
  v_before integer;
  v_delta integer;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  select credits into v_before from profiles where id = p_user_id;
  if v_before is null then
    raise exception 'User not found.';
  end if;

  v_delta := p_credits - v_before;
  if v_delta = 0 then
    return true;
  end if;

  perform set_config('app.bypass_credit_guard', 'true', true);
  update profiles set credits = p_credits where id = p_user_id;

  insert into credit_transactions (user_id, amount, reason) values (p_user_id, v_delta, 'admin_adjustment');
  return true;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function admin_update_user_credits(uuid, integer) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: bundle & series listings ───────────────────────────────────────

ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS bundle_name text;

-- listings.title/author remain "book 1" — every existing single-book listing
-- and every piece of code that already reads listing.title/listing.author is
-- untouched. This table holds only the *additional* books in a bundle.
create table if not exists listing_books (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references listings(id) on delete cascade not null,
  title text not null,
  author text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table listing_books enable row level security;
create policy "Listing books are viewable by everyone" on listing_books for select using (true);
create policy "Owners can manage their listing's books" on listing_books
  for all using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

-- Postgres doesn't index FK columns automatically, and every lookup of a
-- bundle's contents is `where listing_id = ?` — the detail page's fetch, the
-- sync trigger's count(*), updateListing's wholesale delete, and the
-- on-delete-cascade check when a listing is removed.
create index if not exists listing_books_listing_id_idx on listing_books(listing_id);

-- Keep listings.book_count in sync automatically, so nothing downstream —
-- pricing, the credit-ledger onboarding "books posted" count, Browse/detail
-- rendering — ever needs to join or count listing_books itself.
create or replace function sync_listing_book_count()
returns trigger as $$
begin
  update listings set book_count = 1 + (select count(*) from listing_books where listing_id = coalesce(new.listing_id, old.listing_id))
  where id = coalesce(new.listing_id, old.listing_id);

  if new.listing_id is not null and old.listing_id is not null and new.listing_id is distinct from old.listing_id then
    update listings set book_count = 1 + (select count(*) from listing_books where listing_id = old.listing_id)
    where id = old.listing_id;
  end if;

  -- Re-evaluate the credit ledger's onboarding bonus now that book_count is
  -- accurate. trg_award_bonus_on_listing fires `after insert on listings`,
  -- which for a bundle is *before* its listing_books rows exist — at that
  -- moment book_count is still 1, so a user whose first post is a single
  -- 4-book bundle would show "4/3 books posted" on the Wallet checklist and
  -- never receive the credit. maybe_award_onboarding_bonus short-circuits on
  -- onboarding_bonus_claimed and re-checks all three conditions itself, so
  -- calling it on every listing_books write is idempotent and cheap.
  perform maybe_award_onboarding_bonus((select user_id from listings where id = coalesce(new.listing_id, old.listing_id)));

  return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_listing_books_change on listing_books;
create trigger on_listing_books_change
  after insert or update or delete on listing_books
  for each row execute procedure sync_listing_book_count();

-- book_count is meant to be entirely derived from listing_books via the
-- trigger above — never written directly by app code (createListing/
-- updateListing never set it, per this feature's design). But "Users can
-- update own listings" (auth.uid() = user_id, no column scoping — RLS can't
-- scope to a column) lets a listing's owner PATCH book_count directly via the
-- REST API to any value, independent of how many listing_books rows actually
-- exist — letting a lister charge buyers for books that aren't itemized
-- anywhere. Same shape of problem, same fix, as prevent_credit_self_grant:
-- revert any direct (non-cascaded) write. The legitimate path is always
-- nested inside a listing_books trigger (depth 2+ by the time it reaches
-- this UPDATE); a raw client PATCH on listings hits this guard at depth 1.
-- Unlike prevent_credit_self_grant there's no legitimate depth-1 writer to
-- carve out here — nothing in this app ever sets book_count directly — so
-- no bypass flag is needed.
--
-- This covers INSERT as well as UPDATE: "Users can insert own listings"
-- (auth.uid() = user_id) is equally unscoped by column, so without the INSERT
-- branch a client could simply POST a brand-new listing with an inflated
-- book_count (and is_bundle false, so no itemized list ever renders for the
-- buyer to check) and the UPDATE-only guard would never fire. On INSERT the
-- column is forced to 1 — createListing never sets book_count itself, so this
-- costs nothing for a normal single-book post, and for a bundle the
-- sync_listing_book_count trigger corrects it to the real value moments later
-- when that listing's listing_books rows are inserted (a separate statement,
-- reaching this table at trigger depth 2, which this guard still permits).
create or replace function prevent_book_count_self_edit()
returns trigger as $$
begin
  if pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' then
      new.book_count := 1;
    else
      new.book_count := old.book_count;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists prevent_book_count_self_edit_trigger on listings;
create trigger prevent_book_count_self_edit_trigger before insert or update on listings
  for each row execute procedure prevent_book_count_self_edit();
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: normalize existing state values to 2-letter codes ──────────────
-- Run this block in Supabase SQL Editor:
-- One-time backfill. profiles.state and tbr_entries.state used to be free
-- text (e.g. "California", "ca", "CA" all meant the same state but were
-- stored as different strings) — this broke both admin location grouping
-- and the exact-match comparison against profiles.state in
-- notify_tbr_matches() (see that function, further up this file). New
-- entries now come from a fixed <select> of 2-letter codes
-- (components/StateSelect.tsx / lib/usStates.ts), so this is a one-time
-- fix, not an ongoing function. Anything not recognized below (typos,
-- blank, non-US values) is left untouched rather than guessed at — those
-- rows are visible afterward in the admin Users tab for manual fixing.
--
-- Each UPDATE below is a fully self-contained statement (its own CTE, no
-- shared temp table). An earlier version of this migration used one
-- `create temporary table ... on commit drop` shared by both UPDATEs,
-- wrapped in explicit begin;/commit; — that failed in practice
-- ("relation state_map does not exist") because Supabase's SQL Editor
-- does not guarantee a pasted multi-statement buffer runs on a single
-- connection, so the session-scoped temp table didn't survive to the
-- second statement even with literal BEGIN/COMMIT text. Duplicating the
-- ~50-row mapping below costs some DRY-ness but makes each statement
-- correct in isolation, regardless of how the buffer gets split.
with state_map(input, code) as (
  values
    ('alabama','AL'), ('al','AL'),
    ('alaska','AK'), ('ak','AK'),
    ('arizona','AZ'), ('az','AZ'),
    ('arkansas','AR'), ('ar','AR'),
    ('california','CA'), ('ca','CA'),
    ('colorado','CO'), ('co','CO'),
    ('connecticut','CT'), ('ct','CT'),
    ('delaware','DE'), ('de','DE'),
    ('district of columbia','DC'), ('washington dc','DC'), ('washington d.c.','DC'), ('dc','DC'),
    ('florida','FL'), ('fl','FL'),
    ('georgia','GA'), ('ga','GA'),
    ('hawaii','HI'), ('hi','HI'),
    ('idaho','ID'), ('id','ID'),
    ('illinois','IL'), ('il','IL'),
    ('indiana','IN'), ('in','IN'),
    ('iowa','IA'), ('ia','IA'),
    ('kansas','KS'), ('ks','KS'),
    ('kentucky','KY'), ('ky','KY'),
    ('louisiana','LA'), ('la','LA'),
    ('maine','ME'), ('me','ME'),
    ('maryland','MD'), ('md','MD'),
    ('massachusetts','MA'), ('ma','MA'),
    ('michigan','MI'), ('mi','MI'),
    ('minnesota','MN'), ('mn','MN'),
    ('mississippi','MS'), ('ms','MS'),
    ('missouri','MO'), ('mo','MO'),
    ('montana','MT'), ('mt','MT'),
    ('nebraska','NE'), ('ne','NE'),
    ('nevada','NV'), ('nv','NV'),
    ('new hampshire','NH'), ('nh','NH'),
    ('new jersey','NJ'), ('nj','NJ'),
    ('new mexico','NM'), ('nm','NM'),
    ('new york','NY'), ('ny','NY'),
    ('north carolina','NC'), ('nc','NC'),
    ('north dakota','ND'), ('nd','ND'),
    ('ohio','OH'), ('oh','OH'),
    ('oklahoma','OK'), ('ok','OK'),
    ('oregon','OR'), ('or','OR'),
    ('pennsylvania','PA'), ('pa','PA'),
    ('rhode island','RI'), ('ri','RI'),
    ('south carolina','SC'), ('sc','SC'),
    ('south dakota','SD'), ('sd','SD'),
    ('tennessee','TN'), ('tn','TN'),
    ('texas','TX'), ('tx','TX'),
    ('utah','UT'), ('ut','UT'),
    ('vermont','VT'), ('vt','VT'),
    ('virginia','VA'), ('va','VA'),
    ('washington','WA'), ('wa','WA'),
    ('west virginia','WV'), ('wv','WV'),
    ('wisconsin','WI'), ('wi','WI'),
    ('wyoming','WY'), ('wy','WY')
)
update profiles set state = m.code
from state_map m
where lower(trim(profiles.state)) = m.input
  and profiles.state <> m.code;

with state_map(input, code) as (
  values
    ('alabama','AL'), ('al','AL'),
    ('alaska','AK'), ('ak','AK'),
    ('arizona','AZ'), ('az','AZ'),
    ('arkansas','AR'), ('ar','AR'),
    ('california','CA'), ('ca','CA'),
    ('colorado','CO'), ('co','CO'),
    ('connecticut','CT'), ('ct','CT'),
    ('delaware','DE'), ('de','DE'),
    ('district of columbia','DC'), ('washington dc','DC'), ('washington d.c.','DC'), ('dc','DC'),
    ('florida','FL'), ('fl','FL'),
    ('georgia','GA'), ('ga','GA'),
    ('hawaii','HI'), ('hi','HI'),
    ('idaho','ID'), ('id','ID'),
    ('illinois','IL'), ('il','IL'),
    ('indiana','IN'), ('in','IN'),
    ('iowa','IA'), ('ia','IA'),
    ('kansas','KS'), ('ks','KS'),
    ('kentucky','KY'), ('ky','KY'),
    ('louisiana','LA'), ('la','LA'),
    ('maine','ME'), ('me','ME'),
    ('maryland','MD'), ('md','MD'),
    ('massachusetts','MA'), ('ma','MA'),
    ('michigan','MI'), ('mi','MI'),
    ('minnesota','MN'), ('mn','MN'),
    ('mississippi','MS'), ('ms','MS'),
    ('missouri','MO'), ('mo','MO'),
    ('montana','MT'), ('mt','MT'),
    ('nebraska','NE'), ('ne','NE'),
    ('nevada','NV'), ('nv','NV'),
    ('new hampshire','NH'), ('nh','NH'),
    ('new jersey','NJ'), ('nj','NJ'),
    ('new mexico','NM'), ('nm','NM'),
    ('new york','NY'), ('ny','NY'),
    ('north carolina','NC'), ('nc','NC'),
    ('north dakota','ND'), ('nd','ND'),
    ('ohio','OH'), ('oh','OH'),
    ('oklahoma','OK'), ('ok','OK'),
    ('oregon','OR'), ('or','OR'),
    ('pennsylvania','PA'), ('pa','PA'),
    ('rhode island','RI'), ('ri','RI'),
    ('south carolina','SC'), ('sc','SC'),
    ('south dakota','SD'), ('sd','SD'),
    ('tennessee','TN'), ('tn','TN'),
    ('texas','TX'), ('tx','TX'),
    ('utah','UT'), ('ut','UT'),
    ('vermont','VT'), ('vt','VT'),
    ('virginia','VA'), ('va','VA'),
    ('washington','WA'), ('wa','WA'),
    ('west virginia','WV'), ('wv','WV'),
    ('wisconsin','WI'), ('wi','WI'),
    ('wyoming','WY'), ('wy','WY')
)
update tbr_entries set state = m.code
from state_map m
where lower(trim(tbr_entries.state)) = m.input
  and tbr_entries.state <> m.code;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: enforce state format at the database level ─────────────────────
-- Run this block in Supabase SQL Editor:
-- Backstop for the state-normalization work above: the app layer (signup,
-- profile edit, TBR add — see isValidStateCode() in lib/usStates.ts) now
-- rejects anything that isn't one of the 51 valid state codes before ever
-- writing it, but that's an app-layer guarantee, not a data-layer one — and
-- RLS does not restrict which columns a signed-in user's own browser
-- session can write (see "Users can update own profile" / "Users can add
-- tbr entries" policies above), so a direct client call bypassing the app
-- entirely can still write anything until this constraint exists. This is
-- not insurance against a hypothetical regression — until this block runs,
-- it is the only control on that direct-write path.
--
-- This is validated up front, not added NOT VALID: NOT VALID only skips
-- the one-time verification scan at creation — every subsequent INSERT
-- and UPDATE is still checked per-row, including updates that don't touch
-- `state`. Adding it NOT VALID on top of the known-remaining unmapped
-- legacy rows (left as free text by the backfill migration above,
-- deliberately not guessed at) would make every one of those rows
-- un-updatable forever after — silently breaking, among other things,
-- email/phone verification (sync_verification_status(), no exception
-- handler, runs inside GoTrue's own transaction) and exchange completion
-- (complete_exchange_marks_listing_sold()) for those users.
--
-- So: measure first, blank whatever doesn't conform (the app already
-- treats '' as "no state" everywhere — this loses no information the app
-- itself wouldn't already discard on that user's next profile save), then
-- add the constraints validated.

-- 1. Measure — inspect before blanking if you want a record of what's there.
select id, state from profiles    where state <> '' and state !~ '^[A-Z]{2}$';
select id, state from tbr_entries where state <> '' and state !~ '^[A-Z]{2}$';

-- 2. Blank anything that doesn't conform to "empty or two uppercase letters".
update profiles    set state = '' where state <> '' and state !~ '^[A-Z]{2}$';
update tbr_entries set state = '' where state <> '' and state !~ '^[A-Z]{2}$';

-- 3. Add the constraints validated — every row already complies at this
--    point, so this is instant and there is no follow-up validate step.
--    The drop-if-exists preamble matches this file's existing
--    drop-trigger-if-exists convention and makes this block safely
--    re-runnable.
alter table profiles drop constraint if exists profiles_state_format;
alter table profiles add constraint profiles_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');

alter table tbr_entries drop constraint if exists tbr_entries_state_format;
alter table tbr_entries add constraint tbr_entries_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: Open Library book metadata ───────────────────────────────────────
ALTER TABLE listings      ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE listings      ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE listing_books ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE listing_books ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE tbr_entries   ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE tbr_entries   ADD COLUMN IF NOT EXISTS cover_url text;

CREATE INDEX IF NOT EXISTS listings_ol_work_key_idx ON listings(ol_work_key);
CREATE INDEX IF NOT EXISTS listing_books_ol_work_key_idx ON listing_books(ol_work_key);
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: TBR notifications gain exact ol_work_key matching ───────────────
-- Mirrors buildTbrMatchStrategy() in lib/tbrMatch.ts: a TBR entry with a
-- resolved ol_work_key matches on that key alone (never falls back to the
-- fuzzy title/author text match below); entries without one keep the
-- existing word-boundary text-match behavior unchanged. City/state filtering
-- applies either way. Deliberately does not cover bundle contents (listing_books)
-- — this trigger has only ever looked at the main listing's title/author, and
-- extending it to bundles is out of scope for this change.
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
      and (
        (t.ol_work_key is not null and t.ol_work_key = new.ol_work_key)
        or (
          t.ol_work_key is null
          and (t.title = '' or new.title ~* ('(^|\W)' || tbr_escape_regex(t.title) || '(\W|$)'))
          and (t.author = '' or new.author ~* ('(^|\W)' || tbr_escape_regex(t.author) || '(\W|$)'))
        )
      )
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
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: listing ISBN ─────────────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS isbn text;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: Mapbox address autofill (zip + coordinates) ─────────────────────
-- Run this block in Supabase SQL Editor. Backs the Address Autofill feature on
-- signup/profile edit — see
-- docs/superpowers/specs/2026-08-09-mapbox-address-autofill-design.md.
-- lat/lng are nullable: a manually-typed address (no Mapbox suggestion picked)
-- never has coordinates, and that's an expected, permanent state for some
-- rows, not a to-be-filled-in-later gap.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS zip text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
-- ──────────────────────────────────────────────────────────────────────────────
