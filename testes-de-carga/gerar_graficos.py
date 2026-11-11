"""Gera os graficos do RELATORIO.md a partir dos arquivos *-agregado.json
(saida do analisar.js).

Uso (a partir da pasta testes-de-carga):
    pip install matplotlib
    python gerar_graficos.py                 # usa a medicao 2026-11-09
    python gerar_graficos.py 2026-11-09      # ou informe a data (AAAA-MM-DD)

Entrada : resultados/<data>/login-agregado.json e cadastro-agregado.json
Saida   : graficos/<data>/*.png
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

DATA = sys.argv[1] if len(sys.argv) > 1 else "2026-11-09"
BASE = Path(__file__).parent
ENTRADA = BASE / "resultados" / DATA
SAIDA = BASE / "graficos" / DATA
SAIDA.mkdir(parents=True, exist_ok=True)

SERVICOS = {
    "login": {"titulo": "Login (POST /api/login, leitura)", "cor": "#1f77b4"},
    "cadastro": {"titulo": "Cadastro (POST /api/register, escrita)", "cor": "#d95f02"},
}
COR_P95 = "#c0392b"
LIMITE_P95_MS = 1000  # threshold p(95)<1000 definido nos scripts k6

# Degraus usados nos scripts k6 (STAGES=1,10,50,100): sobe 30s e mantem 1min.
DEGRAUS = [1, 10, 50, 100]


def carregar(nome):
    with open(ENTRADA / f"{nome}-agregado.json", encoding="utf-8") as f:
        return json.load(f)


def sombrear_degraus(ax, rotular=False):
    """Marca no grafico os periodos em que os VUs ficam estaveis (patamares)."""
    t = 30  # o primeiro degrau comeca apos 30s de subida
    for i, vus in enumerate(DEGRAUS):
        ini, fim = t, t + 60
        if i % 2 == 0:
            ax.axvspan(ini, fim, color="#000000", alpha=0.04, lw=0)
        if rotular:
            ax.text((ini + fim) / 2, 1.02, f"{vus} VU{'s' if vus > 1 else ''}",
                    transform=ax.get_xaxis_transform(), ha="center", va="bottom",
                    fontsize=8, color="#555")
        t = fim + 30


def serie(dados, janela, campo):
    # Descarta as janelas finais com 0 VUs: sao so a "cauda" do teste (poucas
    # requisicoes) e fariam a vazao parecer despencar sem motivo real.
    pts = [p for p in dados[f"janela_{janela}s"] if p["vus"] > 0]
    return [p["t_inicio_s"] + janela / 2 for p in pts], [p[campo] for p in pts]


def estilo(ax, ylabel, tempo=False):
    if tempo:
        ax.set_xlim(0, 392)
    ax.set_ylabel(ylabel)
    ax.grid(True, alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)


def salvar(fig, nome):
    caminho = SAIDA / nome
    fig.savefig(caminho, dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("gerado:", caminho.relative_to(BASE))


def grafico_evolucao(nome, dados):
    """3 paineis com o mesmo eixo de tempo: concorrencia, vazao e latencia."""
    cfg = SERVICOS[nome]
    fig, (a1, a2, a3) = plt.subplots(3, 1, figsize=(11, 9.4), sharex=True)
    fig.suptitle(f"{cfg['titulo']} - evolucao durante o teste ({DATA})", y=0.998, fontsize=13)

    # 1) Concorrencia submetida ao longo do tempo
    x, y = serie(dados, 1, "vus")
    a1.fill_between(x, y, step="mid", color="#555", alpha=0.18)
    a1.step(x, y, where="mid", color="#333", lw=1.8)
    estilo(a1, "VUs simultaneos", tempo=True)
    a1.set_ylim(0, 112)
    a1.set_title("Concorrencia submetida ao longo do tempo", loc="left", fontsize=10.5, fontweight="bold")
    sombrear_degraus(a1, rotular=False)
    for ini, vus in zip((30, 120, 210, 300), DEGRAUS):
        a1.text(ini + 30, vus + 4, f"{vus}", ha="center", va="bottom", fontsize=9, fontweight="bold", color="#333")

    # 2) Vazao
    x1, y1 = serie(dados, 1, "req_por_s")
    x10, y10 = serie(dados, 10, "req_por_s")
    a2.plot(x1, y1, color=cfg["cor"], alpha=0.25, lw=0.9, label="janela de 1 s")
    a2.plot(x10, y10, color=cfg["cor"], lw=2, marker="o", ms=3, label="janela de 10 s")
    estilo(a2, "req/s", tempo=True)
    a2.set_ylim(bottom=0)
    a2.set_title("Vazao (requisicoes por segundo)", loc="left", fontsize=10.5, fontweight="bold")
    a2.legend(loc="upper left", frameon=False)
    sombrear_degraus(a2)

    # 3) Latencia
    xm, ym = serie(dados, 5, "latencia_media_ms")
    xp, yp = serie(dados, 5, "latencia_p95_ms")
    a3.plot(xm, ym, color=cfg["cor"], lw=2, marker="o", ms=3, label="media (janela de 5 s)")
    a3.plot(xp, yp, color=COR_P95, lw=1.8, ls="--", marker="s", ms=3, label="p95 (janela de 5 s)")
    estilo(a3, "ms", tempo=True)
    a3.set_xlabel("Tempo desde o inicio do teste (s)")
    a3.set_ylim(bottom=0)
    a3.set_title("Latencia (tempo de resposta)", loc="left", fontsize=10.5, fontweight="bold")
    a3.legend(loc="upper left", frameon=False)
    sombrear_degraus(a3)

    fig.tight_layout()
    salvar(fig, f"{nome}_evolucao.png")

def tabela_por_vus(dados):
    return [l for l in dados["por_vus"] if l["vus"] in DEGRAUS and l["segundos"] > 10]


def grafico_comparacao_vus(d):
    """Latencia e vazao por nivel de concorrencia, os dois servicos lado a lado.
    O eixo X e categorico (1, 10, 50, 100 VUs igualmente espacados)."""
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.8))
    pos = list(range(len(DEGRAUS)))
    for nome, dados in d.items():
        cfg = SERVICOS[nome]
        t = {l["vus"]: l for l in tabela_por_vus(dados)}
        linhas = [t[v] for v in DEGRAUS]
        a1.plot(pos, [l["latencia_media_ms"] for l in linhas], color=cfg["cor"], marker="o", lw=2,
                label=f"{nome} - media")
        a1.plot(pos, [l["latencia_p95_ms"] for l in linhas], color=cfg["cor"], marker="s", lw=1.6,
                ls="--", label=f"{nome} - p95")
        a2.plot(pos, [l["req_por_s"] for l in linhas], color=cfg["cor"], marker="o", lw=2, label=nome)
        for x, l in zip(pos, linhas):
            a2.annotate(f"{l['req_por_s']:.0f}", (x, l["req_por_s"]), textcoords="offset points",
                        xytext=(0, 8), ha="center", fontsize=8, color=cfg["cor"])
    for ax, yl, tit in ((a1, "Latencia (ms)", "Latencia x concorrencia"),
                        (a2, "Vazao (req/s)", "Vazao x concorrencia")):
        ax.set_xticks(pos)
        ax.set_xticklabels([str(v) for v in DEGRAUS])
        ax.set_xlim(-0.3, len(DEGRAUS) - 0.7)
        ax.set_xlabel("Usuarios virtuais simultaneos (VUs)")
        ax.set_title(tit, fontsize=11)
        estilo(ax, yl)
        ax.set_ylim(bottom=0)
        ax.legend(frameon=False, loc="upper left")
    a2.set_ylim(0, 4400)
    fig.tight_layout()
    salvar(fig, "comparacao_por_vus.png")


def grafico_comparacao_tempo(d):
    """Os dois servicos sobrepostos no tempo: concorrencia, vazao e latencia."""
    fig, (a0, a1, a2) = plt.subplots(3, 1, figsize=(11, 9.4), sharex=True)
    fig.suptitle(f"Login x Cadastro - comparacao no tempo ({DATA})", y=0.998, fontsize=13)
    estilos_vus = {"login": dict(lw=3.2, alpha=0.9, ls="-"), "cadastro": dict(lw=1.6, alpha=1, ls=(0, (4, 3)))}
    for nome, dados in d.items():
        cfg = SERVICOS[nome]
        x, y = serie(dados, 1, "vus")
        a0.step(x, y, where="mid", color=cfg["cor"], label=f"{nome}", **estilos_vus[nome])
        x, y = serie(dados, 10, "req_por_s")
        a1.plot(x, y, color=cfg["cor"], lw=2, marker="o", ms=3, label=nome)
        x, y = serie(dados, 10, "latencia_media_ms")
        a2.plot(x, y, color=cfg["cor"], lw=2, marker="o", ms=3, label=f"{nome} - media")
        x, y = serie(dados, 10, "latencia_p95_ms")
        a2.plot(x, y, color=cfg["cor"], lw=1.4, ls="--", alpha=0.8, label=f"{nome} - p95")
    estilo(a0, "VUs simultaneos", tempo=True)
    a0.set_ylim(0, 112)
    a0.set_title("Concorrencia submetida ao longo do tempo (mesmo cenario nos dois testes)",
                 loc="left", fontsize=10.5, fontweight="bold")
    a0.legend(frameon=False, loc="upper left", ncol=2)
    estilo(a1, "req/s", tempo=True)
    a1.set_title("Vazao (janelas de 10 s)", loc="left", fontsize=10.5, fontweight="bold")
    estilo(a2, "ms", tempo=True)
    a2.set_title("Latencia (janelas de 10 s)", loc="left", fontsize=10.5, fontweight="bold")
    a2.set_xlabel("Tempo desde o inicio do teste (s)")
    for ax in (a1, a2):
        ax.set_ylim(bottom=0)
        ax.legend(frameon=False, ncol=2 if ax is a2 else 1, loc="upper left" if ax is a2 else "lower right")
    sombrear_degraus(a0)
    sombrear_degraus(a1)
    sombrear_degraus(a2)
    fig.tight_layout()
    salvar(fig, "comparacao_evolucao.png")

def grafico_resumo(d):
    """Barras com os indicadores globais (p95 contra o limite do SLA)."""
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    nomes = list(d)
    cores = [SERVICOS[n]["cor"] for n in nomes]
    p95 = [d[n]["resumo"]["latencia_p95_ms"] for n in nomes]
    barras = a1.bar(nomes, p95, color=cores, width=0.5)
    a1.axhline(LIMITE_P95_MS, color=COR_P95, ls="--", lw=1.4)
    a1.text(0.5, LIMITE_P95_MS * 0.93, f"limite do SLA: p95 < {LIMITE_P95_MS} ms", ha="center",
            va="top", fontsize=8, color=COR_P95, transform=a1.get_yaxis_transform())
    a1.set_ylim(0, LIMITE_P95_MS * 1.1)
    a1.bar_label(barras, fmt="%.1f ms", padding=3, fontsize=9)
    a1.set_title("Latencia p95 no teste inteiro", fontsize=11)
    estilo(a1, "ms")
    vaz = [d[n]["resumo"]["requisicoes"] / d[n]["duracao_s"] for n in nomes]
    barras = a2.bar(nomes, vaz, color=cores, width=0.5)
    a2.bar_label(barras, fmt="%.0f req/s", padding=3, fontsize=9)
    a2.set_title("Vazao media no teste inteiro", fontsize=11)
    estilo(a2, "req/s")
    a2.set_ylim(0, max(vaz) * 1.15)
    fig.tight_layout()
    salvar(fig, "comparacao_resumo.png")


def grafico_cenario(d):
    """O cenario de concorrencia submetido ao longo do tempo (igual nos dois
    testes), com o resultado medido em cada patamar escrito sobre ele."""
    fig, ax = plt.subplots(figsize=(11.5, 5.6))
    dados = d["login"]  # o perfil de VUs e identico nos dois testes
    x, y = serie(dados, 1, "vus")
    ax.fill_between(x, y, step="mid", color="#555", alpha=0.15)
    ax.step(x, y, where="mid", color="#222", lw=2.2)
    sombrear_degraus(ax)
    por_vus = {n: {l["vus"]: l for l in tabela_por_vus(v)} for n, v in d.items()}

    def br(valor, casas=0):  # formato brasileiro: 1.234,5
        txt = f"{valor:,.{casas}f}"
        return txt.replace(",", "#").replace(".", ",").replace("#", ".")

    for ini, vus in zip((30, 120, 210, 300), DEGRAUS):
        lg, cd = por_vus["login"][vus], por_vus["cadastro"][vus]
        txt = (f"{vus} VU{'s' if vus > 1 else ''}\n"
               f"Login: {br(lg['req_por_s'])} req/s | {br(lg['latencia_media_ms'], 1)} ms\n"
               f"Cadastro: {br(cd['req_por_s'])} req/s | {br(cd['latencia_media_ms'], 1)} ms")
        ax.text(ini + 30, vus + 5, txt, ha="center", va="bottom", fontsize=8,
                bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="#bbb", lw=0.8))
    # nomes das fases de subida/descida, no topo, para nao ficarem sobre a curva
    for t, rot in ((15, "subida 0 -> 1"), (105, "subida 1 -> 10"), (195, "subida 10 -> 50"),
                   (285, "subida 50 -> 100"), (375, "descida 100 -> 0")):
        ax.text(t, 141, rot, ha="center", va="center", fontsize=7.5, color="#777")
    ax.set_xlim(0, 392)
    ax.set_ylim(0, 150)
    ax.set_xlabel("Tempo desde o inicio do teste (s)")
    ax.set_ylabel("Usuarios virtuais simultaneos (VUs)")
    ax.set_title(f"Cenario de concorrencia submetido ao longo do tempo ({DATA})\n"
                 "Mesma rampa nos testes de Login e de Cadastro; sem tempo de espera entre requisicoes",
                 fontsize=11.5)
    ax.grid(True, alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    salvar(fig, "concorrencia_cenario.png")

if __name__ == "__main__":
    dados = {n: carregar(n) for n in SERVICOS}
    for n, v in dados.items():
        grafico_evolucao(n, v)
    grafico_comparacao_vus(dados)
    grafico_cenario(dados)
    grafico_comparacao_tempo(dados)
    grafico_resumo(dados)
