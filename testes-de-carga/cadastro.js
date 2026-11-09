// Teste de carga: CADASTRO (POST /api/register) - escrita na tabela `usuario`
//
// Uso (a partir desta pasta):
//   k6 run cadastro.js
//
// Variaveis opcionais (-e NOME=valor): BASE_URL, STAGES, THINK_TIME
// (mesmo significado do login.js)
//
// O banco tem UNIQUE em e-mail E em CPF, e o servidor responde 409 se qualquer
// um dos dois repetir. Por isso o script gera os dois de forma unica a cada
// iteracao; senao voce mediria apenas o erro 409.

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const THINK_TIME = Number(__ENV.THINK_TIME || 0);

// Cada degrau: sobe ate o numero de VUs em 30s e mantem por 1min.
// No fim, desce a 0 em 30s.
const degraus = (__ENV.STAGES || '1,10,50,100').split(',').map(Number);
const stages = [];
for (const vus of degraus) {
  stages.push({ duration: '30s', target: vus });
  stages.push({ duration: '1m', target: vus });
}
stages.push({ duration: '30s', target: 0 });

export const options = {
  stages,
  thresholds: {
    // Limites de exemplo (SLA): ajuste conforme o combinado no trabalho.
    http_req_failed: ['rate<0.01'],    // menos de 1% de erros
    http_req_duration: ['p(95)<1000'], // 95% das requisicoes abaixo de 1s
  },
};

const headers = { 'Content-Type': 'application/json' };

// Roda uma vez antes da carga. Gera um identificador desta execucao: assim, rodar
// o teste de novo nao repete e-mail/CPF de uma execucao anterior que ainda esteja
// no banco (user_${__VU}_${__ITER} sozinho recomecaria do zero a cada execucao).
export function setup() {
  const res = http.get(`${BASE_URL}/`);
  if (res.status !== 200) {
    throw new Error(`Servidor nao respondeu em ${BASE_URL} (HTTP ${res.status}).`);
  }
  return {
    runId: Date.now().toString(36),
    cpfBase: 100000000 + Math.floor(Math.random() * 800000000),
  };
}

// Monta um CPF com digitos verificadores validos a partir de 9 digitos.
function gerarCpf(base) {
  const d = String(base).padStart(9, '0').split('').map(Number);
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += d[i] * (t + 1 - i);
    d.push(((soma * 10) % 11) % 10);
  }
  const s = d.join('');
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}

export default function (data) {
  // Contador global unico entre todos os VUs desta execucao.
  const n = exec.scenario.iterationInTest;

  const payload = {
    nome: `Usuario Carga ${__VU}-${__ITER}`,
    email: `user_${data.runId}_${__VU}_${__ITER}@teste.com`,
    cpf: gerarCpf((data.cpfBase + n) % 1000000000),
    cep: '20000-000',
    telefone: '(21) 99999-0000',
    senha: 'senha123',
    datanasc: '1995-05-10',
    estado: 'RJ',
    genero: 'outro',
  };

  const res = http.post(`${BASE_URL}/api/register`, JSON.stringify(payload), { headers });
  check(res, { 'cadastro retorna 201': (r) => r.status === 201 });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
