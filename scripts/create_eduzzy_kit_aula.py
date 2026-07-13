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

# ── Copy ──────────────────────────────────────────────────────────────────────
T1 = (
    "Oi! Aqui é a *Juliana, da equipe Nota Dez* 📚\n\n"
    "Você, professora do infantil, está precisando de planinhos de aula, atividades lúdicas, "
    "pareceres descritivos e modelinhos do dia a dia *prontos e editáveis* para sua turminha?\n\n"
    "Responda *SIM* aqui embaixo ⤵️"
)
T2 = (
    "Que bom que cheguei na hora certa! 🥰\n\n"
    "Nos próximos 2 minutinhos, vou te mostrar como você pode ter todos os seus materiais de aula "
    "prontos e editáveis, fáceis de encontrar no seu celular ou notebook…\n\n"
    "Sem precisar levar trabalho pra casa, sem perder seus fins de semana montando do zero. 💆🏻‍♀️"
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
    "Nossa, essa idade deles suga tudo da gente, né? 😅😅\n\n"
    "Pronto, já registrei aqui! 😍\n\n"
    "Seu acesso ao *Kit Aula Pronta Infantil* virá 100% personalizado com…\n\n"
    "✅ Faixa da sua turminha: {{faixa_etaria}}\n"
    "✅ Todos os campos de experiência da *BNCC*."
)
T5 = (
    "E o melhor de tudo, professora…\n\n"
    "Serão *+ de 1 mil materiais*, feitos e revisados por professoras referência de suas áreas, "
    "prontos e editáveis para adaptar para os seus alunos! 💙"
)
T6 = (
    "Com esses materiais, você:\n\n"
    "⏱️ Vai economizar horas de madrugadas ou finais de semana montando planos de aula.\n\n"
    "🧑‍🧑‍🧒 Vai ter tempo para sua família e pra você mesma… sem culpa!\n\n"
    "📚 Vai entregar relatórios bem estruturados e detalhados que a coordenação aprova de primeira.\n\n"
    "🧑‍🏫 Rotinas prontas que equilibram o pedagógico e o cuidado do dia a dia."
)
T7 = (
    "Professora, quer ver uma *AMOSTRA* dos materiais presentes dentro do Kit Aula Pronta Infantil "
    "que você irá receber?\n\n"
    "Responda *SIM, QUERO VER!* ⬇️"
)
T8 = (
    "Ótimo!\n\n"
    "Veja a qualidade dos materiais que você terá acesso *AINDA HOJE*, "
    "disponíveis em seu celular ou notebook! 🥰"
)
T9 = (
    "Além disso tudo, você ainda vai receber:\n\n"
    "✅ +200 MODELOS DE RELATÓRIOS DESCRITIVOS POR FAIXA ETÁRIA\n"
    "✅ +50 MODELOS DE ROTINA SEMANAL\n"
    "✅ FICHAS DE OBSERVAÇÃO E ACOMPANHAMENTO\n"
    "✅ PROJETOS PEDAGÓGICOS PRONTOS\n"
    "✅ MATERIAIS PARA TODAS AS DATAS COMEMORATIVAS\n\n"
    "E muito mais!"
)
T10 = (
    "Demais, né, professora? 💖\n\n"
    "Está preparada para ter acesso ao *Kit Aula Pronta Infantil* AGORA e começar a usar seus "
    "materiais de alta qualidade, prontos e editáveis, AINDA HOJE?\n\n"
    "Responda *SIM, ESTOU PREPARADA!*"
)
T11 = (
    "Perfeito!\n\n"
    "Benefícios que você terá com o Kit Aula Pronta Infantil:\n\n"
    "✅ Acesso fácil pelo celular ou notebook\n"
    "✅ Acesso vitalício\n"
    "✅ Suporte no WhatsApp, Instagram e E-mail"
)
T12 = (
    "E, professora, enquanto estamos fazendo os últimos ajustes no seu kit para você acessar…\n\n"
    "Vamos ver o que as professoras que também dão aula para criancinhas de {{faixa_etaria}} "
    "acharam do Kit Aula Pronta Infantil…"
    + ("\n\nVeja os prints autorizados por elas, tirados ainda dessa semana ⤵️" if HAS_PRINTS else "")
)
T13 = (
    (
        "Essas são apenas algumas das mensagens que recebemos todos os dias dos mais de *13 mil professores* "
        "como você que já receberam o Kit Aula Pronta Infantil este mês.\n\n"
        if HAS_PRINTS else
        "São mais de *13 mil professores* como você que já receberam o Kit Aula Pronta Infantil este mês, "
        "e recebemos mensagens de agradecimento todos os dias.\n\n"
    )
    + "Incrível, né, professora? 🥰\n\n"
    "✅ Recebi a informação de que seu *Kit Aula Pronta Infantil está pronto!*\n\n"
    "Vamos lá conhecer seus materiais e aprender como acessar?\n\n"
    "Responda *SIM, VAMOS LÁ!*"
)
T14 = (
    "Antes de te liberar o acesso, deixa eu garantir uma coisa importante…\n\n"
    "Assim que adquirir, iremos enviar o acesso ao Kit Aula Pronta via *WhatsApp e E-mail* "
    "que você irá preencher já já em seu cadastro.\n\n"
    "Além disso tudo, você também tem uma *garantia incondicional de 30 dias*."
)
T15 = (
    "Ou seja, se comprar o Kit Aula Pronta e não gostar (o que nunca aconteceu em nossa história)...\n\n"
    "Basta uma mensagem que devolvemos seu investimento.\n\n"
    "✅ Sem perguntas, sem questionamentos ou ressentimentos.\n\n"
    "Seu risco é literalmente *zero*!"
)
T16 = (
    "Só para relembrar o que VOCÊ vai receber AGORA!\n\n"
    "Acesso completo ao Kit Aula Pronta via WhatsApp e e-mail, com:\n\n"
    "📚 PLANEJAMENTOS DIÁRIOS, SEMANAIS, MENSAIS, BIMESTRAIS E ANUAIS\n\n"
    "📖 ATIVIDADES LÚDICAS E EDITÁVEIS COM GABARITOS\n\n"
    "📄 PROVAS PRONTAS E EDITÁVEIS COM GABARITOS\n\n"
    "✅ MODELOS DE PARECER DESCRITIVO\n\n"
    "✅ FICHA DE ACOMPANHAMENTO\n\n"
    "✅ ATIVIDADES E LEMBRANÇAS PARA DATAS COMEMORATIVAS\n\n"
    "✅ MATERIAL COMPLETO PARA ALFABETIZAÇÃO\n\n"
    "Vamos lá finalizar seu cadastro e nunca mais ter que perder seu domingo planejando aula, professora? 😀\n\n"
    "Responda *EU QUERO*"
)
T17 = (
    "Ótimo!\n\n"
    "🎁 AS 30 PRIMEIRAS PROFESSORAS QUE SE CADASTRAREM HOJE GANHARÃO *3 BÔNUS SURPRESA!*\n\n"
    "Professora, hoje você vai receber:\n\n"
    "✅ Acesso completo ao Kit Aula Pronta para professores!\n"
    "✅ Totalmente personalizado para sua turma e matéria!\n"
    "✅ Bônus surpresa MAIS VALIOSO que o próprio Kit! (revelado após o cadastro)\n"
    "✅ Atualizações gratuitas para SEMPRE!"
)
T18 = "Tudo isso por apenas uma *TAXA ÚNICA* de ~R$ 97~ … MAS CALMA! ✋✋✋"
T19 = (
    "*HOJE, APENAS HOJE*, estamos com um *CUPOM DE DESCONTO* disponível para as primeiras "
    "30 professoras que comprarem!\n\n"
    "Estamos com uma condição especial para as primeiras 30 professoras que estão dispostas "
    "a melhorar o desempenho dos alunos: *R$ 27*, taxa única!"
)
T20 = "⤵️ Segue as informações abaixo para garantir a condição especial e finalizar seu cadastro!"

# ── Graph ─────────────────────────────────────────────────────────────────────
Y = [50 + i * 150 for i in range(40)]
nodes = [
    # Bot dedicado à oferta: qualquer mensagem inicia o funil.
    n("trigger", "trigger", 100, Y[0], {
        "label": "Início (qualquer mensagem)",
        "triggerType": "any_message",
    }),
    n("tag_entry", "tag_lead", 100, Y[1], {"label": "Tag eduzzy", "add": ["eduzzy", "kit-aula-pronta"]}),
    text("t1", 100, Y[2], "Abertura Lúcia", T1),
    capture("c1", 100, Y[3], "Aguardar SIM", "resposta_inicial"),
    text("t2", 100, Y[4], "Hora certa", T2),
    image("img_hero", 100, Y[5], "Imagem hero", IMG["hero"]),
    delay("d1", 100, Y[6], 3),
    text("t3", 100, Y[7], "Pergunta faixa etária", T3),
    capture("c2", 100, Y[8], "Aguardar faixa", "faixa_etaria"),
    text("t4", 100, Y[9], "Registro personalizado", T4),
    text("t5", 100, Y[10], "+1 mil materiais", T5),
    image("img_materiais", 100, Y[11], "Imagem materiais", IMG["materiais"]),
    text("t6", 100, Y[12], "Benefícios", T6),
    text("t7", 100, Y[13], "CTA amostra", T7),
    capture("c3", 100, Y[14], "Aguardar quero ver", "quer_amostra"),
    text("t8", 100, Y[15], "Qualidade hoje", T8),
    image("img_planos", 400, Y[15], "Planos BNCC", IMG["planos"],
          caption="PLANOS DE AULA EDITÁVEIS ORGANIZADOS POR CAMPO DE EXPERIÊNCIA ⤵️"),
    image("img_atividades", 400, Y[16], "Atividades lúdicas", IMG["atividades"],
          caption="ATIVIDADES LÚDICAS E SENSORIAIS PRONTAS PARA SUA TURMINHA ⤵️"),
    text("t9", 100, Y[17], "Lista extras", T9),
    text("t10", 100, Y[18], "CTA preparada", T10),
    capture("c4", 100, Y[19], "Aguardar preparada", "esta_preparada"),
    text("t11", 100, Y[20], "Benefícios acesso", T11),
    text("t12", 100, Y[21], "Prova social intro", T12),
    image("img_p1", 400, Y[21], "Print 1", IMG["print1"]),
    image("img_p2", 400, Y[22], "Print 2", IMG["print2"]),
    image("img_p3", 400, Y[23], "Print 3", IMG["print3"]),
    image("img_p4", 400, Y[24], "Print 4", IMG["print4"]),
    text("t13", 100, Y[25], "Kit pronto + CTA", T13),
    capture("c5", 100, Y[26], "Aguardar vamos lá", "vamos_la"),
    text("t14", 100, Y[27], "Entrega + garantia", T14),
    image("img_garantia", 400, Y[27], "Selo garantia", IMG["garantia"]),
    text("t15", 100, Y[28], "Risco zero", T15),
    text("t16", 100, Y[29], "Recap + CTA final", T16),
    capture("c6", 100, Y[30], "Aguardar EU QUERO", "eu_quero"),
    text("t17", 100, Y[31], "Bônus 30 primeiras", T17),
    text("t18", 100, Y[32], "Preço R$97", T18),
    image("img_cupom", 400, Y[32], "Imagem cupom", IMG["cupom"]),
    text("t19", 100, Y[33], "Cupom hoje R$27", T19),
    text("t20", 100, Y[34], "Garantir condição", T20),
    text("t_link", 100, Y[35], "Link checkout", CHECKOUT_URL),
    n("tag_checkout", "tag_lead", 100, Y[35], {"label": "Tag chegou no checkout", "add": ["eduzzy-checkout"]}),
    n("end", "end", 100, Y[36], {"label": "Fim"}),
]

chain = [
    "trigger", "tag_entry", "t1", "c1", "t2", "img_hero", "d1", "t3", "c2",
    "t4", "t5", "img_materiais", "t6", "t7", "c3", "t8", "img_planos",
    "img_atividades", "t9", "t10", "c4", "t11", "t12", "img_p1", "img_p2",
    "img_p3", "img_p4", "t13", "c5", "t14", "img_garantia", "t15", "t16",
    "c6", "t17", "t18", "img_cupom", "t19", "t20", "t_link", "tag_checkout", "end",
]
if not HAS_PRINTS:
    # Sem prints reais: tira os 4 nós de print da corrente (prova social fica no texto).
    prints = {"img_p1", "img_p2", "img_p3", "img_p4"}
    nodes = [node for node in nodes if node["id"] not in prints]
    chain = [nid for nid in chain if nid not in prints]

if not INCLUDE_IMAGES:
    # Sem imagens ainda: legenda vira mensagem de texto; imagem sem legenda sai da corrente.
    by_id = {node["id"]: node for node in nodes}
    kept = []
    for nid in chain:
        node = by_id[nid]
        if node["type"] != "image":
            kept.append(nid)
        elif node["data"].get("caption"):
            node["type"] = "text_message"
            msg = node["data"]["caption"].removesuffix(" ⤵️")  # seta apontava pra imagem
            node["data"] = {"label": node["data"]["label"], "message": msg}
            kept.append(nid)
    dropped = [node["id"] for node in nodes if node["id"] not in kept and node["type"] == "image"]
    nodes = [node for node in nodes if node["id"] in kept]
    chain = kept
    print(f"🖼️  Sem imagens (INCLUDE_IMAGES=False) — removidos: {', '.join(dropped)}")

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
