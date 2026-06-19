-- Migração 025 — F4 do gerador evolutivo: fecha o loop. Carimba qual conjunto de padrões gerou
-- cada flow (flows.pattern_set_version) + qual padrão entrou em cada versão (pattern_set_members),
-- pra medir conversão por versão e PROMOVER/APOSENTAR padrões por dado. Ver Brain/spec_gerador_evolutivo.md.

-- Versão de padrões que gerou o flow (null = flow não-gerado / sem F3).
ALTER TABLE flows ADD COLUMN IF NOT EXISTS pattern_set_version TEXT;

-- Quais padrões compuseram cada versão (pra creditar performance ao padrão individual).
CREATE TABLE IF NOT EXISTS pattern_set_members (
  pattern_set_version TEXT NOT NULL,
  pattern_id          UUID NOT NULL REFERENCES winning_patterns(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pattern_set_version, pattern_id)
);

CREATE INDEX IF NOT EXISTS idx_pattern_set_members_pattern ON pattern_set_members(pattern_id);
