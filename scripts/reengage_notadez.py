#!/usr/bin/env python3
"""
Reengajamento espaçado — Nota Dez (site-01).

Alvo: leads do bot que perderam a conversa (limpeza de 2026-07-14), sem tag buyer,
sem conversa ativa no Redis. Envia 1 mensagem de reengajamento com texto variado,
espaçada 3-6 min (jitter), pelo evolution-go. A resposta do lead reinicia o funil
naturalmente (trigger any_message).

Seguranças:
- pula LIDs (números >13 dígitos — envio direto falha) e números fora do 55
- pula telefones do time (alertPhone e ownerPhone do bot)
- estado em .reengage-state.json → nunca envia 2× pro mesmo lead
- 2 falhas de envio consecutivas → aborta (saúde do número acima de tudo)
- resumo final no WhatsApp do alertPhone
"""
import json, random, subprocess, time
from datetime import datetime
from pathlib import Path
from urllib import request as urlreq

BOT_ID = "fe994a71-a0b1-433e-992b-a584cec8a839"
INSTANCE = "site-01"
EVO = "http://localhost:8082"
STATE = Path("/root/work/whatsbot/.reengage-state.json")
LOG = Path("/root/work/whatsbot/reengage-notadez.log")
CONFIG = json.loads(Path("/root/work/whatsbot/.watchdog-config.json").read_text())
SKIP_PHONES = {CONFIG["alertPhone"], CONFIG.get("ownerPhone", "558193491607")}

MENSAGENS = [
    ("Oi, professora! Juliana aqui, da equipe Nota Dez 📚\n\n"
     "Tivemos uma instabilidade no nosso WhatsApp e algumas conversas se perderam — me desculpa!\n\n"
     "Ainda quer conhecer o Kit Aula Pronta Infantil? Responde *sim* que eu te mostro ⤵️"),
    ("Professora, aqui é a Juliana, da Nota Dez 📚\n\n"
     "Nosso WhatsApp deu uma engasgada mais cedo e sua conversa se perdeu no meio — foi mal!\n\n"
     "Se ainda tiver interesse nos materiais prontos e editáveis, me responde um *sim* que a gente continua"),
    ("Oi! Juliana, da equipe Nota Dez 📚\n\n"
     "Vi que a nossa conversa caiu no meio por um problema aqui do nosso lado — desculpa por isso!\n\n"
     "Quer retomar de onde paramos? É só responder *sim* ⤵️"),
]


def log(msg: str) -> None:
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def send_text(number: str, text: str) -> bool:
    body = json.dumps({"number": number, "text": text}).encode()
    req = urlreq.Request(f"{EVO}/send/text", data=body, method="POST",
                         headers={"Content-Type": "application/json", "apikey": INSTANCE})
    try:
        with urlreq.urlopen(req, timeout=30) as r:
            return 200 <= r.status < 300
    except Exception as e:
        log(f"  falha: {e}")
        return False


def leads_alvo() -> list:
    sql = (f"SELECT phone_number, tags FROM leads WHERE bot_id='{BOT_ID}' "
           f"ORDER BY last_seen_at DESC;")
    r = subprocess.run(["docker", "exec", "-i", "whatsbot-postgres-1", "psql",
                        "-U", "whatsbot", "-d", "whatsbot", "-t", "-A", "-F", "|"],
                       input=sql, capture_output=True, text=True)
    alvo = []
    for line in r.stdout.strip().splitlines():
        if "|" not in line:
            continue
        phone, tags = line.split("|", 1)
        phone = phone.strip()
        if phone in SKIP_PHONES: continue
        if "buyer" in tags or "blocked" in tags: continue
        if not phone.startswith("55") or len(phone) > 13: continue  # LID / estrangeiro
        conv = subprocess.run(["redis-cli", "-p", "6381", "EXISTS",
                               f"conv:active:{BOT_ID}:{phone}"], capture_output=True, text=True)
        if conv.stdout.strip() == "1": continue  # já tem conversa rolando
        alvo.append(phone)
    return alvo


def main() -> None:
    state = json.loads(STATE.read_text()) if STATE.exists() else {"sent": []}
    alvo = [p for p in leads_alvo() if p not in state["sent"]]
    log(f"reengajamento: {len(alvo)} leads na fila")

    falhas_seguidas = 0
    enviados = 0
    for i, phone in enumerate(alvo):
        texto = MENSAGENS[i % len(MENSAGENS)]
        ok = send_text(phone, texto)
        if ok:
            enviados += 1
            falhas_seguidas = 0
            state["sent"].append(phone)
            STATE.write_text(json.dumps(state))
            log(f"enviado {phone} ({enviados}/{len(alvo)})")
        else:
            falhas_seguidas += 1
            log(f"falhou {phone} (seguidas: {falhas_seguidas})")
            if falhas_seguidas >= 2:
                log("2 falhas seguidas — abortando (saúde do número)")
                break
        if i < len(alvo) - 1:
            espera = random.uniform(180, 360)  # 3-6 min
            time.sleep(espera)

    resumo = f"Reengajamento Nota Dez: {enviados}/{len(alvo)} enviados"
    log(resumo)
    send_text(CONFIG["alertPhone"], f"🤖 {resumo}. Respostas caem no funil normalmente.")


if __name__ == "__main__":
    main()
