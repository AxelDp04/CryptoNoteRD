-- ============================================
-- CRYPTONOTE — Supabase Database Schema (P2P USDT/DOP)
-- Seguro de re-ejecutar (idempotente)
-- ============================================

-- 1. Tabla de transacciones
CREATE TABLE IF NOT EXISTS public.transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  coin_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  quantity    NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
  price       NUMERIC(20, 8) NOT NULL CHECK (price > 0),
  bank        TEXT NOT NULL,
  commission  NUMERIC(20, 8) NOT NULL DEFAULT 0,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar politicas si ya existen
DROP POLICY IF EXISTS "Users can view own transactions"   ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;

-- 4. Crear politicas
CREATE POLICY "Users can view own transactions"
  ON public.transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions
  FOR DELETE
  USING (auth.uid() = user_id);
