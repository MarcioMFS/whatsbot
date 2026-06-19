-- Migração 024 — F2 do gerador evolutivo: store VIVO de padrões vencedores (substitui o
-- sales_skills_mining.md estático). Semeado com o playbook (status='seed') + destilado de
-- conversas que VIRARAM VENDA (status='candidate'/'promoted', com k-anonymity). Consumido pelo F3.
-- Ver Brain/spec_gerador_evolutivo.md.

CREATE TABLE IF NOT EXISTS winning_patterns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field            TEXT NOT NULL,                 -- introMessage|askMessage|offerMessage|payPatterns|general
  bucket           TEXT NOT NULL,                 -- rótulo do estilo (hook_warm, micro_commitment, ...)
  guidance         TEXT NOT NULL,                 -- a técnica/regra: o QUE fazer
  sample_text_anon TEXT,                          -- exemplo GENÉRICO (sem marca/preço/produto/PII)
  vertical         TEXT,                          -- null = global; senão productNoun
  source           TEXT NOT NULL DEFAULT 'distilled',  -- 'playbook' | 'distilled'
  status           TEXT NOT NULL DEFAULT 'candidate',  -- 'seed' | 'candidate' | 'promoted' | 'retired'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1 padrão por (campo, estilo, vertical). COALESCE no índice (vertical pode ser null).
CREATE UNIQUE INDEX IF NOT EXISTS idx_winning_patterns_uniq
  ON winning_patterns (field, bucket, COALESCE(vertical, ''));
CREATE INDEX IF NOT EXISTS idx_winning_patterns_lookup
  ON winning_patterns (status, field);

-- Estatística de validação por padrão (k-anonymity + lift + Wilson lower bound).
CREATE TABLE IF NOT EXISTS pattern_stats (
  pattern_id     UUID PRIMARY KEY REFERENCES winning_patterns(id) ON DELETE CASCADE,
  n_observations INTEGER NOT NULL DEFAULT 0,
  n_bots         INTEGER NOT NULL DEFAULT 0,
  conversions    INTEGER NOT NULL DEFAULT 0,
  lift           REAL,
  wilson_lower   REAL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
