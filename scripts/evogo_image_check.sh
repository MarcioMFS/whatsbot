#!/usr/bin/env bash
# Sentinela: avisa no zap quando a imagem do evolution-go tem versão nova no registry.
# Motivo: imagem 3 meses velha = WhatsApp rejeita o client (405) → QR morto e risco
# de perder sessões vivas no próximo restart (incidente 2026-07-29).
set -euo pipefail

LOCAL=$(docker images --no-trunc --format '{{.ID}}' evoapicloud/evolution-go:latest | head -1)
REMOTE=$(docker manifest inspect evoapicloud/evolution-go:latest 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('config',{}).get('digest',''))" 2>/dev/null || true)

# fallback: compara via pull dry (docker manifest pode falhar sem experimental)
if [ -z "$REMOTE" ]; then
  REMOTE=$(docker buildx imagetools inspect evoapicloud/evolution-go:latest 2>/dev/null | grep -oE 'sha256:[a-f0-9]{64}' | head -1 || true)
fi
[ -z "$REMOTE" ] && exit 0

RUNNING_IMG=$(docker inspect whatsbot-evolution-go-1 --format '{{.Image}}' 2>/dev/null || echo "")
STATE_FILE=/root/work/whatsbot/.evogo-image-alert
LAST_ALERT=$(cat "$STATE_FILE" 2>/dev/null || echo "")

if [ "$LOCAL" != "$REMOTE" ] || { [ -n "$RUNNING_IMG" ] && [ "$RUNNING_IMG" != "$LOCAL" ]; }; then
  # 1 alerta por digest novo (não spamma todo dia)
  if [ "$LAST_ALERT" != "$REMOTE" ]; then
    curl -s -X POST http://localhost:8082/send/text -H 'Content-Type: application/json' -H 'apikey: site-01' \
      -d '{"number":"5511933624809@s.whatsapp.net","text":"⚠️ [whatsbot] Imagem nova do evolution-go no registry. Imagem velha = risco de Client outdated (405): QR morto e sessões podem cair no próximo restart. Atualizar em janela calma: docker pull evoapicloud/evolution-go:latest + recreate (ver memória feedback_whatsbot_evolution_degrade)."}' \
      -o /dev/null --max-time 30 || true
    echo "$REMOTE" > "$STATE_FILE"
  fi
fi
