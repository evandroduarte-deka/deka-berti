-- ============================================================================
-- DEKA OS — Migration: obra_servicos v2
-- Adiciona campos do cronograma e sincronização com index.html
-- Execute no Supabase SQL Editor
-- ============================================================================

-- 1. dias_marcados: array de datas ISO (cronograma real do index.html)
ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS dias_marcados jsonb DEFAULT '[]'::jsonb;

-- 2. data_inicio / data_fim: range do serviço (redundante mas útil para queries rápidas)
ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS data_inicio date;

ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS data_fim date;

-- 3. pct_anterior: percentual antes da última atualização (para delta semanal)
ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS pct_anterior numeric DEFAULT 0
  CHECK (pct_anterior >= 0 AND pct_anterior <= 100);

-- 4. status: status atual do serviço
ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'A EXECUTAR'
  CHECK (status IN ('A EXECUTAR', 'EM ANDAMENTO', 'CONCLUÍDO', 'PAUSADO', 'AGUARDANDO'));

-- 5. updated_at: timestamp da última atualização
ALTER TABLE obra_servicos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_obra_servicos_data_inicio
  ON obra_servicos(data_inicio);

CREATE INDEX IF NOT EXISTS idx_obra_servicos_status
  ON obra_servicos(status);

-- Verificação final
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'obra_servicos'
ORDER BY ordinal_position;

-- ============================================================================
-- FIM DA MIGRATION
-- ============================================================================
