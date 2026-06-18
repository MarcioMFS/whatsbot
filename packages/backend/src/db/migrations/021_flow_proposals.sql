-- Builder/Improver plano (passo 2): GATE humano + versionamento de flow.
-- flow_proposals = fila de propostas da IA (NÃO aplicadas até aprovação humana).
-- flow_versions  = snapshot do flow ANTES de cada apply (rollback; corrige o UPSERT destrutivo do FlowRepository).

CREATE TABLE IF NOT EXISTS flow_proposals (
  id               uuid PRIMARY KEY,
  bot_id           uuid NOT NULL,
  flow_id          uuid,                              -- null = proposta de flow novo
  kind             text NOT NULL,                     -- generate_segments | improve_copy | add_capability | generate_flow | ...
  target_runtime   text,                              -- 'flow' | 'agent' (qual unidade de melhoria)
  proposed_content jsonb NOT NULL,
  baseline_metrics jsonb,
  baseline_stamp   text,                              -- flows.updated_at no momento da geração (concorrência otimista)
  status           text NOT NULL DEFAULT 'pending',   -- pending | approved | applied | rejected | stale
  created_by       text NOT NULL DEFAULT 'ai',
  reviewed_by      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_flow_proposals_bot_status ON flow_proposals(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_flow_proposals_flow ON flow_proposals(flow_id);

CREATE TABLE IF NOT EXISTS flow_versions (
  id          uuid PRIMARY KEY,
  flow_id     uuid NOT NULL,
  version     int NOT NULL,
  nodes       jsonb NOT NULL,
  edges       jsonb NOT NULL,
  segments    jsonb,
  changed_by  text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON flow_versions(flow_id, version DESC);
