const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cluster = require('cluster');
const multer = require('multer');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Otimização: ambos configuráveis pelo .env, para repetir o teste de carga com
// valores diferentes sem mexer no código.
//   DB_POOL_SIZE     conexões do pool MySQL por processo   (padrão: 10, como antes)
//   CLUSTER_WORKERS  processos Node (cluster)              (padrão: 1 = sem cluster)
const DB_POOL_SIZE = Number(process.env.DB_POOL_SIZE) || 10;
const CLUSTER_WORKERS = Number(process.env.CLUSTER_WORKERS) || 1;

// Otimizações (opcionais), também ligadas/desligadas pelo .env:
//   DB_PREWARM      1 (padrão) abre as conexões do pool na partida, antes de aceitar
//                   requisições. 0 = abre sob demanda durante a rampa, como antes.
//   DB_USE_EXECUTE  1 = prepared statements (pool.execute) no login e no cadastro, que o
//                   mysql2 guarda em cache por conexão. 0 (padrão) = pool.query, como antes.
const DB_PREWARM = process.env.DB_PREWARM !== '0';
const DB_USE_EXECUTE = process.env.DB_USE_EXECUTE === '1';

// Otimização: remove o cabeçalho X-Powered-By e o cálculo de ETag (hash SHA-1)
// que o Express faria em toda resposta da API.
app.disable('x-powered-by');
app.set('etag', false);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'adopetz',
  waitForConnections: true,
  connectionLimit: DB_POOL_SIZE,
  charset: 'utf8mb4'
});

// Consulta das rotas de login e cadastro. Com DB_USE_EXECUTE=1 usa prepared statement
// (o servidor interpreta o SQL uma vez por conexão); caso contrário, pool.query como antes.
// O pool.query converte parâmetro undefined em NULL, mas o pool.execute lança erro.
// Normalizamos aqui para que as duas formas se comportem igual (ex.: campo ausente no
// corpo da requisição continua dando 401 no login, e não 500).
function consultar(sql, params) {
  const valores = params.map((v) => (v === undefined ? null : v));
  return DB_USE_EXECUTE ? pool.execute(sql, valores) : pool.query(sql, valores);
}

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `pet_${Date.now()}${path.extname(file.originalname) || '.png'}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());

// Middleware que injeta automaticamente o script da hotbar em todas as páginas HTML.
// Otimização: fica ANTES do session/body parsers (junto com os estáticos), pois só
// atende GET de páginas HTML e não depende de sessão nem de corpo de requisição.
// Precisa vir antes do express.static, senão o HTML seria servido sem a hotbar.
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
    const fileName = req.path === '/' ? 'home.html' : req.path.replace(/^\//, '');
    const filePath = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(filePath)) {
      let html = fs.readFileSync(filePath, 'utf8');
      if (!html.includes('js/hotbar.js')) {
        html = html.replace('</body>', '<script src="/js/hotbar.js"></script>\n</body>');
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  }
  next();
});

// Servir arquivos estáticos e mapear /images para /Images
// Otimização: fica ANTES do session/body parsers, para que imagens, CSS e JS
// não passem pelo middleware de sessão (leitura do cookie e do store).
app.use('/images', express.static(path.join(__dirname, 'public', 'Images')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'adopetz_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.get('/login', (req, res) => res.redirect('/login.html'));
app.get('/register', (req, res) => res.redirect('/register.html'));

function formatarAnimal(row) {
  const dataIso = row.data_nascimento ? new Date(row.data_nascimento).toISOString().split('T')[0] : '';
  const img = row.imagem_data || 'Images/cachorro1.png';

  // Se a idade salva for 0, verifica se a data de nascimento indica mais anos
  let idadeCalculada = Number(row.idade) || 0;
  if (idadeCalculada === 0 && row.data_nascimento) {
    const hoje = new Date();
    const nasc = new Date(row.data_nascimento);
    let diff = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) diff--;
    if (diff > 0) idadeCalculada = diff;
  }

  return {
    id: row.id,
    anuncio_nome: row.anuncio_nome,
    nome: row.anuncio_nome,
    descricao: row.descricao,
    raca: row.raca,
    data_nascimento: dataIso,
    dataNascimento: dataIso,
    coloracao: row.coloracao,
    vacinado: row.vacinado,
    idade: idadeCalculada,
    tipo: row.tipo || 'Cachorro',
    localidade: row.localidade || 'RJ',
    local: row.localidade || 'RJ',
    porte: row.porte || 'Médio',
    status_anuncio: row.status_anuncio || 'ATIVO',
    tipo_anuncio: row.tipo_anuncio || 'ADOCAO',
    imagem_data: img,
    imagem_url: img,
    imagem: img,
    usuario_id: row.usuario_id,
    responsavel_nome: row.responsavel_nome || 'Usuário AdoPetz',
    responsavel_email: row.responsavel_email || '',
    responsavel_telefone: row.responsavel_telefone || ''
  };
}

// Identifica o usuário logado pela sessão ou pelo cabeçalho enviado pelo Front-End
async function obterUsuarioLogado(req) {
  const idSessao = req.session?.usuarioId || req.session?.usuario?.id || req.headers['x-usuario-id'] || req.body?.usuario_id;
  if (!idSessao) return null;
  const [rows] = await pool.query('SELECT * FROM usuario WHERE id = ?', [idSessao]);
  if (rows.length > 0) {
    req.session.usuarioId = rows[0].id;
    return rows[0];
  }
  return null;
}

// Rota utilitária para zerar anúncios, chats, adoções e avaliações de teste
app.get('/api/limpar-anuncios', async (req, res) => {
  try {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE avaliacao');
    await pool.query('TRUNCATE TABLE mensagens');
    await pool.query('TRUNCATE TABLE chats');
    await pool.query('TRUNCATE TABLE adocao');
    await pool.query('TRUNCATE TABLE animais');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ message: 'Todos os anúncios, chats, adoções e avaliações foram limpos!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 1. AUTENTICAÇÃO E PERFIL DO USUÁRIO LOGADO
// ============================================================================

app.post(['/login', '/api/login'], async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    // Otimização: busca só as colunas usadas na resposta (antes: SELECT *, que trazia
    // também a senha) e guarda só o id na sessão (o restante é lido de novo em
    // obterUsuarioLogado). A comparação da senha continua igual (texto puro).
    const [users] = await consultar(
      'SELECT id, nome, email, cpf, telefone, cep, estado, endereco, foto FROM usuario WHERE email = ? AND senha = ?',
      [email.trim(), senha]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    const u = users[0];
    req.session.usuarioId = u.id;

    return res.json({
      message: 'Login realizado com sucesso!',
      usuario: {
        id: u.id,
        nome: u.nome,
        email: u.email,
        cpf: u.cpf,
        telefone: u.telefone,
        endereco: u.endereco || `${u.estado} - CEP ${u.cep}`,
        foto: u.foto || 'Images/cliente.png'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/register', '/api/register'], async (req, res) => {
  try {
    const { nome, email, cpf, cep, telefone, senha, datanasc, estado, genero } = req.body;

    // Otimização: antes eram duas idas ao banco (SELECT de duplicidade + INSERT).
    // Como email e cpf já são UNIQUE, basta o INSERT: se houver duplicidade, o MySQL
    // devolve ER_DUP_ENTRY e respondemos 409, igual a antes. Também elimina a
    // janela de corrida entre o SELECT e o INSERT.
    const endereco = `CEP ${cep || '00000-000'} - ${estado || 'RJ'}`;
    const [result] = await consultar(
      `INSERT INTO usuario (nome, cpf, telefone, cep, senha, email, estado, genero, endereco, foto, datanasc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Images/cliente.png', ?)`,
      [nome, cpf, telefone, cep, senha, email, estado || 'RJ', genero || 'outro', endereco, datanasc || '2000-01-01']
    );
    res.status(201).json({ message: 'Usuário cadastrado!', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'E-mail ou CPF já cadastrado.' });
    res.status(500).json({ error: err.message });
  }
});

app.post(['/redefinir-senha', '/api/redefinir-senha'], async (req, res) => {
  try {
    const { email, novaSenha } = req.body;
    const [result] = await pool.query('UPDATE usuario SET senha = ? WHERE email = ?', [novaSenha, email]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'E-mail não encontrado.' });
    res.status(200).json({ message: 'Senha atualizada!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logout efetuado' }));
});

app.get('/api/usuario-dados', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [[doados]] = await pool.query('SELECT COUNT(*) AS total FROM animais WHERE usuario_id = ?', [u.id]);
    const [[adotados]] = await pool.query('SELECT COUNT(*) AS total FROM adocao WHERE adotante_id = ?', [u.id]);

    res.json({
      id: u.id,
      nome: u.nome,
      email: u.email,
      cpf: u.cpf,
      telefone: u.telefone,
      cep: u.cep,
      estado: u.estado,
      endereco: u.endereco || `CEP ${u.cep} - ${u.estado}`,
      foto: u.foto || 'Images/cliente.png',
      pets_doados: doados.total,
      pets_adotados: adotados.total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/perfil', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const { nome, email, telefone, endereco } = req.body;
    await pool.query(
      'UPDATE usuario SET nome = ?, email = ?, telefone = ?, endereco = ? WHERE id = ?',
      [nome || u.nome, email || u.email, telefone || u.telefone, endereco || u.endereco, u.id]
    );
    const atualizado = await obterUsuarioLogado(req);
    res.json({ message: 'Perfil atualizado!', usuario: atualizado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/perfil', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    await pool.query('DELETE FROM usuario WHERE id = ?', [u.id]);
    req.session.destroy(() => res.json({ message: 'Conta excluída!' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. CATÁLOGO DE ADOÇÃO, ANIMAIS PERDIDOS E MEUS ANÚNCIOS
// ============================================================================

// Lista animais ativos filtrando por tipo_anuncio ('ADOCAO' por padrão, ou 'PERDIDO')
app.get('/api/animais', async (req, res) => {
  try {
    const tipoAnuncio = req.query.tipo_anuncio || 'ADOCAO';
    const [rows] = await pool.query(`
      SELECT a.*, u.nome AS responsavel_nome, u.email AS responsavel_email, u.telefone AS responsavel_telefone
      FROM animais a
      LEFT JOIN usuario u ON a.usuario_id = u.id
      WHERE a.status_anuncio = 'ATIVO' AND a.tipo_anuncio = ?
      ORDER BY a.id DESC
    `, [tipoAnuncio]);
    res.json(rows.map(formatarAnimal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/animais/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, u.nome AS responsavel_nome, u.email AS responsavel_email, u.telefone AS responsavel_telefone
      FROM animais a
      LEFT JOIN usuario u ON a.usuario_id = u.id
      WHERE a.id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Animal não encontrado' });
    res.json(formatarAnimal(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/animais', upload.single('foto'), async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para cadastrar um animal.' });

    const nome = req.body.anuncioNome || req.body.anuncio_nome || req.body.nome;
    const descricao = req.body.descricao || '';
    const raca = req.body.raca || 'SRD';
    const dataNasc = req.body.dataNascimento || req.body.data_nascimento || '2024-01-01';
    const vacinado = req.body.vacinado || 'Não';
    const coloracao = req.body.coloracao || 'Não informada';
    const localidade = req.body.localidade || u.estado || 'RJ';
    const tipo = req.body.tipo || 'Cachorro';
    const tipo_anuncio = req.body.tipo_anuncio === 'PERDIDO' ? 'PERDIDO' : 'ADOCAO';
    const idade = req.body.idade !== undefined
      ? parseInt(req.body.idade, 10)
      : Math.max(0, new Date().getFullYear() - new Date(dataNasc).getFullYear());
    const imagem = req.file ? `uploads/${req.file.filename}` : (req.body.imagem || 'Images/cachorro1.png');

    const [result] = await pool.query(
      `INSERT INTO animais (imagem_data, anuncio_nome, descricao, raca, data_nascimento, coloracao, vacinado, tipo, localidade, tipo_anuncio, idade, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [imagem, nome, descricao, raca, dataNasc, coloracao, vacinado, tipo, localidade, tipo_anuncio, idade, u.id]
    );
    const [novo] = await pool.query('SELECT * FROM animais WHERE id = ?', [result.insertId]);
    res.status(201).json(formatarAnimal(novo[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meus_anuncios', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [rows] = await pool.query(
      'SELECT * FROM animais WHERE usuario_id = ? ORDER BY id DESC',
      [u.id]
    );
    res.json(rows.map(formatarAnimal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meus_anuncios/:id', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [rows] = await pool.query(
      'SELECT * FROM animais WHERE id = ? AND usuario_id = ?',
      [req.params.id, u.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Você não tem permissão para editar este anúncio.' });
    res.json(formatarAnimal(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/meus_anuncios/:id', upload.single('imagem'), async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [atuais] = await pool.query(
      'SELECT * FROM animais WHERE id = ? AND usuario_id = ?',
      [req.params.id, u.id]
    );
    if (atuais.length === 0) return res.status(403).json({ error: 'Permissão negada: este anúncio não é seu.' });
    const atual = atuais[0];

    const nome = req.body.anuncio_nome || req.body.nome || atual.anuncio_nome;
    const descricao = req.body.descricao !== undefined ? req.body.descricao : atual.descricao;
    const raca = req.body.raca || atual.raca;
    const data_nascimento = req.body.data_nascimento || atual.data_nascimento;
    const coloracao = req.body.coloracao || atual.coloracao;
    const vacinado = req.body.vacinado || atual.vacinado;
    const idade = req.body.idade !== undefined ? parseInt(req.body.idade, 10) : atual.idade;
    const imagem = req.file
      ? `uploads/${req.file.filename}`
      : (req.body.imagem && req.body.imagem.trim() !== '' ? req.body.imagem : atual.imagem_data);

    await pool.query(
      `UPDATE animais SET anuncio_nome=?, descricao=?, raca=?, data_nascimento=?, coloracao=?, vacinado=?, idade=?, imagem_data=?
       WHERE id=? AND usuario_id=?`,
      [nome, descricao, raca, data_nascimento, coloracao, vacinado, idade, imagem, req.params.id, u.id]
    );
    const [atualizado] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.params.id]);
    res.json(formatarAnimal(atualizado[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/meus_anuncios/:id', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [result] = await pool.query(
      'DELETE FROM animais WHERE id = ? AND usuario_id = ?',
      [req.params.id, u.id]
    );
    if (result.affectedRows === 0) return res.status(403).json({ error: 'Permissão negada: este anúncio não é seu.' });
    res.json({ message: 'Excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. CHATS, MENSAGENS, ADOÇÃO E AVALIAÇÃO (TABELA avaliacao)
// ============================================================================

app.get('/api/chats', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [rows] = await pool.query(`
      SELECT c.id AS chat_id, c.animal_id, c.adotante_id, c.anunciante_id,
             a.anuncio_nome AS nome, a.imagem_data AS imagem, a.status_anuncio, a.tipo_anuncio,
             COALESCE(u_adot.nome, 'Interessado') AS adotante_nome,
             COALESCE(u_anun.nome, 'Responsável') AS anunciante_nome,
             ad.id AS adocao_id
      FROM chats c
      JOIN animais a ON c.animal_id = a.id
      LEFT JOIN usuario u_adot ON c.adotante_id = u_adot.id
      LEFT JOIN usuario u_anun ON c.anunciante_id = u_anun.id
      LEFT JOIN adocao ad ON ad.id_animal = a.id
      WHERE c.adotante_id = ? OR c.anunciante_id = ?
      ORDER BY c.id DESC
    `, [u.id, u.id]);

    const formatados = rows.map(r => ({
      ...r,
      meu_id: u.id,
      sou_anunciante: Number(r.anunciante_id) === Number(u.id),
      outro_usuario_nome: Number(r.anunciante_id) === Number(u.id) ? r.adotante_nome : r.anunciante_nome
    }));

    res.json(formatados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para iniciar um chat.' });

    const animalId = parseInt(req.body.animal_id, 10);
    const [[animal]] = await pool.query('SELECT * FROM animais WHERE id = ?', [animalId]);
    if (!animal) return res.status(404).json({ error: 'Animal não encontrado.' });

    if (Number(animal.usuario_id) === Number(u.id)) {
      return res.status(400).json({ error: 'Este anúncio foi publicado por você!' });
    }

    const [existentes] = await pool.query(
      'SELECT * FROM chats WHERE animal_id = ? AND adotante_id = ? LIMIT 1',
      [animalId, u.id]
    );
    if (existentes.length > 0) return res.json(existentes[0]);

    const [result] = await pool.query(
      'INSERT INTO chats (animal_id, adotante_id, anunciante_id) VALUES (?, ?, ?)',
      [animalId, u.id, animal.usuario_id]
    );
    const [[novo]] = await pool.query('SELECT * FROM chats WHERE id = ?', [result.insertId]);
    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/mensagens', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [rows] = await pool.query(`
      SELECT m.*, COALESCE(u.nome, 'Usuário') AS remetente_nome
      FROM mensagens m
      LEFT JOIN usuario u ON m.remetente_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.data_envio ASC, m.id ASC
    `, [req.params.chatId]);

    res.json(rows.map(m => ({
      id: m.id,
      remetente_id: m.remetente_id,
      remetente_nome: m.remetente_nome,
      texto: m.mensagem,
      timestamp: m.data_envio,
      tipo: Number(m.remetente_id) === Number(u.id) ? 'sent' : 'received'
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/:chatId/mensagens', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const { texto } = req.body;
    const [result] = await pool.query(
      'INSERT INTO mensagens (chat_id, remetente_id, mensagem) VALUES (?, ?, ?)',
      [req.params.chatId, u.id, texto]
    );
    const [[nova]] = await pool.query('SELECT * FROM mensagens WHERE id = ?', [result.insertId]);
    res.status(201).json({
      id: nova.id,
      remetente_nome: u.nome,
      texto: nova.mensagem,
      timestamp: nova.data_envio,
      tipo: 'sent'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/adocao', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const { chat_id } = req.body;
    const [[chat]] = await pool.query('SELECT * FROM chats WHERE id = ?', [chat_id]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    if (Number(chat.anunciante_id) !== Number(u.id)) {
      return res.status(403).json({ error: 'Apenas o responsável pelo animal pode confirmar esta ação.' });
    }

    const [[animal]] = await pool.query('SELECT * FROM animais WHERE id = ?', [chat.animal_id]);
    const [[adotante]] = await pool.query('SELECT * FROM usuario WHERE id = ?', [chat.adotante_id]);

    if (animal.tipo_anuncio === 'PERDIDO') {
      await pool.query("UPDATE animais SET status_anuncio = 'ENCERRADO' WHERE id = ?", [animal.id]);
      return res.status(200).json({
        message: `Que notícia boa! O anúncio de ${animal.anuncio_nome} foi marcado como encontrado e encerrado.`
      });
    }

    const [result] = await pool.query(
      `INSERT INTO adocao (id_animal, animal_nome, animal_raca, adotante_id, Status, anunciante_id, adotante_nome, adotante_cpf, anunciante_nome, anunciante_cpf)
       VALUES (?, ?, ?, ?, 'Aprovada', ?, ?, ?, ?, ?)`,
      [animal.id, animal.anuncio_nome, animal.raca, adotante.id, u.id, adotante.nome, adotante.cpf, u.nome, u.cpf]
    );
    await pool.query("UPDATE animais SET status_anuncio = 'ADOTADO' WHERE id = ?", [animal.id]);

    res.status(201).json({
      message: `Adoção de ${animal.anuncio_nome} por ${adotante.nome} concluída! Agora vocês podem avaliar a adoção na página de Perfil.`,
      adocao_id: result.insertId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/minhas-adocoes', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [rows] = await pool.query(`
      SELECT ad.*,
             (SELECT av.Comentario FROM avaliacao av WHERE av.adocao_id = ad.id AND av.usuario_id = ? LIMIT 1) AS minha_avaliacao
      FROM adocao ad
      WHERE ad.adotante_id = ? OR ad.anunciante_id = ?
      ORDER BY ad.id DESC
    `, [u.id, u.id, u.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/avaliacoes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT av.Comentario AS comentario, av.usuario_id, av.adocao_id, av.Data AS data_avaliacao,
             u.nome AS autor_nome, u.foto AS autor_foto,
             ad.animal_nome, ad.adotante_nome, ad.anunciante_nome
      FROM avaliacao av
      JOIN usuario u ON av.usuario_id = u.id
      JOIN adocao ad ON av.adocao_id = ad.id
      ORDER BY av.Data DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avaliacoes', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para avaliar.' });

    const { adocao_id, comentario } = req.body;
    if (!adocao_id || !comentario || !comentario.trim()) {
      return res.status(400).json({ error: 'Escreva um comentário para a avaliação.' });
    }

    const [[adocao]] = await pool.query('SELECT * FROM adocao WHERE id = ?', [adocao_id]);
    if (!adocao) return res.status(404).json({ error: 'Registro de adoção não encontrado.' });

    if (Number(adocao.adotante_id) !== Number(u.id) && Number(adocao.anunciante_id) !== Number(u.id)) {
      return res.status(403).json({ error: 'Apenas participantes desta adoção podem avaliá-la.' });
    }

    const [existente] = await pool.query(
      'SELECT * FROM avaliacao WHERE adocao_id = ? AND usuario_id = ?',
      [adocao_id, u.id]
    );

    if (existente.length > 0) {
      await pool.query(
        'UPDATE avaliacao SET Comentario = ?, Data = CURRENT_TIMESTAMP WHERE adocao_id = ? AND usuario_id = ?',
        [comentario.trim(), adocao_id, u.id]
      );
      return res.json({ message: 'Sua avaliação foi atualizada com sucesso!' });
    }

    await pool.query(
      'INSERT INTO avaliacao (Comentario, usuario_id, adocao_id) VALUES (?, ?, ?)',
      [comentario.trim(), u.id, adocao_id]
    );

    res.status(201).json({ message: 'Avaliação registrada com sucesso no banco de dados!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. BLOG PETSOCIAL (MÚLTIPLOS USUÁRIOS, CURTIDAS E COMENTÁRIOS)
// ============================================================================

app.get('/api/postagens', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    const meuId = u ? Number(u.id) : null;

    const [posts] = await pool.query('SELECT * FROM postagens ORDER BY fixado DESC, id DESC');
    const [comentarios] = await pool.query('SELECT * FROM comentarios ORDER BY id ASC');
    const minhasCurtidas = new Set();

    if (meuId) {
      const [curtidasRows] = await pool.query(
        'SELECT postagem_id FROM postagem_curtidas WHERE usuario_id = ?',
        [meuId]
      );
      curtidasRows.forEach(r => minhasCurtidas.add(Number(r.postagem_id)));
    }

    const resultado = posts.map(p => ({
      ...p,
      sou_autor: meuId !== null && Number(p.usuario_id) === meuId,
      curtido_por_mim: minhasCurtidas.has(Number(p.id)),
      comentarios: comentarios.filter(c => Number(c.postagem_id) === Number(p.id))
    }));

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para publicar no Blog.' });

    const { texto, imagem_url, tags } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ error: 'O texto da postagem é obrigatório.' });
    }

    const tagsStr = Array.isArray(tags) ? tags.join(' ') : (tags || '');
    const [result] = await pool.query(
      `INSERT INTO postagens (usuario_id, autor_nome, autor_foto, texto, imagem_url, tags, num_curtidas)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [u.id, u.nome, u.foto || 'Images/cliente.png', texto.trim(), imagem_url || '', tagsStr]
    );

    const [[nova]] = await pool.query('SELECT * FROM postagens WHERE id = ?', [result.insertId]);
    res.status(201).json({
      ...nova,
      sou_autor: true,
      curtido_por_mim: false,
      comentarios: []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/postagens/:id', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [[post]] = await pool.query('SELECT * FROM postagens WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Postagem não encontrada' });
    if (Number(post.usuario_id) !== Number(u.id)) {
      return res.status(403).json({ error: 'Você só pode editar suas próprias publicações.' });
    }

    const { texto, imagem_url, tags } = req.body;
    const tagsStr = Array.isArray(tags) ? tags.join(' ') : (tags || '');
    await pool.query(
      'UPDATE postagens SET texto = ?, imagem_url = ?, tags = ? WHERE id = ?',
      [texto.trim(), imagem_url || '', tagsStr, req.params.id]
    );
    res.json({ message: 'Postagem atualizada!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/postagens/:id', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });

    const [[post]] = await pool.query('SELECT * FROM postagens WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Postagem não encontrada' });
    if (Number(post.usuario_id) !== Number(u.id)) {
      return res.status(403).json({ error: 'Você só pode excluir suas próprias publicações.' });
    }

    await pool.query('DELETE FROM postagens WHERE id = ?', [req.params.id]);
    res.json({ message: 'Postagem excluída!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens/:id/curtir', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para curtir publicações.' });

    const postagemId = parseInt(req.params.id, 10);
    const [jaCurtiu] = await pool.query(
      'SELECT * FROM postagem_curtidas WHERE postagem_id = ? AND usuario_id = ?',
      [postagemId, u.id]
    );

    let liked = false;
    if (jaCurtiu.length > 0) {
      await pool.query('DELETE FROM postagem_curtidas WHERE postagem_id = ? AND usuario_id = ?', [postagemId, u.id]);
      await pool.query('UPDATE postagens SET num_curtidas = GREATEST(0, num_curtidas - 1) WHERE id = ?', [postagemId]);
      liked = false;
    } else {
      await pool.query('INSERT INTO postagem_curtidas (postagem_id, usuario_id) VALUES (?, ?)', [postagemId, u.id]);
      await pool.query('UPDATE postagens SET num_curtidas = num_curtidas + 1 WHERE id = ?', [postagemId]);
      liked = true;
    }

    const [[post]] = await pool.query('SELECT num_curtidas FROM postagens WHERE id = ?', [postagemId]);
    res.json({ liked, num_curtidas: post ? post.num_curtidas : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens/:id/comentarios', async (req, res) => {
  try {
    const u = await obterUsuarioLogado(req);
    if (!u) return res.status(401).json({ error: 'Faça login para comentar.' });

    const { texto } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ error: 'Comentário vazio.' });
    }

    const [result] = await pool.query(
      'INSERT INTO comentarios (postagem_id, usuario_id, autor_nome, autor_foto, texto) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, u.id, u.nome, u.foto || 'Images/cliente.png', texto.trim()]
    );

    const [[novo]] = await pool.query('SELECT * FROM comentarios WHERE id = ?', [result.insertId]);
    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. CALENDÁRIO DE EVENTOS E ONGS
// ============================================================================

app.get('/api/eventos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM eventos ORDER BY data_evento ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ongs', async (req, res) => {
  try {
    const { nome, cnpj, email, telefone, cidade, descricao } = req.body;
    const [result] = await pool.query(
      'INSERT INTO ongs (nome, cnpj, email, telefone, cidade, descricao) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, cnpj, email, telefone, cidade, descricao]
    );
    res.status(201).json({ id: result.insertId, message: 'ONG cadastrada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 6. INICIALIZAÇÃO E MIGRAÇÃO AUTOMÁTICA DO BANCO MYSQL
// ============================================================================

// Cria o banco na primeira execução ou, se ele já existir, aplica as migrações.
async function prepararBanco() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      multipleStatements: true
    });
    const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [process.env.DB_NAME || 'adopetz']);
    if (dbs.length === 0) {
      const sql = fs.readFileSync(path.join(__dirname, 'mysql', 'Adopetz.sql'), 'utf8');
      await conn.query(sql);
      console.log('Banco MySQL "adopetz" criado!');
    } else {
      await conn.query(`USE \`${process.env.DB_NAME || 'adopetz'}\``);
      const migracoes = [
        "ALTER TABLE animais MODIFY COLUMN imagem_data LONGTEXT NOT NULL",
        "ALTER TABLE animais ADD COLUMN tipo VARCHAR(50) NOT NULL DEFAULT 'Cachorro'",
        "ALTER TABLE animais ADD COLUMN localidade CHAR(2) NOT NULL DEFAULT 'RJ'",
        "ALTER TABLE animais ADD COLUMN porte VARCHAR(50) NOT NULL DEFAULT 'Médio'",
        "ALTER TABLE animais ADD COLUMN status_anuncio ENUM('ATIVO', 'ADOTADO', 'ENCERRADO') NOT NULL DEFAULT 'ATIVO'",
        "ALTER TABLE animais ADD COLUMN tipo_anuncio ENUM('ADOCAO', 'PERDIDO') NOT NULL DEFAULT 'ADOCAO'",
        "ALTER TABLE usuario ADD COLUMN genero VARCHAR(20) DEFAULT 'outro'",
        "ALTER TABLE usuario ADD COLUMN endereco VARCHAR(255) DEFAULT 'Rio de Janeiro - RJ'",
        "ALTER TABLE usuario ADD COLUMN foto VARCHAR(255) DEFAULT 'Images/cliente.png'",
        `CREATE TABLE IF NOT EXISTS postagens (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario_id INT,
          autor_nome VARCHAR(100) NOT NULL,
          autor_foto VARCHAR(255) DEFAULT 'Images/cliente.png',
          texto LONGTEXT NOT NULL,
          imagem_url TEXT,
          tags VARCHAR(255) DEFAULT '',
          num_curtidas INT DEFAULT 0,
          fixado TINYINT(1) DEFAULT 0,
          link_externo VARCHAR(255) DEFAULT NULL,
          data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB`,
        `CREATE TABLE IF NOT EXISTS postagem_curtidas (
          postagem_id INT NOT NULL,
          usuario_id INT NOT NULL,
          PRIMARY KEY (postagem_id, usuario_id)
        ) ENGINE=InnoDB`,
        `CREATE TABLE IF NOT EXISTS comentarios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          postagem_id INT NOT NULL,
          usuario_id INT,
          autor_nome VARCHAR(100) NOT NULL,
          autor_foto VARCHAR(255) DEFAULT 'Images/cliente.png',
          texto TEXT NOT NULL,
          data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB`,
        `CREATE TABLE IF NOT EXISTS avaliacao (
          Idavaliacao INT AUTO_INCREMENT PRIMARY KEY,
          Comentario TEXT,
          usuario_id INT,
          adocao_id INT,
          Data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB`
      ];
      for (const q of migracoes) {
        try { await conn.query(q); } catch (ignorar) {}
      }
    }
    await conn.end();
  } catch (e) {
    console.warn('Aviso MySQL:', e.message);
  }
}

// Otimização: o mysql2 não tem pool mínimo e só abre conexões quando há requisições,
// então a rampa do teste pagava o handshake de cada conexão nova. Aqui disparamos
// DB_POOL_SIZE consultas ao mesmo tempo; como não há conexão livre, o pool abre uma
// para cada. Em cluster, cada worker aquece o seu próprio pool. Se o MySQL recusar
// conexões (ex.: max_connections baixo), só avisa e segue: o pool abre sob demanda.
async function aquecerPool() {
  if (!DB_PREWARM) return;
  const inicio = Date.now();
  const resultados = await Promise.allSettled(
    Array.from({ length: DB_POOL_SIZE }, () => pool.query('SELECT 1'))
  );
  const abertas = resultados.filter((r) => r.status === 'fulfilled').length;
  console.log(`Pool aquecido: ${abertas}/${DB_POOL_SIZE} conexões em ${Date.now() - inicio} ms.`);
  const falha = resultados.find((r) => r.status === 'rejected');
  if (falha) console.warn('Aviso: nem todas as conexões abriram:', falha.reason && falha.reason.message);
}

async function iniciarServidor() {
  await aquecerPool();
  app.listen(PORT, () => console.log(
    `🚀 Servidor rodando em http://localhost:${PORT}` + (CLUSTER_WORKERS > 1 ? ` (worker ${process.pid})` : '')
  ));
}

async function iniciar() {
  // Otimização (opcional): com CLUSTER_WORKERS > 1 o processo principal prepara o
  // banco (criação/migrações) uma única vez e sobe N processos Node, que dividem a
  // mesma porta. Assim o Node deixa de ser limitado a um único núcleo de CPU.
  // ATENÇÃO: a sessão (express-session) fica na memória de cada processo e NÃO é
  // compartilhada entre os workers. Para uso real, troque por um store
  // compartilhado (ex.: express-mysql-session). Para o teste de carga de
  // login/cadastro isso não interfere.
  if (CLUSTER_WORKERS > 1 && cluster.isPrimary) {
    await prepararBanco();
    console.warn(`Cluster ativo: ${CLUSTER_WORKERS} workers (sessões em memória não são compartilhadas entre eles).`);
    cluster.schedulingPolicy = cluster.SCHED_RR; // distribui as conexões em rodízio (no Windows o padrão não é esse)
    for (let i = 0; i < CLUSTER_WORKERS; i++) cluster.fork();
    cluster.on('exit', (worker, code) => {
      console.warn(`Worker ${worker.process.pid} encerrou (código ${code}). Reiniciando em 1 s...`);
      setTimeout(() => cluster.fork(), 1000);
    });
    return;
  }
  if (CLUSTER_WORKERS <= 1) await prepararBanco();
  iniciarServidor();
}

iniciar();
