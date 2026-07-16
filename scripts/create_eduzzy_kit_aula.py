#!/usr/bin/env python3
"""
Eduzzy — Kit Aula Pronta Infantil (funil roteirizado, estilo Typebot)

Roda no MESMO número do bot Doramas Online: o flow entra com trigger 'keyword'
(mensagem pré-preenchida do anúncio) e o roteamento por keyword do
FlowExecutionService o seleciona em conversas novas. Todo o resto do tráfego
continua caindo no flow default (DramaHub, any_message).

O flow é criado INATIVO (não mexe no active_flow_id do bot).

ANTES DE RODAR, preencha:
  - Fechamento é Pix direto (PIX_KEY equipenotadez@jim.com), chave em bolha separada
  - KEYWORDS: precisa casar com o texto pré-preenchido do anúncio
  - HAS_PRINTS: ligue quando houver prints REAIS de depoimento (05..08-printN.jpg)
"""
import os, requests, sys

BASE     = "http://localhost:3013"
# Doramas Online Bot (instância site-01, nº 558193976255, runtime=agent).
# O funil entra por keyword e o messageWorker desvia do agente só nessas conversas.
BOT_ID   = "fe994a71-a0b1-433e-992b-a584cec8a839"
# Credenciais via env (o flow em prod é atualizado direto no DB; ver Brain).
EMAIL    = os.environ.get("WHATSBOT_EMAIL", "")
PASSWORD = os.environ.get("WHATSBOT_PASSWORD", "")

FLOW_NAME = "Nota Dez — Kit Aula Pronta Infantil"

# Texto sugerido pro anúncio (click-to-WhatsApp): "Oi! Quero saber mais sobre o Kit Aula Pronta 💙"
KEYWORDS = ["kit aula pronta", "planinhos de aula"]

PIX_KEY  = "equipenotadez@jim.com"
PIX_NAME = "Equipe Nota Dez"

# Kit entregue após pagamento confirmado (PDFs em public/media/eduzzy/kit/, gitignored)
KIT_FILES = [
    "01-Tracar-Numeros-1-a-20.pdf",
    "02-Tracar-Letras-A-a-Z.pdf",
    "03-Contar-e-Circular-1-a-10.pdf",
    "04-Formas-e-Cores-para-Colorir.pdf",
    "05-Labirintos.pdf",
    "06-Ligue-os-Pontos.pdf",
    "07-Associe-os-Iguais.pdf",
    "08-Sequencia-Logica.pdf",
    "09-Maior-e-Menor.pdf",
    "10-Animais-Tracar-Nomes.pdf",
    "11-Modelos-de-Rotina.pdf",
    "12-Coordenacao-Motora-Infantil.pdf",
    "13-Caderno-de-Atividades-Completo.pdf",
    "14-Atividades-Ludicas-Psicomotricidade.pdf",
    "15-Alfabetizacao-4-e-5-Anos.pdf",
    "16-Atividades-para-Criancas.pdf",
]

# 6 imagens geradas (Imagen + tipografia Nunito) e servidas pelo frontend em
# packages/frontend/public/media/eduzzy/. False → funil só-texto (nós de imagem
# com legenda viram text_message; os demais saem da corrente).
INCLUDE_IMAGES = True

# Prints de depoimento (prova social) NÃO gerados por IA — usar prints reais
# autorizados quando existirem: suba 05..08-printN.jpg e ligue esta flag.
HAS_PRINTS = False
MEDIA_BASE = "https://whatsbot.mfslabs.com.br/media/eduzzy"
IMG = {
    "capa":      f"{MEDIA_BASE}/00-capa-kit.jpg",
    "hero":      f"{MEDIA_BASE}/01-hero.jpg",
    "materiais": f"{MEDIA_BASE}/02-materiais.jpg",
    "planos":    f"{MEDIA_BASE}/03-planos-bncc.jpg",
    "atividades":f"{MEDIA_BASE}/04-atividades.jpg",
    "print1":    f"{MEDIA_BASE}/05-print1.jpg",  # TODO print real
    "print2":    f"{MEDIA_BASE}/06-print2.jpg",  # TODO print real
    "print3":    f"{MEDIA_BASE}/07-print3.jpg",  # TODO print real
    "print4":    f"{MEDIA_BASE}/08-print4.jpg",  # TODO print real
    "amostra1":  f"{MEDIA_BASE}/amostra-1-labirinto.jpg",   # páginas REAIS do kit (legado, fora da corrente)
    "amostra2":  f"{MEDIA_BASE}/amostra-2-tracar.jpg",
    "amostra3":  f"{MEDIA_BASE}/amostra-3-rotina.jpg",
    # vídeo de amostra real (720p ~9MB, h264+aac; original em /root/work/.claude-uploads/)
    "amostra_video": f"{MEDIA_BASE}/amostra-video.mp4",
    "garantia":  f"{MEDIA_BASE}/09-garantia.jpg",
    "cupom":     f"{MEDIA_BASE}/10-cupom.jpg",
}

# Voice notes da Juliana (MiniMax, gerados pelo Marcio 2026-07-16; OGG/Opus 32k).
# Roteiros com marcação emocional: ver memória project_eduzzy_kit_aula.
# ⚠️ Com os áudios na corrente, INCLUDE_IMAGES=False deixaria dor/fechamento sem
# conteúdo (nó de mídia sem caption sai da corrente) — restaurar textos se usar.
AUDIO = {
    "dor":      f"{MEDIA_BASE}/audio-dor.ogg",      # substitui o texto da dor (t2 vira eco curto)
    "material": f"{MEDIA_BASE}/audio-material.ogg", # explica o acervo (após capa+mockup, antes da prova)
    "fecho":    f"{MEDIA_BASE}/audio-fecho.ogg",    # substitui o fechamento (CTA fica em texto)
}

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

def text(id, x, y, label, message):
    return n(id, "text_message", x, y, {"label": label, "message": message})

def image(id, x, y, label, url, caption=None):
    data = {"label": label, "mediaUrl": url}
    if caption: data["caption"] = caption
    return n(id, "image", x, y, data)

def capture(id, x, y, label, var, timeout=30, extra=None):
    data = {
        "label": label, "variableName": var,
        "timeoutMinutes": timeout, "timeoutBehavior": "suspend",
        "suspendedReason": f"eduzzy_{var}",
        "recoveryHints": ["sim", "quero", "kit", "professora"],
    }
    if extra: data.update(extra)
    return n(id, "capture", x, y, data)

def delay(id, x, y, seconds=3):
    return n(id, "delay", x, y, {"label": "Pausa", "seconds": seconds})

# ── Copy v9 — roteiro problema-primeiro (Kely/Marcio 15/07) ───────────────────
# Estrutura: dor → solução(capa+materiais) → prova → amostra (vídeo+planos+atividades)
# → âncora 47,90→19,90 → "quero resolver" → pix; objeção pós-pix → downsell 14,90
# {{saudacao_nome}} = ", Maria" (1º nome do pushName do WhatsApp) ou vazio →
# "Oi, Maria!" / "Oi!" — o motor garante que nunca sai vírgula órfã nem template cru.
T1_VARIACOES = [
    (
        "Oi{{saudacao_nome}}! Aqui é a Juliana 📚\n\n"
        "Se você joga muitas horas montando plano de aula, atividade e parecer do zero toda "
        "semana, eu quero te mostrar uma forma de resolver isso hoje mesmo.\n\n"
        "Qual a faixa etária da sua turma?\n"
        "1️⃣ 2 a 3 anos\n2️⃣ 3 a 4 anos\n3️⃣ 4 a 5 anos\n4️⃣ 5 a 6 anos"
    ),
    (
        "Oi{{saudacao_nome}}! Juliana aqui, professora 📚\n\n"
        "Quantas horas da sua semana vão embora montando planejamento, atividade e parecer "
        "do zero? Eu te mostro um jeito de resolver isso ainda hoje.\n\n"
        "Me diz a faixa etária da sua turma:\n"
        "1️⃣ 2 a 3 anos\n2️⃣ 3 a 4 anos\n3️⃣ 4 a 5 anos\n4️⃣ 5 a 6 anos"
    ),
    (
        "Olá{{saudacao_nome}}! Sou a Juliana 📚\n\n"
        "Se o seu fim de semana vive indo embora em plano de aula e parecer feito do zero, "
        "isso aqui é pra você — dá pra resolver hoje.\n\n"
        "Qual a faixa etária da sua turma?\n"
        "1️⃣ 2 a 3 anos\n2️⃣ 3 a 4 anos\n3️⃣ 4 a 5 anos\n4️⃣ 5 a 6 anos"
    ),
]
# A dor agora é o ÁUDIO da Juliana (AUDIO["dor"]); o texto vira só o eco da faixa.
T2_ECO = "Perfeito, {{faixa_etaria}} então! 👇"
T3_SOLUCAO = (
    "Existe uma forma de virar esse jogo: em vez de criar cada material do zero, você acessa "
    "um acervo pronto — organizado por faixa etária e por campo de experiência da BNCC — e "
    "só adapta pra sua turma.\n\n"
    "Isso aqui é o que fica disponível pra você 👇"
)
CAP_CAPA = "Reduz o tempo de planejamento de horas pra minutos."
T4_PROVA = (
    ("E não sou só eu que falo isso. Quem já resolveu esse problema com o material conta como foi 👇"
     if HAS_PRINTS else
     "E não sou só eu que falo isso: mais de 13 mil professoras já pararam de perder o fim de "
     "semana com planejamento usando esse acervo.")
)
T5_ASK = (
    "Quer ver como fica na prática? Gravei um vídeo mostrando a amostra real do que você "
    "recebe — atividade lúdica, traçado e modelo de rotina, tudo editável. Me responde *sim* "
    "que eu te mando 👇"
)
CAP_VIDEO = (
    "Olha na prática 🎥 Páginas reais do acervo — atividade lúdica, traçado e modelo de "
    "rotina, tudo pronto pra você só personalizar com o nome da turma e imprimir."
)
T6_PRECO = (
    "Esse acesso completo — planos, atividades, relatórios, rotinas e projetos — normalmente "
    "fica disponível por R$ 47,90.\n\n"
    "Mas hoje, pra quem chegou até aqui na conversa, consigo liberar seu acesso por *R$ 19,90*, "
    "com *garantia incondicional de 30 dias*: se não servir pra sua rotina, devolvemos cada "
    "centavo. Risco zero pra você.\n\n"
    "Isso não é questão de \"vale a pena\" — é menos que o valor de um lanche, por um problema "
    "que te consome toda semana."
)
# O fechamento agora é o ÁUDIO (AUDIO["fecho"]); o CTA fica em texto — é ele que
# a professora copia/responde e o validationRegex do c_fecho valida.
T7_CTA = "Me diz *quero resolver* que eu já libero seu acesso ⤵️"
T_PIX_AFTER = (
    "Fechado! 🎉 Vou te passar o Pix de *R$ 19,90* aqui embaixo — assim que pagar, me envia "
    "o *print do comprovante* nesta conversa que eu já libero seu acesso 🥰"
)
# Downsell: objeção de preço/agenda pós-pix → oferta final R$ 14,90 imediata
T_DOWNSELL = (
    "Entendo perfeitamente, professora 💙 Então deixa eu fazer uma coisa que eu não faço "
    "sempre: consigo baixar pra *R$ 14,90* agora, só nessa conversa — com a mesma *garantia "
    "de 30 dias*.\n\n"
    "Vou te mandar o Pix aqui embaixo. Quando pagar, me envia o *print do comprovante* que "
    "eu libero seu acesso na hora ⤵️"
)
T_REJ = (
    "Hmm, não consegui confirmar esse comprovante 🤔\n\n"
    "Confere se o Pix foi pra chave *equipenotadez@jim.com* e me envia o *print* de novo, por favor?"
)
T_CONFIRMED = "Pagamento confirmado! 🎉"
T_POST = (
    "Aqui está seu *Kit Aula Pronta Infantil* 🎁\n\n"
    "Vou te enviar os materiais agora — salva tudo no seu celular ou notebook!"
)
T_DELIVERED = (
    "Prontinho, professora! 🥰 Seu kit completo está aí — e os *bônus surpresa* já estão "
    "inclusos nos materiais que você acabou de receber.\n\n"
    "Qualquer dúvida, me chama. Boas aulas — e bons domingos! 💙"
)

# Remarketing suave (problema-primeiro, sem cara de carrinho abandonado)
RM_SOFT = (
    "Oi, professora! Passando rapidinho só pra saber: você conseguiu organizar o "
    "planejamento dessa semana? 😊\n\n"
    "Se ainda tiver enrolado com isso, é só me avisar que eu te mostro de novo o jeito "
    "mais simples que eu te falei."
)
RM_REOFFER = (
    "Que bom te ver por aqui de novo! 😊\n\n"
    "Ainda consigo garantir pra você a condição que te mostrei: *R$ 19,90* pelo acesso "
    "completo, com garantia de 30 dias. Vou te mandar o Pix aqui embaixo 👇"
)

# Legendas das imagens de produto (bloco solução + bloco amostra)
CAP_MATERIAIS = "São mais de 1.000 materiais prontos e editáveis, tudo organizado 🤩"
CAP_PLANOS = "Planos de aula alinhados à BNCC, prontinhos pra preencher 📋"
CAP_ATIVIDADES = "Atividades práticas: é só imprimir e aplicar com a turminha ✂️"

# ── Graph v9 ──────────────────────────────────────────────────────────────────
Y = [50 + i * 150 for i in range(30)]
FAIXA_EXTRA = {
    "validationRegex": "[1-6]|anos|tod",
    "valueMap": {"1": "2 a 3 anos", "2": "3 a 4 anos", "3": "4 a 5 anos", "4": "5 a 6 anos", "todas": "todas as faixas"},
    "errorMessage": ("Só preciso da faixa da sua turminha 😊 Responda *1*, *2*, *3* ou *4*:\n"
                     "1️⃣ 2 a 3 anos\n2️⃣ 3 a 4 anos\n3️⃣ 4 a 5 anos\n4️⃣ 5 a 6 anos"),
}
FECHO_EXTRA = {
    "validationRegex": "resolver|quero|sim|ok|okay|claro|bora|vamos|pode|fech|aceito|libera|👍",
    "errorMessage": ("Ótima pergunta! 😊 Se ficar qualquer dúvida, nossa equipe te responde por aqui.\n\n"
                     "Enquanto isso, me confirma: quer resolver isso hoje? Me diz *quero resolver* "
                     "que eu já libero seu acesso ⤵️"),
}

nodes = [
    n("trigger", "trigger", 100, Y[0], {"label": "Início (qualquer mensagem)", "triggerType": "any_message"}),
    n("cond_img", "condition", 400, Y[1], {"label": "1ª msg é imagem?", "variable": "__imageBase64", "operator": "regex", "value": ".+"}),
    n("cond_buyer", "condition", 700, Y[1], {"label": "Já chegou no Pix?", "variable": "__lead_tags", "operator": "contains", "value": "eduzzy-checkout"}),
    n("ho_late", "handoff_request", 700, Y[2], {
        "label": "Comprovante atrasado", "reason": "pix_failed", "notifyOwner": True,
        "userMessage": "Recebi! 🙏 Vou confirmar seu pagamento com a equipe e já te retorno por aqui, professora 😊"}),
    n("tag_entry", "tag_lead", 100, Y[1], {"label": "Tag eduzzy", "add": ["eduzzy", "kit-aula-pronta"]}),

    # E1 — problema + qualificação (faixa direto, sem imagem)
    n("t1", "distributor", 100, Y[2], {"label": "Abertura problema (3 variações)", "variations": T1_VARIACOES}),
    capture("c_faixa", 100, Y[3], "Aguardar faixa", "faixa_etaria", timeout=20, extra=FAIXA_EXTRA),

    # E2-E5 — eco + ÁUDIO da dor → solução (capa + materiais) → prova → convite da amostra
    text("t2", 100, Y[4], "Eco da faixa", T2_ECO),
    n("audio_dor", "image", 250, Y[4], {
        "label": "Áudio: a dor", "mediaUrl": AUDIO["dor"], "mediaType": "audio"}),
    text("t3", 100, Y[5], "Solução", T3_SOLUCAO),
    image("img_capa", 100, Y[6], "Capa do kit", IMG["capa"], caption=CAP_CAPA),
    image("img_materiais", 250, Y[6], "Mockup 1.000 materiais", IMG["materiais"], caption=CAP_MATERIAIS),
    n("audio_material", "image", 400, Y[6], {
        "label": "Áudio: explicando o material", "mediaUrl": AUDIO["material"], "mediaType": "audio"}),
    text("t4", 100, Y[7], "Prova social", T4_PROVA),
] + ([image("img_print1", 250, Y[7], "Depoimento real", IMG["print1"])] if HAS_PRINTS else []) + [
    text("t5", 100, Y[8], "Convite amostra", T5_ASK),
    capture("c_amostra", 100, Y[9], "Aguardar sim amostra", "quer_amostra", timeout=20),

    # E5 — amostra completa: VÍDEO + imagens de produto (planos BNCC + atividades)
    n("video_amostra", "image", 100, Y[10], {
        "label": "Amostra em vídeo", "mediaUrl": IMG["amostra_video"],
        "mediaType": "video", "caption": CAP_VIDEO}),
    image("img_planos", 250, Y[10], "Plano de aula BNCC", IMG["planos"], caption=CAP_PLANOS),
    image("img_atividades", 400, Y[10], "Atividades práticas", IMG["atividades"], caption=CAP_ATIVIDADES),

    # E6-E7 — âncora 47,90→19,90 + ÁUDIO do fechamento + CTA escrito
    text("t6", 100, Y[11], "Âncora 47,90→19,90", T6_PRECO),
    n("audio_fecho", "image", 100, Y[12], {
        "label": "Áudio: fechamento 19,90", "mediaUrl": AUDIO["fecho"], "mediaType": "audio"}),
    text("t7_cta", 250, Y[12], "CTA quero resolver", T7_CTA),
    capture("c_fecho", 100, Y[13], "Aguardar quero resolver", "eu_quero", timeout=20, extra=FECHO_EXTRA),

    # Pix 19,90 + comprovante (mesma espinha validada)
    n("pix_main", "pix", 100, Y[14], {
        "label": "Pix R$19,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "19,90", "description": "Kit Aula Pronta Infantil — condição especial",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId"}),
    text("t_pix_after", 100, Y[15], "Pedir comprovante", T_PIX_AFTER),
    n("tag_checkout", "tag_lead", 100, Y[16], {"label": "Tag chegou no pix", "add": ["eduzzy-checkout"]}),
    capture("c5", 100, Y[17], "Aguardar comprovante", "pos_checkout", timeout=180),
    n("classify_pos", "classify_intent", 250, Y[17], {
        "label": "Triagem pós-pix", "intents": [
            {"handle": "objection", "label": "Objeção/agenda",
             "patterns": ["não tenho", "nao tenho", "tá caro", "ta caro", "muito caro", "sem dinheiro",
                          "só tenho", "so tenho", "mais barato", "desconto", "não posso", "nao posso",
                          "depois eu", "mês que vem", "mes que vem", "quando receber", "semana que vem"]},
            {"handle": "validate", "label": "Comprovante/resto", "isDefault": True}]}),
    text("t_downsell", 400, Y[17], "Downsell 14,90", T_DOWNSELL),
    n("pix_down", "pix", 550, Y[17], {
        "label": "Pix downsell R$14,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "14,90", "description": "Kit Aula Pronta Infantil — oferta final",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId"}),
    n("v1", "ai_validate_receipt", 100, Y[18], {"label": "Validar comprovante", "paymentIntentVariable": "paymentIntentId"}),
    n("pc", "payment_confirmed", 250, Y[18], {"label": "Pagto confirmado", "confirmationMessage": T_CONFIRMED, "postPurchaseMessage": T_POST}),
    n("label_pago", "label", 400, Y[18], {"label": "Etiqueta Pago", "labelName": "Pago", "labelId": "4"}),
    text("t_rej", 550, Y[18], "Comprovante rejeitado", T_REJ),
    capture("c6", 700, Y[18], "Reenviar comprovante", "comprovante_retry", timeout=60),
    n("v2", "ai_validate_receipt", 850, Y[18], {"label": "Validar 2ª", "paymentIntentVariable": "paymentIntentId"}),
    n("ho", "handoff_request", 1000, Y[18], {
        "label": "Handoff comprovante", "reason": "pix_failed", "notifyOwner": True,
        "userMessage": "Vou pedir pra equipe confirmar seu pagamento manualmente — já te retorno por aqui! 😊"}),
    n("end", "end", 100, Y[19], {"label": "Fim"}),

    # ── Entrega (inalterada) ─────────────────────────────────────────────
] + [
    n(f"doc{i:02d}", "image", 1300, 50 + i * 120, {
        "label": f"Kit {i:02d}", "mediaType": "document",
        "mediaUrl": f"{MEDIA_BASE}/kit/{f}", "filename": f.replace("-", " ").replace(".pdf", "") + ".pdf",
    }) for i, f in enumerate(KIT_FILES, 1)
] + [
    text("t_delivered", 1300, 50 + 17 * 120, "Entrega concluída", T_DELIVERED),

    # ── Remarketing suave (problema-primeiro, 3h; reoferta só no fechamento) ──
    text("rm_s1", 400, Y[3], "RM suave faixa", RM_SOFT),
    capture("c_faixa_r", 400, Y[4], "RM faixa retorno", "rm_faixa", timeout=720),
    text("rm_s2", 400, Y[9], "RM suave amostra", RM_SOFT),
    capture("c_am_r", 400, Y[10], "RM amostra retorno", "rm_amostra", timeout=720),
    text("rm_s3", 400, Y[13], "RM suave fechamento", RM_SOFT),
    capture("c_f_r", 400, Y[14], "RM fechamento retorno", "rm_fechamento", timeout=720),
    text("t_reoffer", 550, Y[14], "Reoferta 19,90", RM_REOFFER),
    text("rm_s4", 400, Y[16], "RM suave pós-pix", RM_SOFT),
    capture("c5_r", 550, Y[16], "RM pós-pix retorno", "rm_pospix", timeout=720),
]

chain = [
    "tag_entry", "t1", "c_faixa", "t2", "audio_dor", "t3", "img_capa", "img_materiais", "audio_material", "t4",
] + (["img_print1"] if HAS_PRINTS else []) + [
    "t5", "c_amostra", "video_amostra", "img_planos", "img_atividades",
    "t6", "audio_fecho", "t7_cta", "c_fecho", "t_pix_after", "pix_main", "tag_checkout", "c5",
]

if not INCLUDE_IMAGES:
    # Sem imagens: legenda vira mensagem de texto; imagem sem legenda sai da corrente.
    by_id = {node["id"]: node for node in nodes}
    kept = []
    for nid in chain:
        node = by_id[nid]
        if node["type"] != "image":
            kept.append(nid)
        elif node["data"].get("caption"):
            node["type"] = "text_message"
            msg = node["data"]["caption"].removesuffix(" ⤵️")
            node["data"] = {"label": node["data"]["label"], "message": msg}
            kept.append(nid)
    nodes = [node for node in nodes if node["id"] in kept or node["id"] not in chain]
    chain = kept

edges = [e(chain[i], chain[i + 1]) for i in range(len(chain) - 1)]

# ── Edges: guardas, remarketing suave, comprovante, entrega ──────────────────
edges += [
    # guarda de comprovante atrasado
    e("trigger", "cond_img"),
    e("cond_img", "cond_buyer", "true"), e("cond_img", "tag_entry", "false"),
    e("cond_buyer", "ho_late", "true"), e("cond_buyer", "tag_entry", "false"),
    e("ho_late", "end", "output"),
    # remarketing suave: 1 toque problema-primeiro; retorno continua de onde parou
    e("c_faixa", "rm_s1", "timeout"), e("rm_s1", "c_faixa_r"),
    e("c_faixa_r", "t2"), e("c_faixa_r", "end", "timeout"),
    e("c_amostra", "rm_s2", "timeout"), e("rm_s2", "c_am_r"),
    e("c_am_r", "video_amostra"), e("c_am_r", "end", "timeout"),
    e("c_fecho", "rm_s3", "timeout"), e("rm_s3", "c_f_r"),
    e("c_f_r", "t_reoffer"), e("t_reoffer", "pix_main"), e("c_f_r", "end", "timeout"),
    # pós-pix: triagem (objeção de preço/agenda → downsell 14,90 imediato; resto valida)
    e("c5", "classify_pos"),
    e("classify_pos", "t_downsell", "objection"), e("t_downsell", "pix_down"), e("pix_down", "c5"),
    e("classify_pos", "v1", "validate"),
    e("c5", "rm_s4", "timeout"), e("rm_s4", "c5_r"),
    e("c5_r", "classify_pos"), e("c5_r", "end", "timeout"),
    # comprovante
    e("v1", "pc", "approved"), e("v1", "t_rej", "rejected"),
    e("t_rej", "c6"), e("c6", "v2"), e("c6", "end", "timeout"),
    e("v2", "pc", "approved"), e("v2", "ho", "rejected"),
    # entrega
    e("pc", "label_pago"), e("label_pago", "doc01"),
]
edges += [e(f"doc{i:02d}", f"doc{i+1:02d}") for i in range(1, len(KIT_FILES))]
edges += [e(f"doc{len(KIT_FILES):02d}", "t_delivered"), e("t_delivered", "end")]

# ── Create (não ativa — DramaHub segue como flow default) ─────────────────────
existing = requests.get(f"{BASE}/api/flows/bot/{BOT_ID}", headers=H).json()
dup = next((f for f in existing if f["name"] == FLOW_NAME), None)
if dup:
    r = requests.put(f"{BASE}/api/flows/{dup['id']}", headers=H,
                     json={"name": FLOW_NAME, "nodes": nodes, "edges": edges})
    print(f"♻️  Flow atualizado: {dup['id']}" if r.ok else f"❌ Update falhou: {r.text}")
else:
    r = requests.post(f"{BASE}/api/flows/bot/{BOT_ID}", headers=H,
                      json={"name": FLOW_NAME, "nodes": nodes, "edges": edges})
    if not r.ok:
        print("❌ Create falhou:", r.text); sys.exit(1)
    print(f"✅ Flow criado: {r.json().get('id')}")

print(f"""
Próximos passos:
  1. Pix: equipenotadez@jim.com (R$19,90, âncora R$47,90, downsell R$14,90 na objeção) — comprovante validado por IA.
  2. Quando tiver prints REAIS de depoimento: suba 05..08-printN.jpg, HAS_PRINTS=True e rode de novo.
  3. Anúncio click-to-WhatsApp com texto pré-preenchido contendo: {KEYWORDS[0]!r}
     Ex.: "Oi! Quero saber mais sobre o Kit Aula Pronta 💙"
  4. NÃO ativar este flow como default — o roteamento por keyword cuida da entrada.
""")
