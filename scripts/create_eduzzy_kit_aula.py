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
    "hero":      f"{MEDIA_BASE}/01-hero.jpg",
    "materiais": f"{MEDIA_BASE}/02-materiais.jpg",
    "planos":    f"{MEDIA_BASE}/03-planos-bncc.jpg",
    "atividades":f"{MEDIA_BASE}/04-atividades.jpg",
    "print1":    f"{MEDIA_BASE}/05-print1.jpg",  # TODO print real
    "print2":    f"{MEDIA_BASE}/06-print2.jpg",  # TODO print real
    "print3":    f"{MEDIA_BASE}/07-print3.jpg",  # TODO print real
    "print4":    f"{MEDIA_BASE}/08-print4.jpg",  # TODO print real
    "garantia":  f"{MEDIA_BASE}/09-garantia.jpg",
    "cupom":     f"{MEDIA_BASE}/10-cupom.jpg",
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

def capture(id, x, y, label, var, timeout=30):
    return n(id, "capture", x, y, {
        "label": label, "variableName": var,
        "timeoutMinutes": timeout, "timeoutBehavior": "suspend",
        "suspendedReason": f"eduzzy_{var}",
        "recoveryHints": ["sim", "quero", "kit", "professora"],
    })

def delay(id, x, y, seconds=3):
    return n(id, "delay", x, y, {"label": "Pausa", "seconds": seconds})

# ── Copy (anti-spam: máx 3 bolhas por bloco, sem CAIXA ALTA, 1-2 emojis,
# abertura com variações por lead — regras do sales_skills_mining Tier 3) ──────
T1_VARIACOES = [
    (
        "Oi! Aqui é a Juliana, da equipe Nota Dez 📚\n\n"
        "Você, professora do infantil, está precisando de planinhos de aula, atividades lúdicas, "
        "pareceres e modelinhos do dia a dia, prontos e editáveis?\n\n"
        "Responda *sim* que eu te mostro ⤵️"
    ),
    (
        "Oi, professora! Juliana aqui, da equipe Nota Dez 📚\n\n"
        "Cheguei com uma coisa boa: materiais de aula prontos e editáveis pra sua turminha — "
        "planinhos, atividades lúdicas e pareceres descritivos.\n\n"
        "Me responde um *sim* que eu te conto como funciona"
    ),
    (
        "Olá! Sou a Juliana, da equipe Nota Dez 📚\n\n"
        "Se você dá aula pro infantil e vive montando planinho, atividade e parecer do zero, "
        "isso aqui é pra você.\n\n"
        "Responda *sim* e eu te mostro em 2 minutinhos ⤵️"
    ),
]
T2 = (
    "Que bom que cheguei na hora certa! 🥰\n\n"
    "Nos próximos 2 minutinhos, vou te mostrar como ter todos os seus materiais de aula prontos "
    "e editáveis no seu celular ou notebook — sem levar trabalho pra casa e sem perder seus "
    "fins de semana montando do zero."
)
T3 = (
    "Inclusive, qual a idade dos alunos da sua turminha, professora?\n\n"
    "Responda com a faixa:\n"
    "1️⃣ 2 a 3 anos\n"
    "2️⃣ 3 a 4 anos\n"
    "3️⃣ 4 a 5 anos\n"
    "4️⃣ 5 a 6 anos"
)
T4 = (
    "Pronto, já registrei! 😍 Seu *Kit Aula Pronta Infantil* virá 100% personalizado:\n\n"
    "✅ Faixa da sua turminha: {{faixa_etaria}}\n"
    "✅ Todos os campos de experiência da *BNCC*\n"
    "✅ Mais de 1 mil materiais prontos e editáveis, feitos e revisados por professoras referência"
)
T67 = (
    "Com o kit, você economiza as madrugadas e os fins de semana montando aula, entrega "
    "relatórios que a coordenação aprova de primeira — e sobra tempo pra você e sua família 💆🏻‍♀️\n\n"
    "Quer ver uma *amostra* dos materiais? Responda *sim, quero ver* ⬇️"
)
CAP_PLANOS = (
    "Olha a qualidade do que você acessa ainda hoje, pelo celular ou notebook 🥰\n\n"
    "Planos de aula editáveis, organizados por campo de experiência ⤵️"
)
CAP_ATIVIDADES = "Atividades lúdicas e sensoriais prontas pra sua turminha ⤵️"
T16 = (
    "E além dos planos de aula, você recebe: mais de 200 modelos de relatórios descritivos por "
    "faixa etária, 50 rotinas semanais, fichas de observação, projetos pedagógicos e materiais "
    "para as datas comemorativas.\n\n"
    "São mais de 13 mil professoras com o kit — acesso vitalício, suporte no WhatsApp e e-mail, "
    "e *garantia incondicional de 30 dias*: não gostou, devolvemos.\n\n"
    "Vamos garantir o seu e nunca mais perder domingo planejando aula? Responda *eu quero* 😀"
)
T18 = (
    "Tudo isso sairia por ~R$ 47,90~… mas hoje, para as primeiras 30 professoras, o kit completo "
    "sai por *R$ 27,90* — taxa única.\n\n"
    "Pra garantir: faz o Pix na chave que vou te mandar e me envia o *print do comprovante* aqui "
    "mesmo, que eu já libero seu acesso ⤵️"
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

# ── Remarketing (30min → 3h → 12h silencioso) ─────────────────────────────────
RM1A = (
    "Professora, ainda está aí? 👀\n\n"
    "Vou ser direta: você *realmente* vai deixar pra depois a organização do seu trabalho?\n\n"
    "Enquanto isso, o planejamento continua comendo suas noites e seus domingos…\n\n"
    "Responda *sim* que eu te mostro a solução em 2 minutinhos"
)
RM1B = (
    "Tá bem, professora… vou guardar sua condição especial só até hoje à noite.\n\n"
    "Depois disso, o acesso com desconto vai pra próxima professora da fila.\n\n"
    "Se quiser retomar, é só responder *sim* 💙"
)
RM2A = (
    "Professora, faltou só me dizer a idade da sua turminha! 🥺\n\n"
    "É literalmente 1 resposta pra eu montar seu kit personalizado…\n\n"
    "Responda a faixa: 2 a 3, 3 a 4, 4 a 5 ou 5 a 6 anos ⤵️"
)
RM3A = (
    "Posso ser sincera, professora? 😅\n\n"
    "Quem chega até aqui e some geralmente está pensando \"depois eu vejo\"…\n\n"
    "Mas \"depois\" é mais um domingo inteiro montando aula do zero.\n\n"
    "A amostra é grátis e leva 30 segundos. Responda *sim, quero ver* ⬇️"
)
RM4A = (
    "Professora, você viu *tudo* que vai receber… e parou bem na última etapa. 😳\n\n"
    "Ficou com o pé atrás? Normal. Por isso existe a *garantia incondicional de 30 dias*: "
    "não gostou, devolvemos cada centavo. Risco zero.\n\n"
    "Você realmente vai deixar pra depois a organização do seu trabalho?\n\n"
    "Responda *eu quero* e resolve isso hoje"
)
RM4B = (
    "Última mensagem, prometo 🙏\n\n"
    "Amanhã você vai planejar aula do jeito de sempre — ou com mais de 1 mil materiais prontos na mão.\n\n"
    "A condição especial de hoje não volta. Responda *eu quero* agora."
)
RM5A = (
    "Professora, vi que você chegou até o final e não concluiu… 🥺\n\n"
    "Foi o valor? Então deixa eu fazer algo que não faço sempre.\n\n"
    "Só nesta conversa: de ~R$ 27,90~ por *R$ 17,90* — pra nunca mais perder "
    "seu domingo planejando aula.\n\n"
    "Faz o Pix de R$ 17,90 na chave abaixo e me manda o comprovante ⤵️"
)
RM5B = (
    "Vou encerrar por aqui, professora 💙\n\n"
    "O Pix de *R$ 17,90* vale só até o fim do dia — a chave está logo acima ⤴️\n\n"
    "Me manda o comprovante que eu libero seu acesso na hora. Boa aula — e bons domingos!"
)

# ── Graph (blocos de no máx 3 bolhas entre perguntas) ────────────────────────
Y = [50 + i * 150 for i in range(30)]
nodes = [
    # Bot dedicado à oferta: qualquer mensagem inicia o funil.
    n("trigger", "trigger", 100, Y[0], {
        "label": "Início (qualquer mensagem)",
        "triggerType": "any_message",
    }),
    # Guarda: 1ª mensagem é IMAGEM e o lead já tinha chegado no Pix (conversa expirou)
    # → provável comprovante atrasado; confirma com humano em vez de reiniciar o funil.
    n("cond_img", "condition", 400, Y[1], {
        "label": "1ª msg é imagem?", "variable": "__imageBase64", "operator": "regex", "value": ".+",
    }),
    n("cond_buyer", "condition", 700, Y[1], {
        "label": "Já chegou no Pix?", "variable": "__lead_tags", "operator": "contains", "value": "eduzzy-checkout",
    }),
    n("ho_late", "handoff_request", 700, Y[2], {
        "label": "Comprovante atrasado", "reason": "pix_failed", "notifyOwner": True,
        "userMessage": "Recebi! 🙏 Vou confirmar seu pagamento com a equipe e já te retorno por aqui, professora 😊",
    }),
    n("tag_entry", "tag_lead", 100, Y[1], {"label": "Tag eduzzy", "add": ["eduzzy", "kit-aula-pronta"]}),
    # Abertura com variações (anti-blast-idêntico)
    n("t1", "distributor", 100, Y[2], {"label": "Abertura Juliana (3 variações)", "variations": T1_VARIACOES}),
    capture("c1", 100, Y[3], "Aguardar sim", "resposta_inicial"),
    text("t2", 100, Y[4], "Hora certa", T2),
    image("img_hero", 100, Y[5], "Imagem hero", IMG["hero"]),
    text("t3", 100, Y[6], "Pergunta faixa etária", T3),
    # valida a faixa: resposta fora do formato re-pergunta e segura o funil
    n("c2", "capture", 100, Y[7], {
        "label": "Aguardar faixa", "variableName": "faixa_etaria",
        "timeoutMinutes": 30, "timeoutBehavior": "suspend",
        "suspendedReason": "eduzzy_faixa_etaria",
        "validationRegex": "[1-6]|anos|tod",
        "valueMap": {"1": "2 a 3 anos", "2": "3 a 4 anos", "3": "4 a 5 anos", "4": "5 a 6 anos", "todas": "todas as faixas"},
        "errorMessage": "Só preciso da faixa da sua turminha 😊 Responda *1*, *2*, *3* ou *4*:\n1️⃣ 2 a 3 anos\n2️⃣ 3 a 4 anos\n3️⃣ 4 a 5 anos\n4️⃣ 5 a 6 anos",
        "recoveryHints": ["anos", "faixa", "turminha"],
    }),
    text("t4", 100, Y[8], "Registro + 1 mil materiais", T4),
    image("img_materiais", 100, Y[9], "Imagem materiais", IMG["materiais"]),
    text("t6", 100, Y[10], "Benefícios + CTA amostra", T67),
    capture("c3", 100, Y[11], "Aguardar quero ver", "quer_amostra"),
    image("img_planos", 100, Y[12], "Planos BNCC", IMG["planos"], caption=CAP_PLANOS),
    image("img_atividades", 100, Y[13], "Atividades lúdicas", IMG["atividades"], caption=CAP_ATIVIDADES),
    text("t16", 100, Y[14], "Extras + garantia + CTA final", T16),
    capture("c4", 100, Y[15], "Aguardar eu quero", "eu_quero"),
    text("t18", 100, Y[16], "Preço + pedir print", T18),
    n("pix_main", "pix", 100, Y[17], {
        "label": "Pix R$27,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "27,90", "description": "Kit Aula Pronta Infantil",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId",
    }),
    n("tag_checkout", "tag_lead", 100, Y[18], {"label": "Tag chegou no pix", "add": ["eduzzy-checkout"]}),
    # espera comprovante; resposta → valida; sumiu 45min → downsell
    capture("c5", 100, Y[19], "Aguardar comprovante", "pos_checkout", timeout=45),
    n("v1", "ai_validate_receipt", 100, Y[20], {"label": "Validar comprovante", "paymentIntentVariable": "paymentIntentId"}),
    n("pc", "payment_confirmed", 250, Y[20], {"label": "Pagto confirmado", "confirmationMessage": T_CONFIRMED, "postPurchaseMessage": T_POST}),
    text("t_rej", 400, Y[20], "Comprovante rejeitado", T_REJ),
    capture("c6", 550, Y[20], "Reenviar comprovante", "comprovante_retry", timeout=60),
    n("v2", "ai_validate_receipt", 700, Y[20], {"label": "Validar 2ª", "paymentIntentVariable": "paymentIntentId"}),
    n("ho", "handoff_request", 850, Y[20], {
        "label": "Handoff comprovante", "reason": "pix_failed", "notifyOwner": True,
        "userMessage": "Vou pedir pra equipe confirmar seu pagamento manualmente — já te retorno por aqui! 😊",
    }),
    n("end", "end", 100, Y[21], {"label": "Fim"}),

    # ── Entrega do kit (após pagamento confirmado) ──────────────────────
] + [
    n(f"doc{i:02d}", "image", 1000, 50 + i * 120, {
        "label": f"Kit {i:02d}", "mediaType": "document",
        "mediaUrl": f"{MEDIA_BASE}/kit/{f}", "filename": f.replace("-", " ").replace(".pdf", "") + ".pdf",
    }) for i, f in enumerate(KIT_FILES, 1)
] + [
    text("t_delivered", 1000, 50 + 17 * 120, "Entrega concluída", T_DELIVERED),

    # ── Remarketing: começo (2 toques) ──────────────────────────────────
    text("rm1a", 400, Y[3], "RM início 30min", RM1A),
    capture("c1r", 400, Y[4], "RM início retry", "rm_inicio", timeout=180),
    text("rm1b", 400, Y[5], "RM início 3h", RM1B),
    capture("c1r2", 400, Y[6], "RM início última", "rm_inicio2", timeout=720),
    # faixa etária (1 toque)
    text("rm2a", 400, Y[7], "RM faixa 30min", RM2A),
    capture("c2r", 400, Y[8], "RM faixa retry", "rm_faixa", timeout=720),
    # amostra (1 toque)
    text("rm3a", 400, Y[11], "RM amostra 30min", RM3A),
    capture("c3r", 400, Y[12], "RM amostra retry", "rm_amostra", timeout=720),
    # fechamento (2 toques)
    text("rm4a", 400, Y[15], "RM fechamento 30min", RM4A),
    capture("c4r", 400, Y[16], "RM fechamento retry", "rm_fechamento", timeout=180),
    text("rm4b", 400, Y[17], "RM fechamento 3h", RM4B),
    capture("c4r2", 400, Y[18], "RM fechamento última", "rm_fechamento2", timeout=720),
    # downsell pós-pix (2 toques)
    n("tag_downsell", "tag_lead", 400, Y[19], {"label": "Tag downsell", "add": ["eduzzy-downsell"]}),
    text("rm5a", 550, Y[19], "Downsell 17,90", RM5A),
    n("pix_ds", "pix", 700, Y[19], {
        "label": "Pix R$17,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "17,90", "description": "Kit Aula Pronta Infantil (condição especial)",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId",
    }),
    capture("c5b", 550, Y[21], "Downsell aguardar comprovante", "rm_downsell", timeout=180),
    text("rm5b", 700, Y[21], "Downsell última", RM5B),
    capture("c5c", 850, Y[21], "Downsell última espera", "rm_downsell2", timeout=720),
]

# corrente principal
chain = [
    "tag_entry", "t1", "c1", "t2", "img_hero", "t3", "c2",
    "t4", "img_materiais", "t6", "c3", "img_planos", "img_atividades",
    "t16", "c4", "t18", "pix_main", "tag_checkout", "c5",
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

# ── Remarketing edges (saída "timeout" dos captures) ─────────────────────────
edges += [
    # guarda de comprovante atrasado na entrada
    e("trigger", "cond_img"),
    e("cond_img", "cond_buyer", "true"), e("cond_img", "tag_entry", "false"),
    e("cond_buyer", "ho_late", "true"), e("cond_buyer", "tag_entry", "false"),
    e("ho_late", "end", "output"),
    # começo: c1 → rm1a → c1r(→t2) → rm1b → c1r2(→t2) → end
    e("c1", "rm1a", "timeout"), e("rm1a", "c1r"), e("c1r", "t2"),
    e("c1r", "rm1b", "timeout"), e("rm1b", "c1r2"), e("c1r2", "t2"),
    e("c1r2", "end", "timeout"),
    # faixa: c2 → rm2a → c2r(→t4) → end
    e("c2", "rm2a", "timeout"), e("rm2a", "c2r"), e("c2r", "t4"),
    e("c2r", "end", "timeout"),
    # amostra: c3 → rm3a → c3r(→img_planos) → end
    e("c3", "rm3a", "timeout"), e("rm3a", "c3r"),
    e("c3r", "img_planos" if INCLUDE_IMAGES else "t16"),
    e("c3r", "end", "timeout"),
    # fechamento: c4 → rm4a → c4r(→t18) → rm4b → c4r2(→t18) → end
    e("c4", "rm4a", "timeout"), e("rm4a", "c4r"), e("c4r", "t18"),
    e("c4r", "rm4b", "timeout"), e("rm4b", "c4r2"), e("c4r2", "t18"),
    e("c4r2", "end", "timeout"),
    # comprovante: c5 → v1 → approved pc / rejected t_rej → c6 → v2 → pc | handoff
    e("c5", "v1"),
    e("v1", "pc", "approved"), e("v1", "t_rej", "rejected"),
    e("pc", "doc01"),
    e("t_rej", "c6"), e("c6", "v2"), e("c6", "end", "timeout"),
    e("v2", "pc", "approved"), e("v2", "ho", "rejected"), e("ho", "end", "output"),
    # downsell: c5 --45min--> tag → rm5a → pix_ds → c5b(→v1) → rm5b → c5c(→v1) → end
    e("c5", "tag_downsell", "timeout"), e("tag_downsell", "rm5a"),
    e("rm5a", "pix_ds"), e("pix_ds", "c5b"), e("c5b", "v1"),
    e("c5b", "rm5b", "timeout"), e("rm5b", "c5c"), e("c5c", "v1"),
    e("c5c", "end", "timeout"),
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
  1. Pix: equipenotadez@jim.com (R$27,90 / downsell R$17,90) — comprovante validado por IA.
  2. Quando tiver prints REAIS de depoimento: suba 05..08-printN.jpg, HAS_PRINTS=True e rode de novo.
  3. Anúncio click-to-WhatsApp com texto pré-preenchido contendo: {KEYWORDS[0]!r}
     Ex.: "Oi! Quero saber mais sobre o Kit Aula Pronta 💙"
  4. NÃO ativar este flow como default — o roteamento por keyword cuida da entrada.
""")
