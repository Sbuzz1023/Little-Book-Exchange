-- Run this in your Supabase SQL Editor to fix Row Level Security policies

-- ── CONVERSATIONS ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "create conversations as buyer" ON public.conversations;
DROP POLICY IF EXISTS "update own conversations" ON public.conversations;

CREATE POLICY "view own conversations" ON public.conversations
FOR SELECT TO authenticated
USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "create conversations as buyer" ON public.conversations
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "update own conversations" ON public.conversations
FOR UPDATE TO authenticated
USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ── MESSAGES ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "participants can read messages" ON public.messages;
DROP POLICY IF EXISTS "participants can send messages" ON public.messages;

CREATE POLICY "participants can read messages" ON public.messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
  )
);

CREATE POLICY "participants can send messages" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id AND
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
  )
);

-- ── PROFILES (read access for all authenticated users) ─────────────────────
DROP POLICY IF EXISTS "authenticated users can read profiles" ON public.profiles;

CREATE POLICY "authenticated users can read profiles" ON public.profiles
FOR SELECT TO authenticated
USING (true);
