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
  insert into public.profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup, email_verified, phone_verified, zip)
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
    coalesce(new.raw_user_meta_data->>'zip', '')
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

-- ── Migration: Mapbox address autofill (zip) ────────────────────────────────────
-- Run this block in Supabase SQL Editor. Backs the Address Autofill feature on
-- signup/profile edit — see
-- docs/superpowers/specs/2026-08-09-mapbox-address-autofill-design.md.
--
-- An earlier version of this block also added `lat`/`lng` columns (removed
-- here — see the spec's Addendum: Mapbox Address Autofill's coordinates are
-- licensed as ephemeral-only and cannot be persisted). If that earlier
-- version was already run against your database, `lat`/`lng` are orphan
-- columns nothing writes to anymore. Check first:
--   select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name in ('zip','lat','lng');
-- If `lat`/`lng` come back, drop them:
--   alter table profiles drop column if exists lat, drop column if exists lng;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS zip text NOT NULL DEFAULT '';
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: case-insensitive usernames (capital-letter avatar initials) ─────
-- Run this block in Supabase SQL Editor. Backs the capital-letter avatar
-- initials feature — see
-- docs/superpowers/specs/2026-08-10-capital-letter-avatar-initials-design.md.
--
-- Converts profiles.username from `text` to `citext` (case-insensitive
-- text). This keeps username uniqueness and sign-in lookups working
-- correctly once the app stops force-lowercasing usernames on save —
-- "SeanB" and "seanb" are treated as the same username for comparison and
-- uniqueness, while the exact casing typed by the user is still what gets
-- stored and returned. Safe against existing data: every username stored
-- before this migration is already all-lowercase (a side effect of the
-- app's old .toLowerCase() calls), so there are no case collisions to
-- resolve.
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE profiles ALTER COLUMN username TYPE citext;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: email foundation (templates, send log, marketing opt-out) ─────
-- Run this block in Supabase SQL Editor:

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null unique check (type in ('welcome_confirmation', 'password_reset')),
  subject text not null,
  body text not null, -- plain text; supports {{username}} and {{link}} placeholders
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table email_templates enable row level security;

create policy "Admins can view email templates" on email_templates
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can update email templates" on email_templates
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

insert into email_templates (type, subject, body) values
  ('welcome_confirmation',
   'Welcome to Little Book Exchange, {{username}}! Confirm your email',
   E'Hi {{username}},\n\nWelcome to Little Book Exchange! Please confirm your email address by clicking the link below:\n\n{{link}}\n\nHappy trading!\n— The Little Book Exchange Team'),
  ('password_reset',
   'Reset your Little Book Exchange password',
   E'Hi {{username}},\n\nWe received a request to reset your password. Click the link below to choose a new one:\n\n{{link}}\n\nIf you did not request this, you can safely ignore this email — your password has not been changed.\n\n— The Little Book Exchange Team')
on conflict (type) do nothing;

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('welcome_confirmation', 'password_reset', 'broadcast')),
  -- one row per recipient per send (a broadcast to 42 people creates 42 rows);
  -- null only if the recipient somehow isn't a registered user
  recipient_user_id uuid references profiles(id),
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now()
);

alter table email_log enable row level security;

create policy "Admins can view email log" on email_log
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can insert email log" on email_log
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

alter table profiles add column if not exists marketing_opt_out boolean not null default false;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: store what the seller actually confirmed on the exchange ──────
-- Run this block in Supabase SQL Editor:
--
-- The seller's "Confirm" popup lets them review/edit their address and pickup
-- spot for this one exchange, without changing their saved profile/listing
-- defaults. That edited info is stored here (not just in the chat message) so
-- the buyer's "Ready for Pick Up" dashboard summary always matches exactly
-- what the confirmation message said, even if the seller's profile changes
-- later. Also: share_address / share_pickup are no longer read by the app —
-- the seller confirming the exchange is now the only gate on sharing this
-- info, so the old opt-in toggles were removed from Signup/Profile Edit. The
-- columns themselves are left in place, unused, rather than migrated out.
alter table conversations
  add column if not exists confirmed_address text,
  add column if not exists confirmed_address_unit text,
  add column if not exists confirmed_pickup text;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: dual pickup confirmation, 48hr auto-complete, disputes ────────
-- Run this block in Supabase SQL Editor:

-- 1. Per-party pickup confirmation timestamps + how an exchange finished.
alter table conversations
  add column if not exists seller_picked_up_at timestamptz,
  add column if not exists buyer_picked_up_at timestamptz,
  add column if not exists completion_type text check (completion_type in ('manual', 'auto_timeout'));

-- 2. Disputes. Filing one freezes resolve_pickup() below for that exchange
-- until an admin resolves it.
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table disputes enable row level security;

create policy "Participants and admins can view disputes" on disputes
  for select using (
    exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "A participant can file a dispute on their own exchange" on disputes
  for insert with check (
    reporter_id = auth.uid()
    and exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
  );

create policy "Admins can resolve disputes" on disputes
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create index if not exists disputes_conversation_idx on disputes (conversation_id);
create index if not exists disputes_open_idx on disputes (status) where status = 'open';

-- 3. resolve_pickup() — the single source of truth for "is this exchange
-- eligible to complete right now?" Called from: markPickedUp (a real user
-- just confirmed, p_actor_id set), the daily cron job (nobody's acting,
-- p_actor_id null), and an admin resolving a dispute (p_actor_id null).
create or replace function resolve_pickup(p_conversation_id uuid, p_actor_id uuid default null)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_completion_type text;
  v_book_title text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.exchange_status <> 'confirmed' then
    return 'not_applicable';
  end if;

  -- Caller authorization. This is security definer and granted to authenticated,
  -- so without this guard any signed-in user could resolve ANY conversation and
  -- spoof the completion message by passing an arbitrary p_actor_id.
  -- A null auth.uid() means the service-role key (the 48-hour cron job), which
  -- must keep working. Otherwise the caller must be a participant or an admin.
  -- Checked before the dispute check on purpose, so an unauthorized caller gets
  -- the same generic answer and learns nothing about whether a dispute exists.
  if auth.uid() is not null
     and auth.uid() not in (v_conv.buyer_id, v_conv.seller_id)
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  then
    return 'not_applicable';
  end if;

  if exists (select 1 from disputes where conversation_id = p_conversation_id and status = 'open') then
    return 'blocked_dispute';
  end if;

  if v_conv.buyer_picked_up_at is not null and v_conv.seller_picked_up_at is not null then
    v_completion_type := 'manual';
  elsif v_conv.buyer_picked_up_at is not null or v_conv.seller_picked_up_at is not null then
    if now() < coalesce(v_conv.buyer_picked_up_at, v_conv.seller_picked_up_at) + interval '48 hours' then
      return 'waiting';
    end if;
    v_completion_type := 'auto_timeout';
  else
    return 'waiting';
  end if;

  update conversations
  set exchange_status = 'completed', completed_at = now(), completion_type = v_completion_type
  where id = p_conversation_id;

  select title into v_book_title from listings where id = v_conv.listing_id;

  if v_completion_type = 'manual' and p_actor_id is not null then
    insert into messages (conversation_id, sender_id, body, kind)
    values (p_conversation_id, p_actor_id, '✅ Exchange completed — thanks for confirming pickup!', 'pickup');
  else
    -- Reached for auto_timeout, and also for a manual completion with no live
    -- actor (e.g. an admin resolving a dispute where both parties had already
    -- confirmed), so the wording has to branch on the completion type.
    insert into notifications (user_id, type, entity_id, title, body)
    select id, 'pickup', p_conversation_id,
      case when v_completion_type = 'manual' then 'Exchange completed' else 'Exchange auto-completed' end,
      case when v_completion_type = 'manual'
        then '✅ ' || coalesce(v_book_title, 'Your exchange') || ' — pickup confirmed by both of you.'
        else '⏱️ ' || coalesce(v_book_title, 'Your exchange') || ' auto-completed after 48 hours.'
      end
    from profiles where id in (v_conv.buyer_id, v_conv.seller_id) and notify_pickup = true;
  end if;

  return 'completed_' || v_completion_type;
exception when others then
  raise warning 'resolve_pickup failed: %', sqlerrm;
  return 'error';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function resolve_pickup(uuid, uuid) to authenticated, service_role;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: admin messaging (Email/Message tab) + support contact ─────────
-- Run this block in Supabase SQL Editor:

-- 1. conversations: relax NOT NULLs (type='admin' rows have no listing/buyer/
-- seller — they use user_id instead), add type/user_id/repliable.
alter table conversations alter column listing_id drop not null;
alter table conversations alter column buyer_id drop not null;
alter table conversations alter column seller_id drop not null;

alter table conversations
  add column if not exists type text not null default 'exchange' check (type in ('exchange', 'admin')),
  add column if not exists user_id uuid references profiles(id) on delete cascade,
  add column if not exists repliable boolean not null default true;

-- Ties `type` to which columns must be null/non-null, closing a gap where the
-- pre-existing "Buyers can create conversations" policy (which only checks
-- auth.uid() = buyer_id, with no type awareness) could otherwise be used to
-- insert a type='admin' row impersonating "Little Book Exchange Team" to any
-- other user. Every existing row satisfies this today (all three
-- listing/buyer/seller columns were NOT NULL until this same migration
-- relaxed them; user_id is brand new and currently all-null).
alter table conversations add constraint conversations_type_shape check (
  (type = 'exchange' and listing_id is not null and buyer_id is not null
     and seller_id is not null and user_id is null)
  or (type = 'admin' and listing_id is null and buyer_id is null
     and seller_id is null and user_id is not null)
);

-- The existing unique(listing_id, buyer_id) constraint is untouched — Postgres
-- treats NULL as distinct from NULL in unique constraints, so any number of
-- type='admin' rows (both columns always NULL) can coexist.

-- 2. conversations RLS: additional permissive policies for type='admin' rows.
-- Existing exchange-type policies are untouched — Postgres ORs multiple
-- permissive policies together for the same command.
create policy "Admin conversation visible to its user or any admin" on conversations
  for select using (
    type = 'admin' and (
      user_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
    )
  );

create policy "Admins or a user can start an admin conversation" on conversations
  for insert with check (
    type = 'admin' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
      or user_id = auth.uid()
    )
  );

-- 3. messages RLS: additional permissive policies for type='admin' conversations.
create policy "Admin conversation messages viewable by participant or admin" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (c.user_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true))
    )
  );

create policy "Admin conversation messages: admin always, user if repliable" on messages
  for insert with check (
    auth.uid() = sender_id and
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
        or (c.repliable = true and c.user_id = auth.uid())
      )
    )
  );

-- 4. notify_on_message(): teach it about type='admin' conversations. Admin →
-- user sends notify the user like any other message; user → admin sends
-- (support requests/replies) don't notify anyone — admins check the new
-- Inbox tab instead, same as the existing Disputes tab has no notification.
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

  if v_conv.type = 'admin' then
    if new.sender_id = v_conv.user_id then
      return new;
    end if;
    v_recipient := v_conv.user_id;
  else
    v_recipient := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;
  end if;

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
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: admin can permanently delete a dispute ───────────────────────
-- Run this block in Supabase SQL Editor:

-- No delete policy exists on disputes today — only select/insert/update. This
-- lets an admin permanently remove a dispute that never warranted a real
-- record (filed in error, resolved without needing a lasting trace) —
-- distinct from the existing Resolved/Unresolved status toggle, which keeps
-- the row. Same admin-only shape as the existing "Admins can resolve
-- disputes" update policy.
create policy "Admins can delete disputes" on disputes
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

-- ── Migration: unresolved as a real dispute outcome ──────────────────────────
-- Run this block in Supabase SQL Editor:

-- Previously status was just 'open' | 'resolved', and the admin panel's old
-- "Unresolved" button just reopened a resolved dispute back to 'open'. Now
-- an admin can close out an OPEN dispute one of two ways: Resolved (the
-- problem was actually fixed) or Unresolved (admin is done looking at it,
-- but it was never fixed) — both move the dispute out of the active queue
-- into History, just with a different outcome label. Either way unblocks
-- resolve_pickup() the same as before, since it only ever blocked on
-- status = 'open' — no change needed there.
alter table disputes drop constraint if exists disputes_status_check;
alter table disputes add constraint disputes_status_check check (status in ('open', 'resolved', 'unresolved'));

-- ── Migration: admin unread badges for Inbox and Disputes ───────────────────
-- Run this block in Supabase SQL Editor:

-- Two new nullable timestamps power the admin sidebar's unread-count badges.
-- Both default to null ("never read"), so every existing row starts unread —
-- harmless: an already-resolved dispute is never counted regardless (see
-- below), and an already-stale support conversation just needs one admin
-- visit to catch up, same as any new one.

-- conversations.admin_last_read_at: per-conversation, not per-admin — only
-- meaningful for type='admin' rows. Bumped to now() when that specific
-- conversation is opened in the admin Inbox. A conversation counts as
-- unread when it has a message from someone other than the admin newer
-- than this timestamp (or this is null and any such message exists).
alter table conversations add column if not exists admin_last_read_at timestamptz;

-- disputes.admin_read_at: dispute rows have no separate "click to view" (the
-- full dispute is always shown inline in the admin panel), so being
-- rendered in the Active list IS the read event — stamped the moment an
-- open, unread dispute is displayed there. A dispute counts as unread only
-- while status = 'open' and this is still null; resolving/closing it either
-- way means it's archived and never needs attention again regardless of
-- read state. Reopening a dispute (adminSetDisputeStatus back to 'open')
-- clears this back to null, so it correctly re-appears as unread.
alter table disputes add column if not exists admin_read_at timestamptz;

-- ── Migration: fix — admins couldn't actually mark an Inbox conversation read ─
-- Run this block in Supabase SQL Editor:

-- disputes.admin_read_at is fine — "Admins can resolve disputes" is already a
-- blanket admin UPDATE policy with no column restriction. But conversations
-- never had an equivalent for type='admin' rows: "Participants can update
-- conversations" only matches auth.uid() = buyer_id/seller_id, and both are
-- always null on an admin conversation (see conversations_type_shape) — so
-- no one, not even an admin, could update one. AdminInboxTab's mark-as-read
-- write was being silently blocked (Postgres RLS: 0 rows updated, no error),
-- so every conversation looked unread again on the next page load no matter
-- how many times it was opened. Same admin-only shape as the existing
-- "Admin conversation visible to its user or any admin" select policy.
create policy "Admins can update admin conversations" on conversations
  for update using (
    type = 'admin' and exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- ── Migration: seller-set pickup availability (time window / after a time / anytime) ─
-- Run this block in Supabase SQL Editor:

-- Set alongside confirmed_address/confirmed_pickup in the same seller
-- confirm-and-review popup — confirmed_pickup is *where* ("front porch"),
-- these four columns are *when*. confirmed_pickup_mode drives which of the
-- other three are populated: 'anytime' leaves date/times null (available
-- right now, nothing to schedule); 'after' sets date + time_start only (open
-- ended); 'window' sets all three. Required at confirm time — enforced in
-- the confirm-and-review popup UI and re-validated server-side in
-- confirmExchange — so an existing confirmed exchange predating this
-- migration simply has mode = null, which the UI already treats as "nothing
-- to show" the same as it did before this column existed.
alter table conversations
  add column if not exists confirmed_pickup_mode text,
  add column if not exists confirmed_pickup_date date,
  add column if not exists confirmed_pickup_time_start time,
  add column if not exists confirmed_pickup_time_end time;

alter table conversations drop constraint if exists conversations_pickup_mode_check;
alter table conversations add constraint conversations_pickup_mode_check
  check (confirmed_pickup_mode is null or confirmed_pickup_mode in ('window', 'after', 'anytime'));

-- ── Migration: homepage stat-bar aggregates ──────────────────────────────────
-- Run this block in Supabase SQL Editor.
--
-- The redesigned homepage (app/page.tsx) shows four community numbers. Two of
-- them read tables the public can already SELECT: listings ("Books Posted")
-- and library_locations ("Little Free Libraries"). The other two read tables
-- RLS keeps private — conversations (participants/admins only) and tbr_entries
-- (owner only) — so an anonymous visitor can't count them directly. These two
-- SECURITY DEFINER functions expose only the aggregate, never any row, and are
-- granted to anon + authenticated. STABLE + pinned search_path, same shape as
-- the other security-definer helpers above.

create or replace function home_completed_exchanges()
returns bigint
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select count(*) from conversations where exchange_status = 'completed';
$$;

revoke all on function home_completed_exchanges() from public;
grant execute on function home_completed_exchanges() to anon, authenticated;

create or replace function home_most_requested_book()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select title
  from tbr_entries
  where title <> ''
  group by title
  order by count(*) desc, title asc
  limit 1;
$$;

revoke all on function home_most_requested_book() from public;
grant execute on function home_most_requested_book() to anon, authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: homepage "top readers" avatars ────────────────────────────────
-- Run this block in Supabase SQL Editor.
--
-- The hero's four avatar circles show the most active members, ranked by
-- (books posted + completed exchanges they took part in). Books-posted is
-- public (listings), but exchange participation lives in conversations, which
-- RLS keeps to participants/admins — so this SECURITY DEFINER function does
-- the join server-side and returns only public profile fields (username, city)
-- for the top 4. No conversation row is ever exposed.

create or replace function home_top_readers()
returns table(username text, city text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with posted as (
    select user_id, count(*)::int as n from listings group by user_id
  ),
  exchanged as (
    select p.id as user_id, count(*)::int as n
    from profiles p
    join conversations c
      on (c.buyer_id = p.id or c.seller_id = p.id)
     and c.exchange_status = 'completed'
    group by p.id
  ),
  scored as (
    select p.id, p.username, p.city,
           coalesce(po.n, 0) + coalesce(ex.n, 0) as score
    from profiles p
    left join posted po on po.user_id = p.id
    left join exchanged ex on ex.user_id = p.id
  )
  select username, city
  from scored
  where score > 0 and coalesce(username, '') <> ''
  order by score desc, username asc
  limit 4;
$$;

revoke all on function home_top_readers() from public;
grant execute on function home_top_readers() to anon, authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ============================================================
-- Credit coin animation (2026-10-06)
-- ============================================================
-- The nav plays a coin animation for credit changes the user hasn't seen
-- yet (sales, purchases, welcome bonus). credits_seen_at is the newest
-- credit_transactions.created_at already played. No RLS change: "Users can
-- update own profile" already covers it, and prevent_credit_self_grant()
-- still guards credits itself — writing this column only replays or skips
-- the user's own animation.
alter table profiles
  add column if not exists credits_seen_at timestamptz not null default now();

-- Existing users start caught up, so their history doesn't replay.
update profiles set credits_seen_at = now();

-- ── Migration: shared backend 1/6 — private profile functions ────────────────
-- Run this block in Supabase SQL Editor:
-- Private profile columns (email, phone, address, credits, settings) are about
-- to be hidden from direct reads (block 6). These are the only ways to read
-- them afterwards: your own row, or — for admins — the Users list.
create or replace function get_my_profile()
returns setof profiles as $$
  select * from profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public, pg_temp;
grant execute on function get_my_profile() to authenticated;

-- Replaces a direct update whose `credits_seen_at < upTo` filter would need
-- SELECT on a hidden column.
create or replace function mark_credits_seen(p_up_to timestamptz)
returns void as $$
  update profiles set credits_seen_at = p_up_to
  where id = auth.uid() and credits_seen_at < p_up_to;
$$ language sql security definer set search_path = public, pg_temp;
grant execute on function mark_credits_seen(timestamptz) to authenticated;

create or replace function admin_list_users(p_user_ids uuid[] default null)
returns table (
  id uuid, username text, email text, city text, state text, zip text,
  created_at timestamptz, is_admin boolean, credits integer, marketing_opt_out boolean
) as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    return;
  end if;
  return query
    select p.id, p.username::text, p.email, p.city, p.state, p.zip,
           p.created_at, p.is_admin, p.credits, p.marketing_opt_out
    from profiles p
    where p_user_ids is null or p.id = any(p_user_ids)
    order by p.created_at desc;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;
grant execute on function admin_list_users(uuid[]) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: shared backend 2/6 — listing functions ────────────────────────
-- Run this block in Supabase SQL Editor:
-- Posting, editing, pausing and deleting go through these functions so the
-- website and the iPhone app follow the same rules. Mirrors lib/parseListingForm
-- (500-char description, max 20 bundle books, Open Library cover URLs only,
-- every book must have an Open Library match).

-- A photo must be in the caller's own folder of the book-photos bucket.
create or replace function lbe_photo_ok(p_url text)
returns boolean as $$
  select p_url is null
      or p_url ~ ('^https://[^/?#]+/storage/v1/object/public/book-photos/' || auth.uid()::text || '/[^/?#]+$');
$$ language sql stable set search_path = public, pg_temp;

-- Same pattern as COVER_URL_PATTERN in lib/openLibrary.ts.
create or replace function lbe_cover_or_null(p_url text)
returns text as $$
  select case when p_url ~ '^https://covers\.openlibrary\.org/b/id/\d+-[SML]\.jpg$' then p_url end;
$$ language sql immutable;

-- Trims bundle rows, drops blank ones, caps at 20, keeps order.
create or replace function lbe_clean_books(p_books jsonb)
returns jsonb as $$
  select coalesce(jsonb_agg(b order by ord), '[]'::jsonb) from (
    select jsonb_build_object(
             'title', btrim(coalesce(e->>'title', '')),
             'author', btrim(coalesce(e->>'author', '')),
             'ol_work_key', nullif(e->>'ol_work_key', ''),
             'cover_url', lbe_cover_or_null(e->>'cover_url')) as b, ord
    from jsonb_array_elements(coalesce(p_books, '[]'::jsonb)) with ordinality as t(e, ord)
    where btrim(coalesce(e->>'title', '')) <> '' or btrim(coalesce(e->>'author', '')) <> ''
    order by ord
    limit 20
  ) s;
$$ language sql immutable;

create or replace function lbe_check_listing(p_listing jsonb, p_books jsonb)
returns text as $$
declare v_price text;
begin
  if btrim(coalesce(p_listing->>'title', '')) = '' or btrim(coalesce(p_listing->>'author', '')) = '' then
    return 'invalid_listing';
  end if;
  if coalesce(p_listing->>'condition', '') not in ('Good', 'Fair', 'Well-Loved', 'good', 'fair', 'well-loved') then
    return 'invalid_listing';
  end if;
  if nullif(p_listing->>'ol_work_key', '') is null
     or exists (select 1 from jsonb_array_elements(p_books) b where nullif(b->>'ol_work_key', '') is null) then
    return 'needs_match';
  end if;
  if not (lbe_photo_ok(nullif(p_listing->>'photo_url', ''))
          and lbe_photo_ok(nullif(p_listing->>'photo_url_2', ''))
          and lbe_photo_ok(nullif(p_listing->>'photo_url_3', ''))) then
    return 'invalid_photo';
  end if;
  -- Validate price format: must be null/empty or match pattern for valid numeric(8,2)
  v_price := nullif(p_listing->>'price', '');
  if v_price is not null and not (v_price ~ '^\d{1,6}(\.\d{1,2})?$') then
    return 'invalid_listing';
  end if;
  return 'ok';
end;
$$ language plpgsql stable set search_path = public, pg_temp;

create or replace function create_listing(p_listing jsonb, p_books jsonb default '[]'::jsonb)
returns jsonb as $$
declare
  v_books jsonb;
  v_check text;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  -- Guard against malformed input: p_listing must be object, p_books must be array (or null)
  if jsonb_typeof(p_listing) is distinct from 'object' then
    return jsonb_build_object('status', 'invalid_listing');
  end if;
  if p_books is not null and jsonb_typeof(p_books) <> 'array' then
    return jsonb_build_object('status', 'invalid_listing');
  end if;
  v_books := case when coalesce(p_listing->>'is_bundle', '') = 'true' then lbe_clean_books(p_books) else '[]'::jsonb end;
  v_check := lbe_check_listing(p_listing, v_books);
  if v_check <> 'ok' then return jsonb_build_object('status', v_check); end if;

  -- Double-submit guard: if this caller already created an identical listing (same title,
  -- author, ol_work_key, is_bundle and bundle_name) in the last 60 seconds, return that
  -- listing instead of inserting a duplicate (e.g. a second tap while the first request
  -- was still in flight).
  select id into v_id from listings
  where user_id = auth.uid()
    and created_at > now() - interval '60 seconds'
    and title is not distinct from (p_listing->>'title')
    and author is not distinct from (p_listing->>'author')
    and ol_work_key is not distinct from (p_listing->>'ol_work_key')
    and is_bundle is not distinct from (jsonb_array_length(v_books) > 0)
    and bundle_name is not distinct from
        (case when jsonb_array_length(v_books) > 0 then nullif(btrim(coalesce(p_listing->>'bundle_name', '')), '') end)
  order by created_at desc
  limit 1;
  if v_id is not null then return jsonb_build_object('status', 'ok', 'id', v_id); end if;

  insert into listings (user_id, title, author, condition, price, description, genre, format,
                        pickup_description, ol_work_key, cover_url, isbn,
                        photo_url, photo_url_2, photo_url_3, city, is_bundle, bundle_name)
  values (
    auth.uid(),
    p_listing->>'title', p_listing->>'author', p_listing->>'condition',
    nullif(p_listing->>'price', '')::numeric,
    nullif(left(coalesce(p_listing->>'description', ''), 500), ''),
    nullif(p_listing->>'genre', ''), nullif(p_listing->>'format', ''),
    nullif(p_listing->>'pickup_description', ''),
    p_listing->>'ol_work_key', lbe_cover_or_null(p_listing->>'cover_url'), nullif(p_listing->>'isbn', ''),
    nullif(p_listing->>'photo_url', ''), nullif(p_listing->>'photo_url_2', ''), nullif(p_listing->>'photo_url_3', ''),
    coalesce((select city from profiles where id = auth.uid()), ''),
    jsonb_array_length(v_books) > 0,
    case when jsonb_array_length(v_books) > 0 then nullif(btrim(coalesce(p_listing->>'bundle_name', '')), '') end
  ) returning id into v_id;

  insert into listing_books (listing_id, title, author, ol_work_key, cover_url, position)
  select v_id, b->>'title', b->>'author', b->>'ol_work_key', b->>'cover_url', (ord - 1)::int
  from jsonb_array_elements(v_books) with ordinality as t(b, ord);

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function create_listing(jsonb, jsonb) to authenticated;

create or replace function update_listing(p_listing_id uuid, p_listing jsonb, p_books jsonb default '[]'::jsonb)
returns text as $$
declare
  v_existing listings%rowtype;
  v_books jsonb;
  v_check text;
begin
  select * into v_existing from listings where id = p_listing_id for update;
  if not found or v_existing.user_id is distinct from auth.uid() then return 'not_allowed'; end if;
  -- A buyer already requested it at its current book count (= price); once
  -- confirmed it is 'sold' and the completion trigger still reads book_count.
  if v_existing.status = 'pending' then return 'pending_request'; end if;
  if v_existing.status = 'sold' then return 'sold'; end if;
  -- Guard against malformed input: p_listing must be object, p_books must be array (or null)
  if jsonb_typeof(p_listing) is distinct from 'object' then
    return 'invalid_listing';
  end if;
  if p_books is not null and jsonb_typeof(p_books) <> 'array' then
    return 'invalid_listing';
  end if;
  v_books := case when coalesce(p_listing->>'is_bundle', '') = 'true' then lbe_clean_books(p_books) else '[]'::jsonb end;
  v_check := lbe_check_listing(p_listing, v_books);
  if v_check <> 'ok' then return v_check; end if;

  update listings set
    title = p_listing->>'title', author = p_listing->>'author', condition = p_listing->>'condition',
    price = nullif(p_listing->>'price', '')::numeric,
    description = nullif(left(coalesce(p_listing->>'description', ''), 500), ''),
    genre = nullif(p_listing->>'genre', ''), format = nullif(p_listing->>'format', ''),
    pickup_description = nullif(p_listing->>'pickup_description', ''),
    ol_work_key = p_listing->>'ol_work_key', cover_url = lbe_cover_or_null(p_listing->>'cover_url'),
    isbn = nullif(p_listing->>'isbn', ''),
    photo_url   = coalesce(nullif(p_listing->>'photo_url', ''),   v_existing.photo_url),
    photo_url_2 = coalesce(nullif(p_listing->>'photo_url_2', ''), v_existing.photo_url_2),
    photo_url_3 = coalesce(nullif(p_listing->>'photo_url_3', ''), v_existing.photo_url_3),
    is_bundle = jsonb_array_length(v_books) > 0,
    bundle_name = case when jsonb_array_length(v_books) > 0 then nullif(btrim(coalesce(p_listing->>'bundle_name', '')), '') end
  where id = p_listing_id;

  delete from listing_books where listing_id = p_listing_id;
  insert into listing_books (listing_id, title, author, ol_work_key, cover_url, position)
  select p_listing_id, b->>'title', b->>'author', b->>'ol_work_key', b->>'cover_url', (ord - 1)::int
  from jsonb_array_elements(v_books) with ordinality as t(b, ord);
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function update_listing(uuid, jsonb, jsonb) to authenticated;

-- Only the two states the Dashboard offers; pending/sold belong to the exchange flow.
create or replace function set_listing_status(p_listing_id uuid, p_status text)
returns text as $$
begin
  if p_status not in ('active', 'paused') then return 'invalid_status'; end if;
  update listings set status = p_status
  where id = p_listing_id and user_id = auth.uid() and status in ('active', 'paused');
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function set_listing_status(uuid, text) to authenticated;

create or replace function delete_listing(p_listing_id uuid)
returns text as $$
declare v_status text;
begin
  select status into v_status from listings where id = p_listing_id and user_id = auth.uid() for update;
  if not found then return 'not_allowed'; end if;
  if v_status = 'pending' then return 'pending_request'; end if;
  -- conversations.listing_id cascades: deleting a sold listing would erase the exchange, messages, disputes.
  if v_status = 'sold' then return 'sold'; end if;
  delete from listings where id = p_listing_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function delete_listing(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: shared backend 3/6 — messaging and requesting a book ──────────
-- Run this block in Supabase SQL Editor:

-- Credits are deducted only when an exchange completes, so every requested or
-- confirmed exchange holds its book_count until then. (Earlier code only
-- counted exchanges whose listing was still 'pending', but confirming marks
-- the listing 'sold' — freeing the buyer's credits too early. Mirrored in
-- lib/creditCheck.ts.)
create or replace function lbe_held_credits(p_buyer uuid, p_exclude_listing uuid)
returns integer as $$
  select coalesce(sum(l.book_count), 0)::int
  from conversations c join listings l on l.id = c.listing_id
  where c.buyer_id = p_buyer and c.type = 'exchange'
    and c.exchange_status in ('requested', 'confirmed')
    and c.listing_id is distinct from p_exclude_listing;
$$ language sql stable set search_path = public, pg_temp;
revoke execute on function lbe_held_credits(uuid, uuid) from public, anon, authenticated;

create or replace function start_conversation(p_listing_id uuid)
returns jsonb as $$
declare
  v_seller uuid;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select user_id into v_seller from listings where id = p_listing_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_seller = auth.uid() then return jsonb_build_object('status', 'own_listing'); end if;
  insert into conversations (listing_id, buyer_id, seller_id) values (p_listing_id, auth.uid(), v_seller)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from conversations where listing_id = p_listing_id and buyer_id = auth.uid();
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function start_conversation(uuid) to authenticated;

-- Replaces lock_listing_for_request + the website's multi-step request: one
-- transaction, so a failure can never leave a listing locked with no request.
create or replace function request_book(p_listing_id uuid)
returns jsonb as $$
declare
  v_listing listings%rowtype;
  v_balance integer;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select * into v_listing from listings where id = p_listing_id for update;
  if not found then return jsonb_build_object('status', 'not_available'); end if;
  if v_listing.user_id = auth.uid() then return jsonb_build_object('status', 'own_listing'); end if;
  if v_listing.status <> 'active' then return jsonb_build_object('status', 'not_available'); end if;

  if exists (select 1 from conversations where listing_id = p_listing_id and buyer_id <> auth.uid()
             and exchange_status in ('requested', 'confirmed')) then
    return jsonb_build_object('status', 'not_available');
  end if;

  select credits into v_balance from profiles where id = auth.uid() for update;
  if coalesce(v_balance, 0) - lbe_held_credits(auth.uid(), p_listing_id) < v_listing.book_count then
    return jsonb_build_object('status', 'insufficient_credits');
  end if;

  update listings set status = 'pending' where id = p_listing_id;

  insert into conversations (listing_id, buyer_id, seller_id, exchange_status)
  values (p_listing_id, auth.uid(), v_listing.user_id, 'requested')
  on conflict (listing_id, buyer_id) do update set exchange_status = 'requested', completed_at = null
  returning id into v_id;

  insert into messages (conversation_id, sender_id, body, kind)
  values (v_id, auth.uid(), '🛒 I''d like to purchase this book! Please confirm when you''re ready.', 'purchase_request');

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function request_book(uuid) to authenticated;

create or replace function cancel_request(p_conversation_id uuid)
returns text as $$
declare v_conv conversations%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.buyer_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status not in ('requested', 'none') then return 'wrong_status'; end if;
  if v_conv.exchange_status = 'requested' then
    update listings set status = 'active'
    where id = v_conv.listing_id and status = 'pending'
      and not exists (select 1 from conversations o where o.listing_id = v_conv.listing_id
                      and o.id <> p_conversation_id and o.exchange_status in ('requested', 'confirmed'));
  end if;
  delete from conversations where id = p_conversation_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function cancel_request(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: shared backend 4/6 — confirming and declining ─────────────────
-- Run this block in Supabase SQL Editor:

-- Same text as formatPickupAvailability() in lib/formatPickupAvailability.ts
-- (a test checks they agree). Used for the confirmation message.
create or replace function format_pickup_availability(p_mode text, p_date date, p_start time, p_end time)
returns text as $$
  select case
    when p_mode = 'anytime' then '✅ Ready for pickup now'
    when p_mode = 'after' and p_date is not null and p_start is not null and p_start < '24:00'::time
      then to_char(p_date, 'Dy, Mon FMDD') || ' · after ' || to_char(p_start, 'FMHH12:MI AM')
    when p_mode = 'window' and p_date is not null and p_start is not null and p_end is not null
      and p_start < '24:00'::time and p_end < '24:00'::time
      then to_char(p_date, 'Dy, Mon FMDD') || ' · ' || to_char(p_start, 'FMHH12:MI AM')
           || '–' || to_char(p_end, 'FMHH12:MI AM')
  end;
$$ language sql immutable;

-- Phone numbers are never included in the message, on purpose — they must
-- never be shared between users.
create or replace function confirm_exchange(p_conversation_id uuid, p_pickup jsonb)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_mode text := p_pickup->>'pickup_mode';
  v_date date;
  v_start time;
  v_end time;
  v_address text := btrim(coalesce(p_pickup->>'address', ''));
  v_unit text := btrim(coalesce(p_pickup->>'address_unit', ''));
  v_city text := btrim(coalesce(p_pickup->>'city', ''));
  v_state text := case when coalesce(p_pickup->>'state', '') ~ '^[A-Z]{2}$' then p_pickup->>'state' else '' end;
  v_pickup text := btrim(coalesce(p_pickup->>'pickup', ''));
  v_username text;
  v_lines text[];
  v_avail text;
  v_date_str text;
  v_start_str text;
  v_end_str text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.seller_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status <> 'requested' then return 'wrong_status'; end if;

  if jsonb_typeof(p_pickup) is distinct from 'object' then return 'invalid_pickup'; end if;
  if v_mode is null or v_mode not in ('window', 'after', 'anytime') then return 'invalid_pickup'; end if;

  v_date_str := nullif(p_pickup->>'pickup_date', '');
  v_start_str := nullif(p_pickup->>'pickup_time_start', '');
  v_end_str := nullif(p_pickup->>'pickup_time_end', '');

  if v_date_str is not null and v_date_str !~ '^\d{4}-\d{2}-\d{2}$' then
    return 'invalid_pickup';
  end if;
  if v_start_str is not null and v_start_str !~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then
    return 'invalid_pickup';
  end if;
  if v_end_str is not null and v_end_str !~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then
    return 'invalid_pickup';
  end if;

  begin
    v_date  := v_date_str::date;
    v_start := v_start_str::time;
    v_end   := v_end_str::time;
  exception when others then
    return 'invalid_pickup';
  end;
  if not (v_mode = 'anytime'
          or (v_mode = 'after' and v_date is not null and v_start is not null)
          or (v_mode = 'window' and v_date is not null and v_start is not null and v_end is not null)) then
    return 'invalid_pickup';
  end if;
  if v_mode = 'anytime' then v_date := null; v_start := null; end if;
  if v_mode <> 'window' then v_end := null; end if;

  update conversations set
    exchange_status = 'confirmed',
    confirmed_address = nullif(v_address, ''), confirmed_address_unit = nullif(v_unit, ''),
    confirmed_pickup = nullif(v_pickup, ''), confirmed_pickup_mode = v_mode,
    confirmed_pickup_date = v_date, confirmed_pickup_time_start = v_start, confirmed_pickup_time_end = v_end
  where id = p_conversation_id;

  update notifications set read = true
  where user_id = auth.uid() and entity_id = p_conversation_id and type = 'purchase_request';

  update listings set status = 'sold' where id = v_conv.listing_id and status = 'pending';

  select username into v_username from profiles where id = auth.uid();
  v_avail := format_pickup_availability(v_mode, v_date, v_start, v_end);
  v_lines := array[
    '📍 Exchange confirmed! Here''s how to connect:',
    '👤 ' || coalesce(v_username, ''),
    '📌 ' || v_city || case when v_state <> '' then ', ' || v_state else '' end
  ];
  if v_address <> '' or v_unit <> '' then
    v_lines := v_lines || ('🏠 ' || concat_ws(' ', nullif(v_address, ''), nullif(v_unit, '')));
  end if;
  if v_pickup <> '' then v_lines := v_lines || ('📦 Pickup: ' || v_pickup); end if;
  if v_avail is not null then v_lines := v_lines || ('🕐 ' || v_avail); end if;

  insert into messages (conversation_id, sender_id, body, kind)
  values (p_conversation_id, auth.uid(), array_to_string(v_lines, E'\n'), 'confirmation');
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function confirm_exchange(uuid, jsonb) to authenticated;

create or replace function deny_request(p_conversation_id uuid)
returns text as $$
declare v_conv conversations%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.seller_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status <> 'requested' then return 'wrong_status'; end if;

  perform create_notification(v_conv.buyer_id, 'purchase_decision', p_conversation_id);
  update conversations set exchange_status = 'declined', completed_at = now() where id = p_conversation_id;
  update listings set status = 'active' where id = v_conv.listing_id and status = 'pending';
  update notifications set read = true
  where user_id = auth.uid() and entity_id = p_conversation_id and type = 'purchase_request';
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function deny_request(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: shared backend 5/6 — pickup, disputes, history, support, TBR ──
-- Run this block in Supabase SQL Editor:

-- Set (by the server, service role) once the admins have been emailed about a
-- dispute, so the app's notify endpoint can't be used to spam them.
alter table disputes add column if not exists admin_notified_at timestamptz;

create or replace function mark_picked_up(p_conversation_id uuid)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_result text;
  v_username text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.type <> 'exchange' or auth.uid() is null
     or (auth.uid() is distinct from v_conv.buyer_id and auth.uid() is distinct from v_conv.seller_id) then
    return 'not_allowed';
  end if;
  if v_conv.exchange_status <> 'confirmed' then return 'wrong_status'; end if;

  if auth.uid() = v_conv.seller_id then
    if v_conv.seller_picked_up_at is not null then return 'already_marked'; end if;
    update conversations set seller_picked_up_at = now() where id = p_conversation_id;
  else
    if v_conv.buyer_picked_up_at is not null then return 'already_marked'; end if;
    update conversations set buyer_picked_up_at = now() where id = p_conversation_id;
  end if;

  -- resolve_pickup completes the exchange (and so moves credits) only when its
  -- own rules say so: both sides marked, no open dispute.
  v_result := resolve_pickup(p_conversation_id, auth.uid());
  if v_result = 'waiting' then
    select username into v_username from profiles where id = auth.uid();
    insert into messages (conversation_id, sender_id, body, kind)
    values (p_conversation_id, auth.uid(),
            '📦 ' || coalesce(v_username, 'They') || ' marked this picked up! Please confirm on your end within 48 hours.',
            'pickup');
  end if;
  return v_result;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function mark_picked_up(uuid) to authenticated;

create or replace function file_dispute(p_conversation_id uuid, p_message text)
returns jsonb as $$
declare
  v_conv conversations%rowtype;
  v_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.type <> 'exchange' or auth.uid() is null
     or (auth.uid() is distinct from v_conv.buyer_id and auth.uid() is distinct from v_conv.seller_id) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if btrim(coalesce(p_message, '')) = '' then return jsonb_build_object('status', 'empty_message'); end if;
  if exists (select 1 from disputes where conversation_id = p_conversation_id and status = 'open') then
    return jsonb_build_object('status', 'already_open');
  end if;
  insert into disputes (conversation_id, reporter_id, message)
  values (p_conversation_id, auth.uid(), btrim(p_message))
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function file_dispute(uuid, text) to authenticated;

create or replace function hide_exchange(p_conversation_id uuid)
returns text as $$
begin
  update conversations set
    buyer_hidden  = buyer_hidden  or buyer_id  = auth.uid(),
    seller_hidden = seller_hidden or seller_id = auth.uid()
  where id = p_conversation_id and auth.uid() in (buyer_id, seller_id);
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function hide_exchange(uuid) to authenticated;

create or replace function start_support_conversation()
returns jsonb as $$
declare v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select id into v_id from conversations
  where type = 'admin' and user_id = auth.uid() and repliable = true
  order by created_at desc limit 1;
  if v_id is null then
    insert into conversations (type, user_id, repliable) values ('admin', auth.uid(), true)
    returning id into v_id;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function start_support_conversation() to authenticated;

create or replace function move_saved_to_tbr(p_listing_id uuid)
returns text as $$
declare v_listing listings%rowtype;
begin
  if auth.uid() is null then return 'not_allowed'; end if;
  -- Check caller has this listing saved before proceeding
  if not exists (select 1 from saved_listings where user_id = auth.uid() and listing_id = p_listing_id) then
    return 'not_found';
  end if;
  select * into v_listing from listings where id = p_listing_id;
  if not found then return 'not_found'; end if;
  insert into tbr_entries (user_id, title, author, city, state)
  values (auth.uid(), v_listing.title, v_listing.author, coalesce(v_listing.city, ''), '');
  delete from saved_listings where user_id = auth.uid() and listing_id = p_listing_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function move_saved_to_tbr(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: shared backend 6/6 — lockdown ─────────────────────────────────
-- Run this block in Supabase SQL Editor ONLY AFTER the website using blocks
-- 1–5 is deployed. From here on members change exchanges, listings and
-- disputes only through the functions in blocks 2–5, and private profile
-- columns are readable only through get_my_profile() / admin_list_users().
-- Policies are dropped under both names they have had (schema.sql and the
-- older rls-policies.sql) since either may be live.

-- Exchanges: no direct member writes (admin policies stay).
drop policy if exists "Buyers can create conversations" on conversations;
drop policy if exists "create conversations as buyer" on conversations;
drop policy if exists "Participants can update conversations" on conversations;
drop policy if exists "update own conversations" on conversations;
drop policy if exists "buyer can cancel conversations" on conversations;
drop policy if exists "Sellers can deny conversations" on conversations;

-- Listings and bundle books: only via create/update/set_status/delete_listing.
drop policy if exists "Users can insert own listings" on listings;
drop policy if exists "Users can update own listings" on listings;
drop policy if exists "Users can delete own listings" on listings;
drop policy if exists "Owners can manage their listing's books" on listing_books;

-- Disputes: only via file_dispute (admins keep update/delete).
drop policy if exists "A participant can file a dispute on their own exchange" on disputes;

-- Messages: members send plain chat only; request/confirmation/pickup
-- messages come from the functions. Support-thread policy is unchanged.
drop policy if exists "Participants can send messages" on messages;
drop policy if exists "participants can send messages" on messages;
drop policy if exists "Participants can send chat messages" on messages;
create policy "Participants can send chat messages" on messages
  for insert with check (
    kind = 'chat'
    and auth.uid() = sender_id
    and exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'exchange'
        and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );

-- Support threads: members start them only via start_support_conversation()
-- (security definer); direct inserts are admin-only. Members replying in their
-- own thread send plain chat only.
drop policy if exists "Admins or a user can start an admin conversation" on conversations;
drop policy if exists "Admins can start an admin conversation" on conversations;
create policy "Admins can start an admin conversation" on conversations
  for insert with check (
    type = 'admin'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "Admin conversation messages: admin always, user if repliable" on messages;
create policy "Admin conversation messages: admin always, user if repliable" on messages
  for insert with check (
    auth.uid() = sender_id and
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
        or (kind = 'chat' and c.repliable = true and c.user_id = auth.uid())
      )
    )
  );

-- Photos: only into your own folder (the path the site already uses).
drop policy if exists "Authenticated users can upload photos" on storage.objects;
drop policy if exists "Users can upload photos to their own folder" on storage.objects;
create policy "Users can upload photos to their own folder" on storage.objects
  for insert with check (
    bucket_id = 'book-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Folded into request_book.
revoke execute on function lock_listing_for_request(uuid) from public, anon, authenticated;
-- cancel_request/deny_request replace it (its website callers are gone; the cron and admin use resolve_pickup).
revoke execute on function reopen_listing(uuid) from public, anon, authenticated;

-- Profiles: only public columns are directly readable. is_admin stays
-- readable because many policies check it for the caller.
revoke select on profiles from anon, authenticated;
grant select (id, username, city, state, created_at, is_admin) on profiles to anon, authenticated;
-- Any NEW profile column that should be publicly readable needs its own
-- `grant select (col) on profiles to anon, authenticated`.
-- ──────────────────────────────────────────────────────────────────────────────
