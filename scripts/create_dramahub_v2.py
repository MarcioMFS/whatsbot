#!/usr/bin/env python3
"""
DramaHub Flow v2 — Padrão Kleber
Slots comprados ≠ títulos escolhidos.
Rule-first intent → checkout → entrega por slots.
"""
import requests, json, sys

BASE     = "http://localhost:3013"
BOT_ID   = "2039b971-b290-4ff3-9964-ad78ff33dd3c"
EMAIL    = "69kleberlucas@gmail.com"
PASSWORD = "DramaHub@Script29"

# ── Auth ──────────────────────────────────────────────────────────────────────
r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
if r.status_code != 200:
    print("Login failed:", r.text); sys.exit(1)
token = r.json()["token"]
H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
print("✅ Login OK")

# ── Helpers ───────────────────────────────────────────────────────────────────
def n(id, type_, x, y, data):
    return {"id": id, "type": type_, "position": {"x": x, "y": y}, "data": data}

def e(src, tgt, handle=None):
    eid = f"e-{src}-{tgt}" + (f"-{handle}" if handle else "")
    return {"id": eid, "source": src, "target": tgt,
            "sourceHandle": handle, "targetHandle": None}

# ── Nodes ─────────────────────────────────────────────────────────────────────
CATALOG_URL = "https://dramahub.mfslabs.com.br/"
PIX_KEY     = "dramahub@mfslabs.com.br"
PIX_NAME    = "DramaHub"

WELCOME = (
    "Olá 😊 Seja bem-vindo(a) ao *DramaHub* 🎬\n\n"
    "Aqui você compra minisséries direto no WhatsApp, de forma rápida e segura.\n\n"
    "✅ Entrega imediata\n"
    "💳 Pagamento via Pix\n\n"
    "*Pacotes:*\n"
    "1 minissérie — R$6\n"
    "2 minisséries — R$10\n"
    "3 minisséries — R$13\n"
    "5 minisséries — R$20\n"
    "10 minisséries — R$30\n"
    "24 minisséries — R$55\n"
    "35 minisséries — R$75\n\n"
    "Você quer a minissérie do anúncio ou deseja escolher pelo catálogo? 😊"
)

nodes = [
    # ── Entry ──────────────────────────────────────────────────────────────
    n("trigger",          "trigger",          100, 50,  {"label": "Início", "triggerType": "any_message"}),
    n("text_welcome",     "text_message",     100, 200, {"label": "Boas-vindas", "message": WELCOME}),
    n("capture_initial",  "capture",          100, 400, {
        "label": "Aguardar Intenção",
        "variableName": "user_initial_message",
        "timeoutMinutes": 10,
        "suspendedReason": "awaiting_intent",
        "recoveryHints": ["quero", "catálogo", "pix", "comprovante"],
        "timeoutBehavior": "end",
    }),

    # ── Intent Classification (rule-first) ─────────────────────────────────
    n("classify_intent",  "classify_intent",  100, 600, {
        "label": "Classificar Intenção",
        "messageVariable": "user_initial_message",
    }),

    # ── Branch: quantity / ad_series → checkout ────────────────────────────
    n("capture_qty",      "capture",          500, 600, {
        "label": "Capturar Quantidade",
        "variableName": "__rt_intent_qty",
        "timeoutMinutes": 5,
        "suspendedReason": "awaiting_quantity",
        "timeoutMessage": "Me diz a quantidade quando quiser 😊",
        "timeoutBehavior": "end",
        "recoveryHints": ["1","2","3","5","10","quero"],
    }),
    n("text_qty_prompt",  "text_message",     500, 450, {
        "label": "Pedir Quantidade",
        "message": "Me diz só a quantidade de minisséries que você quer 😊\nEx: 1, 2, 3, 5 ou 10.",
    }),
    n("pkg_pix",          "package_pix",      500, 800, {
        "label": "Gerar Pix por Pacote",
        "quantityVariable": "__rt_intent_qty",
        "pixKey": PIX_KEY,
        "recipientName": PIX_NAME,
        "expiresInMinutes": 60,
    }),
    n("text_qty_invalid", "text_message",     800, 800, {
        "label": "Quantidade inválida",
        "message": "Me diz só a quantidade 😊\nEx: 1, 2, 3, 5 ou 10.",
    }),

    # ── Branch: catalog ────────────────────────────────────────────────────
    n("text_catalog",     "text_message",     -300, 600, {
        "label": "Enviar Catálogo",
        "message": f"Aqui está nosso catálogo completo 🎬\n{CATALOG_URL}\n\nQuando decidir, me diz quantas séries quer ou o nome da que escolheu 😊",
    }),
    n("capture_post_cat", "capture",          -300, 800, {
        "label": "Aguardar após catálogo",
        "variableName": "user_initial_message",
        "timeoutMinutes": 60,
        "suspendedReason": "awaiting_intent_post_catalog",
        "recoveryHints": ["quero","1","2","3","5","10"],
        "timeoutBehavior": "end",
    }),

    # ── Branch: pix_pending (já pagou, mas não enviou comprovante) ──────────
    n("text_pix_pending", "text_message",     -300, 200, {
        "label": "Já pagou — pedir comprovante",
        "message": "Ótimo! Me envia o comprovante do Pix para eu confirmar e liberar seu acesso 📸",
    }),

    # ── Branch: price_issue ────────────────────────────────────────────────
    n("notify_price",     "notification",     -600, 600, {
        "label": "Notificar Kleber — Preço",
        "phoneNumber": "{{__owner_phone__}}",
        "message": "⚠️ Cliente questionou preço: \"{{user_initial_message}}\" — Tel: {{__phone__}}",
    }),
    n("text_price_hold",  "text_message",     -600, 800, {
        "label": "Aguardando time",
        "message": "Entendo! Vou passar sua mensagem pro nosso time 😊\nEm breve alguém te retorna.",
    }),

    # ── Branch: doubt ──────────────────────────────────────────────────────
    n("ai_doubt",         "ai_response",      -900, 600, {
        "label": "Responder Dúvida",
        "promptTemplate": (
            "Você é o assistente do DramaHub, loja de minisséries coreanas/asiáticas.\n"
            "Responda de forma amigável e curta a dúvida do cliente sobre a série.\n"
            "Se não souber, diga que vai verificar.\n"
            "Mensagem: {{user_initial_message}}"
        ),
        "useHistory": False,
        "model": "claude-haiku-4-5-20251001",
    }),
    n("notify_doubt",     "notification",     -900, 800, {
        "label": "Notificar Kleber — Dúvida",
        "phoneNumber": "{{__owner_phone__}}",
        "message": "❓ Dúvida de cliente: \"{{user_initial_message}}\" — Tel: {{__phone__}}",
    }),

    # ── Branch: unknown (AI fallback) ──────────────────────────────────────
    n("notify_unknown",   "notification",     -1200, 600, {
        "label": "Notificar Kleber — Intervenção",
        "phoneNumber": "{{__owner_phone__}}",
        "message": "🤖 Preciso de ajuda com este cliente: \"{{user_initial_message}}\" — Tel: {{__phone__}}",
    }),
    n("text_human",       "text_message",     -1200, 800, {
        "label": "Conectar com humano",
        "message": "Deixa eu te conectar com nosso time 😊\nEm breve te retornamos!",
    }),

    # ── Payment validation ─────────────────────────────────────────────────
    n("capture_receipt",  "capture",          500, 1050, {
        "label": "Aguardar Comprovante",
        "variableName": "receipt_image",
        "timeoutMinutes": 30,
        "suspendedReason": "awaiting_pix_receipt",
        "expectedInputType": "image",
        "recoveryHints": ["comprovante","pix","paguei"],
        "timeoutBehavior": "suspend",
    }),
    n("validate_receipt", "ai_validate_receipt", 500, 1250, {
        "label": "Validar Comprovante",
        "paymentIntentVariable": "paymentIntentId",
    }),

    # ── Receipt fail: check count ──────────────────────────────────────────
    n("cond_fail_count",  "condition",        800, 1250, {
        "label": "2ª falha?",
        "variable": "__rt_receipt_fail_count",
        "operator": "equals",
        "value": "2",
    }),
    n("notify_pix_fail",  "notification",     1100, 1250, {
        "label": "Notificar Kleber — Pix inválido",
        "phoneNumber": "{{__owner_phone__}}",
        "message": "⚠️ Cliente enviou comprovante inválido 2x — Tel: {{__phone__}}",
    }),
    n("text_pix_problem", "text_message",     1100, 1450, {
        "label": "Problema no pagamento",
        "message": "Tivemos um problema com o comprovante 😕\nNosso time vai te ajudar em breve 🙏",
    }),
    n("text_retry",       "text_message",     800, 1450, {
        "label": "Pedir novo comprovante",
        "message": "Hmm, não consegui validar esse comprovante 😕\nPode enviar uma foto mais nítida ou o print do app?",
    }),

    # ── Title selection phase ──────────────────────────────────────────────
    n("text_ask_titles",  "text_message",     500, 1500, {
        "label": "Pedir títulos",
        "message": (
            "Pagamento confirmado ✅\n\n"
            "Agora me diga quais minisséries você quer receber.\n"
            "Você tem *{{__rt_remaining_slots}}* escolha(s).\n\n"
            "Pode mandar o nome ou ver o catálogo:\n"
            f"{CATALOG_URL}"
        ),
    }),
    n("capture_title",    "capture",          500, 1700, {
        "label": "Aguardar Título",
        "variableName": "title_choice",
        "timeoutMinutes": 60,
        "suspendedReason": "awaiting_title_choice",
        "recoveryHints": ["série","nome","quero","assistir"],
        "timeoutBehavior": "suspend",
    }),
    n("catalog_search",   "catalog_search",   500, 1900, {
        "label": "Buscar Série",
        "maxResults": 3,
    }),
    n("deliver_title",    "deliver_title",    500, 2100, {
        "label": "Entregar Acesso",
        "notifyOwnerOnMissingLink": True,
        "messageTemplate": "🎬 *{{name}}*\n\nAcesse aqui: {{accessLink}}",
    }),

    # ── More slots ─────────────────────────────────────────────────────────
    n("text_more_slots",  "text_message",     500, 2300, {
        "label": "Mais slots disponíveis",
        "message": (
            "Entregue ✅\n\n"
            "Você ainda tem direito a mais *{{__rt_remaining_slots}}* minissérie(s).\n"
            "Me manda o próximo nome 😊\n\n"
            f"Catálogo: {CATALOG_URL}"
        ),
    }),

    # ── Not found (already paid) ────────────────────────────────────────────
    n("notify_not_found", "notification",     800, 1900, {
        "label": "Notificar Kleber — Série não encontrada",
        "phoneNumber": "{{__owner_phone__}}",
        "message": "⚠️ Série não encontrada para {{__phone__}}: \"{{__rt_search_query}}\"\nSlots restantes: {{__rt_remaining_slots}}",
    }),
    n("text_searching",   "text_message",     800, 2100, {
        "label": "Verificando manualmente",
        "message": "Não encontrei essa automaticamente 🔍\nVou verificar pra você rapidinho!",
    }),

    # ── Partial (accessLink missing) ────────────────────────────────────────
    n("text_partial",     "text_message",     200, 2300, {
        "label": "Entrega parcial",
        "message": "Entreguei o que estava disponível ✅\nUm dos títulos está sendo verificado — te envio em breve 🔍",
    }),

    # ── Done ───────────────────────────────────────────────────────────────
    n("text_all_done",    "text_message",     500, 2500, {
        "label": "Tudo entregue",
        "message": "Prontinho ✅\nTodos os acessos foram enviados!\nQualquer dúvida é só me chamar 💜",
    }),

    # ── Ends ───────────────────────────────────────────────────────────────
    n("end_main",         "end",              500, 2700, {"label": "Fim"}),
    n("end_price",        "end",              -600, 1000, {"label": "Fim — Preço"}),
    n("end_doubt",        "end",              -900, 1000, {"label": "Fim — Dúvida"}),
    n("end_unknown",      "end",              -1200, 1000, {"label": "Fim — Unknown"}),
    n("end_pix_fail",     "end",              1100, 1600, {"label": "Fim — Pix Fail"}),
    n("end_not_found",    "end",              800, 2300, {"label": "Fim — Not Found"}),
]

# ── Edges ─────────────────────────────────────────────────────────────────────
edges = [
    # Entry
    e("trigger",          "text_welcome"),
    e("text_welcome",     "capture_initial"),
    e("capture_initial",  "classify_intent", "responded"),

    # Classify → branches
    e("classify_intent",  "text_qty_prompt",  "quantity"),
    e("classify_intent",  "text_qty_prompt",  "ad_series"),
    e("classify_intent",  "text_catalog",     "catalog"),
    e("classify_intent",  "text_pix_pending", "pix_pending"),
    e("classify_intent",  "notify_price",     "price_issue"),
    e("classify_intent",  "ai_doubt",         "doubt"),
    e("classify_intent",  "notify_unknown",   "unknown"),

    # Qty prompt → capture → pkg_pix
    e("text_qty_prompt",  "capture_qty"),
    e("capture_qty",      "pkg_pix",          "responded"),
    e("pkg_pix",          "capture_receipt",  "success"),
    e("pkg_pix",          "text_qty_invalid", "error"),
    e("text_qty_invalid", "capture_qty"),

    # Catalog loop → back to classify
    e("text_catalog",     "capture_post_cat"),
    e("capture_post_cat", "classify_intent",  "responded"),

    # pix_pending → skip to receipt capture
    e("text_pix_pending", "capture_receipt"),

    # Price issue
    e("notify_price",     "text_price_hold"),
    e("text_price_hold",  "end_price"),

    # Doubt
    e("ai_doubt",         "notify_doubt",     "success"),
    e("ai_doubt",         "notify_doubt",     "error"),
    e("notify_doubt",     "end_doubt"),

    # Unknown
    e("notify_unknown",   "text_human"),
    e("text_human",       "end_unknown"),

    # Payment validation
    e("capture_receipt",  "validate_receipt", "responded"),
    e("validate_receipt", "text_ask_titles",  "approved"),
    e("validate_receipt", "cond_fail_count",  "rejected"),

    # Fail count condition
    e("cond_fail_count",  "notify_pix_fail",  "true"),
    e("cond_fail_count",  "text_retry",       "false"),
    e("notify_pix_fail",  "text_pix_problem"),
    e("text_pix_problem", "end_pix_fail"),
    e("text_retry",       "capture_receipt"),

    # Title selection loop
    e("text_ask_titles",  "capture_title"),
    e("capture_title",    "catalog_search",   "responded"),
    e("catalog_search",   "deliver_title",    "found"),
    e("catalog_search",   "notify_not_found", "not_found"),
    e("notify_not_found", "text_searching"),
    e("text_searching",   "end_not_found"),

    # deliver_title handles
    e("deliver_title",    "text_all_done",    "done"),
    e("deliver_title",    "text_more_slots",  "more"),
    e("deliver_title",    "text_partial",     "partial"),
    e("deliver_title",    "notify_not_found", "error"),

    # Loop back for more slots
    e("text_more_slots",  "capture_title"),
    e("text_partial",     "capture_title"),

    # Done
    e("text_all_done",    "end_main"),
]

# ── Create flow ───────────────────────────────────────────────────────────────
payload = {
    "name": "DramaHub - Fluxo v2 (Slots + Rule-First)",
    "nodes": nodes,
    "edges": edges,
}

r = requests.post(f"{BASE}/api/flows/bot/{BOT_ID}", headers=H, json=payload)
if r.status_code not in (200, 201):
    print("❌ Create flow failed:", r.status_code, r.text); sys.exit(1)

flow = r.json()
FLOW_ID = flow["id"]
print(f"✅ Flow criado: {FLOW_ID}")
print(f"   Nós: {len(nodes)} | Edges: {len(edges)}")

# ── Activate flow (PATCH /api/bots/:botId/activate { flowId }) ────────────────
r = requests.patch(f"{BASE}/api/bots/{BOT_ID}/activate", headers=H, json={"flowId": FLOW_ID})
if r.status_code not in (200, 201, 204):
    print(f"⚠️  Activate returned {r.status_code}: {r.text}")
else:
    print(f"✅ Flow ativado como padrão do bot DramaHub")

print(f"\n📋 Flow ID: {FLOW_ID}")
print(f"🔗 FlowBuilder: http://localhost:5173/bots/{BOT_ID}/flows/{FLOW_ID}")
