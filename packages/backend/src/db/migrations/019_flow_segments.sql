-- Segmentos descritos por flow: agrupam nós sob {nome, descrição, quando usar} pra IA entender o flow.
-- Ver Brain/spec_skills_segmentos.md.
ALTER TABLE flows ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb;
