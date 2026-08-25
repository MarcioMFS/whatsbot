#!/usr/bin/env bash
# O evolution-go vaza uma conexão Postgres por tentativa de reconexão de sessão. Em 29h ele
# ocupou as 100 vagas do banco do WhatsBot e derrubou tudo que depende dele — inclusive a
# entrega das respostas do Vox ("sorry, too many clients already", 2026-08-25 03:46).
#
# Reiniciar o container resolve, mas derruba as sessões de WhatsApp conectadas — e sessão
# sem credencial só volta com QR. Este reaper é cirúrgico: encerra apenas conexões OCIOSAS
# do banco do evolution, que ele reabre quando precisar. Nenhuma sessão cai.
#
# cron: */10 * * * * /root/work/whatsbot/scripts/evogo_conn_reaper.sh >> /root/work/whatsbot/conn-reaper.log 2>&1
set -uo pipefail

CONTAINER=whatsbot-postgres-1
DB_USER=whatsbot
LIMIT=60          # início da faixa de risco (o banco tem max_connections=100)
IDLE_MIN=5        # só encerra o que está parado há mais que isso

log() { echo "$(date -Is) $*"; }

total=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='evogo_auth';" 2>/dev/null | tr -d ' ')

if [ -z "$total" ]; then
  log "não consegui consultar o banco (pode já estar esgotado) — tentando limpar mesmo assim"
  total=999
fi

if [ "$total" -lt "$LIMIT" ]; then
  exit 0   # silêncio quando está tudo bem: log limpo é log que alguém lê
fi

killed=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "SELECT count(*) FROM (
     SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname='evogo_auth'
        AND state='idle'
        AND state_change < now() - interval '$IDLE_MIN minutes'
   ) t;" 2>/dev/null | tr -d ' ')

log "evogo_auth com $total conexões (limite $LIMIT) — encerradas ${killed:-0} ociosas"
