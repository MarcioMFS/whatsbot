#!/usr/bin/env python3
"""
Ritual OBRIGATÓRIO de deploy do funil Nota Dez (e modelo pros próximos funis):

  1. Gera o flow a partir de create_eduzzy_kit_aula.py (com rede stubada)
  2. Valida invariantes do grafo (edges íntegras, captures com timeout, regex compila)
  3. Escreve o fixture packages/backend/src/tests/fixtures/notadez-flow.json
  4. Roda a suíte E2E (notadez-funnel.e2e.test.ts) contra o flow NOVO
  5. SÓ SE TUDO VERDE → UPDATE no banco (flow ao vivo)

Uso:  python3 scripts/flow_deploy.py            # deploy completo
      python3 scripts/flow_deploy.py --dry-run  # tudo menos o UPDATE

Nunca atualizar o flow no banco por fora deste script.
"""
import json, subprocess, sys, types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOW_ID = "39521ee9-8565-4d7e-91c9-c175f11876a9"
BOT_ID = "fe994a71-a0b1-433e-992b-a584cec8a839"
FIXTURE = ROOT / "packages/backend/src/tests/fixtures/notadez-flow.json"
SUITE = "src/tests/notadez-funnel.e2e.test.ts"
DRY = "--dry-run" in sys.argv


def die(msg: str) -> None:
    print(f"\n❌ DEPLOY ABORTADO: {msg}")
    sys.exit(1)


# ── 1. Gera o flow (script com rede stubada) ─────────────────────────────────
captured = {}


class _Resp:
    def __init__(self, d, c=200):
        self._d, self.status_code, self.ok = d, c, c < 300

    def json(self):
        return self._d

    @property
    def text(self):
        return json.dumps(self._d)


stub = types.ModuleType("requests")
stub.post = lambda url, json=None, headers=None, **kw: (
    _Resp({"token": "stub"}) if url.endswith("/api/auth/login")
    else (captured.__setitem__("payload", json), _Resp({"id": "stub"}))[1]
)
stub.get = lambda url, headers=None, **kw: _Resp([])
stub.put = lambda url, json=None, headers=None, **kw: (captured.__setitem__("payload", json), _Resp({}))[1]
sys.modules["requests"] = stub

exec(compile((ROOT / "scripts/create_eduzzy_kit_aula.py").read_text(), "create_eduzzy_kit_aula.py", "exec"),
     {"__name__": "__main__"})
payload = captured.get("payload") or die("script não gerou payload")
nodes, edges = payload["nodes"], payload["edges"]
print(f"1/5 flow gerado: {len(nodes)} nós, {len(edges)} edges")

# ── 2. Invariantes do grafo ──────────────────────────────────────────────────
import re
ids = {n["id"] for n in nodes}
errs = []
if len(ids) != len(nodes):
    errs.append("ids duplicados")
for ed in edges:
    for k in ("source", "target"):
        if ed[k] not in ids:
            errs.append(f"edge {k} órfão: {ed[k]} ({ed['id']})")
for n in nodes:
    if n["type"] == "capture":
        outs = [e for e in edges if e["source"] == n["id"]]
        if not any(e.get("sourceHandle") != "timeout" for e in outs):
            errs.append(f"{n['id']} sem saída normal")
        if not any(e.get("sourceHandle") == "timeout" for e in outs):
            errs.append(f"{n['id']} sem saída timeout")
        rx = n["data"].get("validationRegex")
        if rx:
            try:
                re.compile(rx, re.I)
            except re.error as e:
                errs.append(f"{n['id']} regex inválida: {e}")
    msg = n["data"].get("message") or ""
    if re.search(r"\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{6,}\b", msg):
        errs.append(f"{n['id']} com CAIXA ALTA (sinal de spam)")
if errs:
    die("invariantes do grafo:\n  - " + "\n  - ".join(errs))
print("2/5 invariantes do grafo ✅")

# ── 3. Fixture ───────────────────────────────────────────────────────────────
FIXTURE.parent.mkdir(parents=True, exist_ok=True)
FIXTURE.write_text(json.dumps(
    {"id": FLOW_ID, "botId": BOT_ID, "name": payload["name"], "isDefault": True,
     "nodes": nodes, "edges": edges}, ensure_ascii=False, indent=1))
print("3/5 fixture atualizado")

# ── 4. Suíte E2E contra o flow novo ──────────────────────────────────────────
r = subprocess.run(["npx", "tsx", "--test", "--test-force-exit", SUITE],
                   cwd=ROOT / "packages/backend", capture_output=True, text=True, timeout=600)
tail = "\n".join((r.stdout or r.stderr).splitlines()[-12:])
if r.returncode != 0:
    print(tail)
    die("suíte E2E vermelha — o flow NÃO subiu. Corrija e rode de novo.")
print("4/5 suíte E2E verde ✅")

# ── 5. UPDATE no banco ───────────────────────────────────────────────────────
if DRY:
    print("5/5 dry-run: banco NÃO alterado")
    sys.exit(0)
sql = (f"UPDATE flows SET name=$n${payload['name']}$n$, nodes=$nj${json.dumps(nodes)}$nj$::jsonb, "
       f"edges=$ej${json.dumps(edges)}$ej$::jsonb, updated_at=now() WHERE id='{FLOW_ID}';")
r = subprocess.run(["docker", "exec", "-i", "whatsbot-postgres-1", "psql", "-U", "whatsbot", "-d", "whatsbot", "-t"],
                   input=sql, capture_output=True, text=True)
out = (r.stdout or r.stderr).strip()
if "UPDATE 1" not in out:
    die(f"UPDATE falhou: {out[:200]}")
print("5/5 flow AO VIVO atualizado ✅ (UPDATE 1)")
