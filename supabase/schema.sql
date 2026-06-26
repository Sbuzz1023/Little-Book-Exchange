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
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Public profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, username, city, state, phone, contact_preference)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'contact_preference', 'email')
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
  created_at timestamptz default now(),
  unique(listing_id, buyer_id)
);

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
