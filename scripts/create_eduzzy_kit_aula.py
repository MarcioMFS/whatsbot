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
import requests, sys

BASE     = "http://localhost:3013"
# Doramas Online Bot (instância site-01, nº 558193976255, runtime=agent).
# O funil entra por keyword e o messageWorker desvia do agente só nessas conversas.
BOT_ID   = "fe994a71-a0b1-433e-992b-a584cec8a839"
EMAIL    = "69kleberlucas@gmail.com"
PASSWORD = "DramaHub@Script29"

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

# ── Copy (enxuto: 12 bolhas, 4 perguntas — validado c/ skill copywriting) ─────
T1 = (
    "Oi! Aqui é a *Juliana, da equipe Nota Dez* 📚\n\n"
    "Você, professora do infantil, está precisando de planinhos de aula, atividades lúdicas, "
    "pareceres descritivos e modelinhos do dia a dia *prontos e editáveis* para sua turminha?\n\n"
    "Responda *SIM* aqui embaixo ⤵️"
)
T2 = (
    "Que bom que cheguei na hora certa! 🥰\n\n"
    "Nos próximos 2 minutinhos, vou te mostrar como ter todos os seus materiais de aula prontos "
    "e editáveis no seu celular ou notebook — sem levar trabalho pra casa e sem perder seus "
    "fins de semana montando do zero. 💆🏻‍♀️"
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
    "Nossa, essa idade deles suga tudo da gente, né? 😅\n\n"
    "Pronto, já registrei! 😍 Seu *Kit Aula Pronta Infantil* virá 100% personalizado:\n\n"
    "✅ Faixa da sua turminha: {{faixa_etaria}}\n"
    "✅ Todos os campos de experiência da *BNCC*\n"
    "✅ *+ de 1 mil materiais* prontos e editáveis, feitos e revisados por professoras referência 💙"
)
T6 = (
    "Com esses materiais, você:\n\n"
    "⏱️ Economiza as madrugadas e fins de semana montando planos de aula\n\n"
    "🧑‍🧑‍🧒 Tem tempo pra sua família e pra você mesma… sem culpa!\n\n"
    "📚 Entrega relatórios que a coordenação aprova de primeira\n\n"
    "🧑‍🏫 Ganha rotinas prontas que equilibram o pedagógico e o cuidado do dia a dia"
)
T7 = (
    "Quer ver uma *amostra* dos materiais que você vai receber?\n\n"
    "Responda *SIM, QUERO VER!* ⬇️"
)
CAP_PLANOS = (
    "Olha a qualidade do que você acessa ainda hoje, pelo celular ou notebook 🥰\n\n"
    "Planos de aula editáveis, organizados por campo de experiência ⤵️"
)
CAP_ATIVIDADES = "Atividades lúdicas e sensoriais prontas pra sua turminha ⤵️"
T9 = (
    "E além disso tudo, você ainda recebe:\n\n"
    "✅ +200 modelos de relatórios descritivos por faixa etária\n"
    "✅ +50 modelos de rotina semanal\n"
    "✅ Fichas de observação e acompanhamento\n"
    "✅ Projetos pedagógicos prontos\n"
    "✅ Materiais para todas as datas comemorativas\n\n"
    "E muito mais!"
)
T11 = (
    "São mais de *13 mil professoras* que já receberam o Kit Aula Pronta Infantil este mês — "
    "com *acesso vitalício* pelo celular ou notebook e suporte no WhatsApp, Instagram e e-mail."
)
CAP_GARANTIA = (
    "E você tem *garantia incondicional de 30 dias*: se comprar e não gostar, basta uma mensagem "
    "que devolvemos seu investimento. Seu risco é zero."
)
T16 = (
    "Resumindo: planejamentos, atividades e provas com gabarito, pareceres descritivos e material "
    "completo de alfabetização — tudo pronto, editável e personalizado pra sua turminha.\n\n"
    "E as 30 primeiras professoras de hoje ganham *3 bônus surpresa*, revelados após o cadastro. 🎁\n\n"
    "Vamos finalizar seu cadastro e nunca mais perder domingo planejando aula? 😀\n\n"
    "Responda *EU QUERO*"
)
T18 = (
    "Tudo isso por apenas uma *TAXA ÚNICA* de ~R$ 47,90~ … MAS CALMA! ✋✋✋\n\n"
    "Hoje sai por apenas *R$ 27,90*!"
)
T19 = (
    "*HOJE, APENAS HOJE*, estamos com um *CUPOM DE DESCONTO* disponível para as primeiras "
    "30 professoras que comprarem!\n\n"
    "Estamos com uma condição especial para as primeiras 30 professoras que estão dispostas "
    "a melhorar o desempenho dos alunos!\n\n"
    "Pra garantir a sua, é só fazer o *Pix de R$ 27,90* na chave abaixo ⤵️"
)
T_PIX_AFTER = (
    "Assim que fizer o Pix, me envia o *print do comprovante* aqui mesmo que eu já libero "
    "seu acesso 🥰\n\n"
    "Lembrando: *garantia incondicional de 30 dias* — risco zero."
)
T_REJ = (
    "Hmm, não consegui confirmar esse comprovante 🤔\n\n"
    "Confere se o Pix foi pra chave *equipenotadez@jim.com* e me envia o *print* de novo, por favor?"
)
T_CONFIRMED = "Pagamento confirmado! 🎉💙"
T_POST = (
    "Aqui está seu *Kit Aula Pronta Infantil* 🎁\n\n"
    "Vou te enviar os materiais agora — salva tudo no seu celular ou notebook!"
)
T_DELIVERED = (
    "Prontinho, professora! 🥰 Esse é só o começo: seus *bônus surpresa* e os demais materiais "
    "chegam ainda hoje por aqui.\n\n"
    "Qualquer dúvida, me chama. Boas aulas — e bons domingos! 💙"
)

# ── Remarketing (régua de recuperação — 30min → 3h → 12h silencioso) ─────────
RM1A = (
    "Professora, ainda está aí? 👀\n\n"
    "Vou ser direta: você *realmente* vai deixar pra depois a organização do seu trabalho?\n\n"
    "Enquanto isso, o planejamento continua comendo suas noites e seus domingos…\n\n"
    "Responda *SIM* que eu te mostro a solução em 2 minutinhos ⏳"
)
RM1B = (
    "Tá bem, professora… vou guardar sua condição especial só até hoje à noite. ⏰\n\n"
    "Depois disso, o acesso com desconto vai pra próxima professora da fila.\n\n"
    "Se quiser retomar, é só responder *SIM* 💙"
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
    "A amostra é grátis e leva 30 segundos. Responda *SIM, QUERO VER!* ⬇️"
)
RM4A = (
    "Professora, você viu *tudo* que vai receber… e parou bem na última etapa. 😳\n\n"
    "Ficou com o pé atrás? Normal. Por isso existe a *garantia incondicional de 30 dias*: "
    "não gostou, devolvemos cada centavo. Risco zero.\n\n"
    "Você realmente vai deixar pra depois a organização do seu trabalho?\n\n"
    "Responda *EU QUERO* e resolve isso hoje ✅"
)
RM4B = (
    "Última mensagem, prometo 🙏\n\n"
    "Amanhã você vai planejar aula do jeito de sempre — ou com *+ de 1 mil materiais prontos* na mão.\n\n"
    "A condição especial de hoje não volta. Responda *EU QUERO* agora."
)
RM5A = (
    "Professora, vi que você chegou até o final e não concluiu… 🥺\n\n"
    "Foi o valor? Então deixa eu fazer algo que não faço sempre.\n\n"
    "Só nesta conversa: de ~R$ 27,90~ por *R$ 17,90* — pra nunca mais perder "
    "seu domingo planejando aula.\n\n"
    "Faz o *Pix de R$ 17,90* na chave abaixo e me manda o comprovante ⤵️"
)
RM5B = (
    "Vou encerrar por aqui, professora 💙\n\n"
    "O *Pix de R$ 17,90* vale só até o fim do dia — a chave está logo acima ⤴️\n\n"
    "Me manda o comprovante que eu libero seu acesso na hora. Boa aula — e bons domingos!"
)

# ── Graph ─────────────────────────────────────────────────────────────────────
Y = [50 + i * 150 for i in range(30)]
nodes = [
    # Bot dedicado à oferta: qualquer mensagem inicia o funil.
    n("trigger", "trigger", 100, Y[0], {
        "label": "Início (qualquer mensagem)",
        "triggerType": "any_message",
    }),
    n("tag_entry", "tag_lead", 100, Y[1], {"label": "Tag eduzzy", "add": ["eduzzy", "kit-aula-pronta"]}),
    text("t1", 100, Y[2], "Abertura Juliana", T1),
    capture("c1", 100, Y[3], "Aguardar SIM", "resposta_inicial"),
    text("t2", 100, Y[4], "Hora certa", T2),
    image("img_hero", 100, Y[5], "Imagem hero", IMG["hero"]),
    delay("d1", 100, Y[6], 3),
    text("t3", 100, Y[7], "Pergunta faixa etária", T3),
    capture("c2", 100, Y[8], "Aguardar faixa", "faixa_etaria"),
    text("t4", 100, Y[9], "Registro + 1 mil materiais", T4),
    image("img_materiais", 100, Y[10], "Imagem materiais", IMG["materiais"]),
    text("t6", 100, Y[11], "Benefícios", T6),
    text("t7", 100, Y[12], "CTA amostra", T7),
    capture("c3", 100, Y[13], "Aguardar quero ver", "quer_amostra"),
    image("img_planos", 100, Y[14], "Planos BNCC", IMG["planos"], caption=CAP_PLANOS),
    image("img_atividades", 100, Y[15], "Atividades lúdicas", IMG["atividades"], caption=CAP_ATIVIDADES),
    text("t9", 100, Y[16], "Lista extras", T9),
    text("t11", 100, Y[17], "Prova social + acesso", T11),
    image("img_garantia", 100, Y[18], "Selo garantia", IMG["garantia"], caption=CAP_GARANTIA),
    text("t16", 100, Y[19], "Recap + CTA final", T16),
    capture("c4", 100, Y[20], "Aguardar EU QUERO", "eu_quero"),
    text("t18", 100, Y[21], "Preço 47,90→27,90", T18),
    image("img_cupom", 100, Y[22], "Imagem cupom", IMG["cupom"]),
    text("t19", 100, Y[23], "Cupom hoje", T19),
    n("pix_main", "pix", 100, Y[24], {
        "label": "Pix R$27,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "27,90", "description": "Kit Aula Pronta Infantil",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId",
    }),
    text("t_pix_after", 100, Y[25], "Pedir comprovante", T_PIX_AFTER),
    n("tag_checkout", "tag_lead", 100, Y[26], {"label": "Tag chegou no pix", "add": ["eduzzy-checkout"]}),
    # espera comprovante; resposta → valida; sumiu 45min → downsell
    capture("c5", 100, Y[27], "Aguardar comprovante", "pos_checkout", timeout=45),
    n("v1", "ai_validate_receipt", 100, Y[28], {"label": "Validar comprovante", "paymentIntentVariable": "paymentIntentId"}),
    n("pc", "payment_confirmed", 250, Y[28], {"label": "Pagto confirmado", "confirmationMessage": T_CONFIRMED, "postPurchaseMessage": T_POST}),
    text("t_rej", 400, Y[28], "Comprovante rejeitado", T_REJ),
    capture("c6", 550, Y[28], "Reenviar comprovante", "comprovante_retry", timeout=60),
    n("v2", "ai_validate_receipt", 700, Y[28], {"label": "Validar 2ª", "paymentIntentVariable": "paymentIntentId"}),
    n("ho", "handoff_request", 850, Y[28], {
        "label": "Handoff comprovante", "reason": "pix_failed", "notifyOwner": True,
        "userMessage": "Vou pedir pra equipe confirmar seu pagamento manualmente — já te retorno por aqui! 😊",
    }),
    n("end", "end", 100, Y[29], {"label": "Fim"}),

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
    text("rm2a", 400, Y[8], "RM faixa 30min", RM2A),
    capture("c2r", 400, Y[9], "RM faixa retry", "rm_faixa", timeout=720),
    # amostra (1 toque)
    text("rm3a", 400, Y[13], "RM amostra 30min", RM3A),
    capture("c3r", 400, Y[14], "RM amostra retry", "rm_amostra", timeout=720),
    # fechamento EU QUERO (2 toques)
    text("rm4a", 400, Y[20], "RM fechamento 30min", RM4A),
    capture("c4r", 400, Y[21], "RM fechamento retry", "rm_fechamento", timeout=180),
    text("rm4b", 400, Y[22], "RM fechamento 3h", RM4B),
    capture("c4r2", 400, Y[23], "RM fechamento última", "rm_fechamento2", timeout=720),
    # downsell pós-link (2 toques)
    n("tag_downsell", "tag_lead", 400, Y[26], {"label": "Tag downsell", "add": ["eduzzy-downsell"]}),
    text("rm5a", 400, Y[27], "Downsell 17,90", RM5A),
    n("pix_ds", "pix", 550, Y[27], {
        "label": "Pix R$17,90", "pixKey": PIX_KEY, "recipientName": PIX_NAME,
        "amount": "17,90", "description": "Kit Aula Pronta Infantil (condição especial)",
        "expiresInMinutes": 120, "outputVariable": "paymentIntentId",
    }),
    capture("c5b", 400, Y[29], "Downsell aguardar comprovante", "rm_downsell", timeout=180),
    text("rm5b", 700, Y[27], "Downsell última", RM5B),
    capture("c5c", 700, Y[28], "Downsell última espera", "rm_downsell2", timeout=720),
]

# corrente principal
chain = [
    "trigger", "tag_entry", "t1", "c1", "t2", "img_hero", "d1", "t3", "c2",
    "t4", "img_materiais", "t6", "t7", "c3", "img_planos", "img_atividades",
    "t9", "t11", "img_garantia", "t16", "c4", "t18", "img_cupom", "t19",
    "pix_main", "t_pix_after", "tag_checkout", "c5",
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
    # começo: c1 → rm1a → c1r(→t2) → rm1b → c1r2(→t2) → end
    e("c1", "rm1a", "timeout"), e("rm1a", "c1r"), e("c1r", "t2"),
    e("c1r", "rm1b", "timeout"), e("rm1b", "c1r2"), e("c1r2", "t2"),
    e("c1r2", "end", "timeout"),
    # faixa: c2 → rm2a → c2r(→t4) → end
    e("c2", "rm2a", "timeout"), e("rm2a", "c2r"), e("c2r", "t4"),
    e("c2r", "end", "timeout"),
    # amostra: c3 → rm3a → c3r(→img_planos) → end
    e("c3", "rm3a", "timeout"), e("rm3a", "c3r"),
    e("c3r", "img_planos" if INCLUDE_IMAGES else "t9"),
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
