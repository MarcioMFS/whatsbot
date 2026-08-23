#!/usr/bin/env python3
"""
Watchdog do evolution-go — roda via cron a cada 5 min.

Problema conhecido: o container degrada silenciosamente e todo /send/* volta
400/500 (bot mudo em produção), enquanto /instance/all segue 200. Já derrubou
o DramaHub e o Nota Dez.

Probe: envia mensagem-para-si-mesmo (self chat, invisível pra clientes) em cada
instância de venda. 2 rodadas consecutivas com falha → docker restart + alerta
no WhatsApp do Marcio. Cooldown de 30 min entre restarts.
"""
import json, subprocess, time
from datetime import datetime
from pathlib import Path
from urllib import request as urlreq

EVO = "http://localhost:8082"
CONTAINER = "whatsbot-evolution-go-1"
STATE = Path("/root/work/whatsbot/.watchdog-evogo.json")
LOG = Path("/root/work/whatsbot/watchdog-evogo.log")

# Números ficam FORA do repo: /root/work/whatsbot/.watchdog-config.json
#   {"alertPhone": "...", "alertInstance": "site-01",
#    "instances": {"<instância>": "<número próprio (self chat)>"}}
CONFIG = json.loads(Path("/root/work/whatsbot/.watchdog-config.json").read_text())
ALERT_PHONE = CONFIG["alertPhone"]
ALERT_INSTANCE = CONFIG.get("alertInstance", "site-01")
INSTANCES = CONFIG["instances"]

FAILS_TO_RESTART = 2
RESTART_COOLDOWN_S = 30 * 60


def log(msg: str) -> None:
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line)
    with LOG.open("a") as f:
        f.write(line + "\n")


def send_text(instance: str, number: str, text: str, timeout: int = 20) -> bool:
    body = json.dumps({"number": number, "text": text}).encode()
    req = urlreq.Request(f"{EVO}/send/text", data=body, method="POST",
                         headers={"Content-Type": "application/json", "apikey": instance})
    try:
        with urlreq.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception as e:
        log(f"probe {instance}: FALHA ({e})")
        return False


def api_key() -> str:
    """apikey global do evolution — fica no .env, fora do repo."""
    try:
        for line in Path("/root/work/whatsbot/.env").read_text().splitlines():
            line = line.strip()
            if line.startswith("EVOLUTION_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def connected_instances() -> set:
    """Instâncias com sessão ativa AGORA.

    Probe em instância deslogada falha SEMPRE, e reiniciar o container não conserta
    sessão que precisa de QR — só derruba as instâncias que estão de pé. Foi exatamente
    isso que aconteceu em 2026-08-23: a site-01 estava sem sessão, o watchdog entrou em
    loop de restart a cada 5 min (78 num dia) e derrubou uma conexão recém-escaneada.
    """
    try:
        req = urlreq.Request(f"{EVO}/instance/all", headers={"apikey": api_key()})
        with urlreq.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        return {i.get("name") for i in data.get("data", []) if i.get("connected")}
    except Exception as e:
        # Sem saber quem está de pé, o comportamento antigo (testar todas) é o mais seguro:
        # é melhor um restart a mais do que deixar passar degradação real.
        log(f"não deu pra listar instâncias ({e}) — testando todas as configuradas")
        return set(INSTANCES)


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {"fails": 0, "last_restart": 0}


def main() -> None:
    state = load_state()

    # Só testa quem tem sessão. Instância deslogada é problema de QR, não de container:
    # reiniciar não traz ela de volta e ainda derruba as que estão conectadas.
    live = connected_instances()
    targets = {inst: num for inst, num in INSTANCES.items() if inst in live}
    if not targets:
        offline = ", ".join(sorted(INSTANCES)) or "(nenhuma configurada)"
        log(f"nenhuma instância conectada ({offline}) — precisa escanear QR; sem restart")
        state["fails"] = 0
        STATE.write_text(json.dumps(state))
        return

    # texto do probe varia por execução (self-message idêntica em loop é sinal robótico)
    probe_text = f"ok {datetime.now():%H:%M}"
    ok = all(send_text(inst, self_num, probe_text) for inst, self_num in targets.items())
    if ok:
        if state["fails"]:
            log(f"recuperado sem restart (fails era {state['fails']})")
        state["fails"] = 0
        STATE.write_text(json.dumps(state))
        return

    state["fails"] += 1
    log(f"probe falhou — strike {state['fails']}/{FAILS_TO_RESTART}")

    if state["fails"] >= FAILS_TO_RESTART:
        since_restart = time.time() - state["last_restart"]
        if since_restart < RESTART_COOLDOWN_S:
            log(f"em cooldown ({int(since_restart)}s desde o último restart) — sem ação")
        else:
            log(f"reiniciando {CONTAINER}…")
            subprocess.run(["docker", "restart", CONTAINER], capture_output=True)
            state["last_restart"] = time.time()
            state["fails"] = 0
            time.sleep(20)
            recovered = all(send_text(i, n, f"ok {datetime.now():%H:%M}") for i, n in targets.items())
            status = "✅ envios voltaram" if recovered else "❌ AINDA MUDO — olhar manualmente!"
            log(f"pós-restart: {status}")
            send_text(ALERT_INSTANCE, ALERT_PHONE,
                      f"🤖 Watchdog: evolution-go degradou (envios 400) e foi reiniciado.\n{status}")

    STATE.write_text(json.dumps(state))


if __name__ == "__main__":
    main()
