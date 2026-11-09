// Teste de carga: LOGIN (POST /api/login) - leitura no banco
//
// Uso (a partir desta pasta):
//   k6 run -e LOGIN_EMAIL=usuario@exemplo.com -e LOGIN_SENHA=sua_senha login.js
//
// Variaveis opcionais (-e NOME=valor):
//   BASE_URL    endereco do servidor                          (padrao: http://localhost:3000)
//   STAGES      degraus de VUs separados por virgula          (padrao: 1,10,50,100)
//   THINK_TIME  pausa, em segundos, entre requisicoes por VU  (padrao: 0)

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const LOGIN_EMAIL = __ENV.LOGIN_EMAIL;
const LOGIN_SENHA = __ENV.LOGIN_SENHA;
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

// Roda uma vez antes da carga: confere se o usuario existe e se a senha esta certa.
// Se falhar, o teste nem comeca (evita medir 100% de erro por engano).
export function setup() {
  if (!LOGIN_EMAIL || !LOGIN_SENHA) {
    throw new Error('Informe LOGIN_EMAIL e LOGIN_SENHA (um usuario ja cadastrado) com -e.');
  }
  const res = http.post(
    `${BASE_URL}/api/login`,
    JSON.stringify({ email: LOGIN_EMAIL, senha: LOGIN_SENHA }),
    { headers }
  );
  if (res.status !== 200) {
    throw new Error(`Login de teste falhou (HTTP ${res.status}). Confira e-mail/senha e se o servidor esta no ar.`);
  }
}

export default function () {
  const res = http.post(
    `${BASE_URL}/api/login`,
    JSON.stringify({ email: LOGIN_EMAIL, senha: LOGIN_SENHA }),
    { headers }
  );
  check(res, { 'login retorna 200': (r) => r.status === 200 });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
