// Reduz o JSON bruto do k6 (pode ter varios GB) a um arquivo pequeno com as
// medicoes agregadas por janela de tempo. Le o arquivo em fluxo (linha a linha),
// entao nao carrega os GB na memoria. Aceita .json e .json.gz.
//
// Uso:
//   node analisar.js resultados/2026-11-09/login.json
//   node analisar.js resultados/2026-11-09/cadastro.json.gz
//
// Gera, ao lado do arquivo de entrada, <nome>-agregado.json (poucos KB) com:
//   - resumo geral (requisicoes, req/s, latencia media e p95, % de erros, VUs maximos)
//   - series por janela de 1s, 5s e 10s (vazao, latencia media, p95, erros, VUs)
//   - tabela por nivel de VUs (concorrencia): em quantos VUs a latencia dispara
//
// Nao precisa instalar nada: so o Node.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const entrada = process.argv[2];
if (!entrada || !fs.existsSync(entrada)) {
  console.error('Uso: node analisar.js <arquivo.json ou arquivo.json.gz>');
  process.exit(1);
}

// Metricas usadas (ha uma de cada por requisicao):
//   http_req_duration = latencia em ms | http_req_failed = 1 se falhou | vus = VUs ativos
const INTERESSA = /"metric":\s*"(http_req_duration|http_req_failed|vus)"/;

// Percentil com interpolacao linear (mesma ideia do p(95) do k6). `v` ja ordenado.
function percentil(v, p) {
  if (v.length === 0) return 0;
  const pos = p * (v.length - 1);
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return v[baixo] + (pos - baixo) * (v[alto] - v[baixo]);
}
const arred = (x, casas = 2) => Math.round(x * 10 ** casas) / 10 ** casas;

// Um "balde" por segundo, contado a partir do primeiro ponto do arquivo.
const baldes = new Map(); // segundo -> { dur: [], falhas: 0, vus: 0 }
const balde = (s) => {
  let b = baldes.get(s);
  if (!b) baldes.set(s, (b = { dur: [], falhas: 0, vus: 0 }));
  return b;
};

let t0 = null;
let primeiroTempo = null;
let linhas = 0;
let pontos = 0;
let ignoradas = 0;

function processa(linha) {
  linhas++;
  if (!INTERESSA.test(linha)) return;
  let obj;
  try {
    obj = JSON.parse(linha);
  } catch {
    ignoradas++;
    return;
  }
  if (obj.type !== 'Point' || !obj.data) return;
  const ms = Date.parse(obj.data.time);
  if (Number.isNaN(ms)) {
    ignoradas++;
    return;
  }
  if (t0 === null) {
    t0 = ms;
    primeiroTempo = obj.data.time;
  }
  const b = balde(Math.max(0, Math.floor((ms - t0) / 1000)));
  pontos++;
  if (obj.metric === 'http_req_duration') b.dur.push(obj.data.value);
  else if (obj.metric === 'http_req_failed') b.falhas += obj.data.value ? 1 : 0;
  else if (obj.metric === 'vus') b.vus = Math.max(b.vus, obj.data.value);
}

// Estatisticas de um conjunto de baldes (uma janela, um nivel de VUs ou o teste todo).
function estatisticas(lista, duracaoSeg) {
  const todas = [];
  let falhas = 0;
  let vus = 0;
  for (const b of lista) {
    for (const d of b.dur) todas.push(d);
    falhas += b.falhas;
    vus = Math.max(vus, b.vus);
  }
  todas.sort((x, y) => x - y);
  const n = todas.length;
  const soma = todas.reduce((a, d) => a + d, 0);
  return {
    requisicoes: n,
    req_por_s: arred(n / duracaoSeg),
    latencia_media_ms: arred(n ? soma / n : 0),
    latencia_p95_ms: arred(percentil(todas, 0.95)),
    latencia_max_ms: arred(n ? todas[n - 1] : 0),
    erros: falhas,
    erros_pct: arred(n ? (falhas / n) * 100 : 0),
    vus,
  };
}

function serie(janela, ultimo) {
  const saida = [];
  for (let ini = 0; ini <= ultimo; ini += janela) {
    const lista = [];
    for (let s = ini; s < ini + janela; s++) if (baldes.has(s)) lista.push(baldes.get(s));
    if (lista.length === 0) continue;
    const duracao = Math.min(janela, ultimo + 1 - ini); // a ultima janela pode ser parcial
    saida.push({ t_inicio_s: ini, ...estatisticas(lista, duracao) });
  }
  return saida;
}

function finaliza() {
  if (pontos === 0) {
    console.error(
      `Nenhuma medicao encontrada em ${linhas} linhas. O arquivo e mesmo a saida de "k6 run --out json=..."?`
    );
    process.exit(1);
  }
  const ultimo = Math.max(...baldes.keys());
  const total = ultimo + 1;

  // Por nivel de VUs: junta os segundos em que havia N VUs ativos.
  const porVus = new Map();
  for (const [s, b] of baldes) {
    if (b.vus <= 0) continue;
    if (!porVus.has(b.vus)) porVus.set(b.vus, []);
    porVus.get(b.vus).push(b);
  }
  const tabelaVus = [...porVus.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vus, lista]) => ({ vus, segundos: lista.length, ...estatisticas(lista, lista.length) }));

  const resultado = {
    arquivo_origem: path.basename(entrada),
    inicio: primeiroTempo,
    duracao_s: total,
    resumo: estatisticas([...baldes.values()], total),
    janela_1s: serie(1, ultimo),
    janela_5s: serie(5, ultimo),
    janela_10s: serie(10, ultimo),
    por_vus: tabelaVus,
  };

  const base = path.basename(entrada).replace(/\.gz$/, '').replace(/\.json$/, '');
  const saida = path.join(path.dirname(entrada), `${base}-agregado.json`);
  fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

  const r = resultado.resumo;
  console.log(`\nLinhas lidas: ${linhas} | pontos usados: ${pontos} | linhas ignoradas: ${ignoradas}`);
  console.log(`Duracao: ${total}s | Requisicoes: ${r.requisicoes} | Vazao media: ${r.req_por_s} req/s`);
  console.log(`Latencia: media ${r.latencia_media_ms} ms | p95 ${r.latencia_p95_ms} ms | max ${r.latencia_max_ms} ms`);
  console.log(`Erros: ${r.erros} (${r.erros_pct}%) | VUs maximos: ${r.vus}`);
  console.log('\nPor nivel de VUs (so os niveis com mais de 10s de dados):');
  console.log('  VUs | req/s | media ms |  p95 ms | erros %');
  for (const l of tabelaVus.filter((x) => x.segundos > 10)) {
    console.log(
      `${String(l.vus).padStart(5)} |${String(l.req_por_s).padStart(6)} |${String(l.latencia_media_ms).padStart(9)} |${String(
        l.latencia_p95_ms
      ).padStart(8)} |${String(l.erros_pct).padStart(8)}`
    );
  }
  console.log(`\nArquivo gerado: ${saida} (${(fs.statSync(saida).size / 1024).toFixed(1)} KB)`);
}

let fluxo = fs.createReadStream(entrada);
if (entrada.endsWith('.gz')) fluxo = fluxo.pipe(zlib.createGunzip());
const rl = readline.createInterface({ input: fluxo, crlfDelay: Infinity });
rl.on('line', processa);
rl.on('close', finaliza);
fluxo.on('error', (e) => {
  console.error('Erro ao ler o arquivo:', e.message);
  process.exit(1);
});
