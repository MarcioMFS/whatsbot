#!/usr/bin/env python3
"""
Eduzzy — Kit Aula Pronta Infantil (funil roteirizado, estilo Typebot)

Roda no MESMO número do bot Doramas Online: o flow entra com trigger 'keyword'
(mensagem pré-preenchida do anúncio) e o roteamento por keyword do
FlowExecutionService o seleciona em conversas novas. Todo o resto do tráfego
continua caindo no flow default (DramaHub, any_message).

O flow é criado INATIVO (não mexe no active_flow_id do bot).

ANTES DE RODAR, preencha:
  - CHECKOUT_URL: link do checkout (será Asaas, mesma conta do DramaHub Play)
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

# TODO: trocar pelo checkout Asaas (mesma conta do DramaHub Play) quando existir
CHECKOUT_URL = "https://SEU-CHECKOUT-AQUI.com.br"

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

def capture(id, x, y, label, var):
    return n(id, "capture", x, y, {
        "label": label, "variableName": var,
        "timeoutMinutes": 60, "timeoutBehavior": "suspend",
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
    "Tudo isso por apenas uma *TAXA ÚNICA* de ~R$ 97~ … MAS CALMA! ✋✋✋\n\n"
    "Hoje sai por apenas *R$ 27*!"
)
T19 = (
    "*HOJE, APENAS HOJE*, estamos com um *CUPOM DE DESCONTO* disponível para as primeiras "
    "30 professoras que comprarem!\n\n"
    "Toque no link abaixo para verificar se o cupom ainda está ativo e finalizar seu "
    "cadastro em nosso site!\n\n"
    "Estamos com uma condição especial para as primeiras 30 professoras que estão dispostas "
    "a melhorar o desempenho dos alunos!"
)
T20 = "⤵️ Segue as informações abaixo para garantir a condição especial — com garantia incondicional de 30 dias!"

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
    text("t18", 100, Y[21], "Preço R$97→R$27", T18),
    image("img_cupom", 100, Y[22], "Imagem cupom", IMG["cupom"]),
    text("t19", 100, Y[23], "Cupom hoje", T19),
    text("t20", 100, Y[24], "Garantir condição", T20),
    text("t_link", 100, Y[25], "Link checkout", CHECKOUT_URL),
    n("tag_checkout", "tag_lead", 100, Y[26], {"label": "Tag chegou no checkout", "add": ["eduzzy-checkout"]}),
    n("end", "end", 100, Y[27], {"label": "Fim"}),
]

chain = [
    "trigger", "tag_entry", "t1", "c1", "t2", "img_hero", "d1", "t3", "c2",
    "t4", "img_materiais", "t6", "t7", "c3", "img_planos", "img_atividades",
    "t9", "t11", "img_garantia", "t16", "c4", "t18", "img_cupom", "t19",
    "t20", "t_link", "tag_checkout", "end",
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
    nodes = [node for node in nodes if node["id"] in kept]
    chain = kept

edges = [e(chain[i], chain[i + 1]) for i in range(len(chain) - 1)]

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
  1. Troque CHECKOUT_URL pelo checkout Asaas (conta DramaHub Play) e rode de novo.
  2. Quando tiver prints REAIS de depoimento: suba 05..08-printN.jpg, HAS_PRINTS=True e rode de novo.
  3. Anúncio click-to-WhatsApp com texto pré-preenchido contendo: {KEYWORDS[0]!r}
     Ex.: "Oi! Quero saber mais sobre o Kit Aula Pronta 💙"
  4. NÃO ativar este flow como default — o roteamento por keyword cuida da entrada.
""")
