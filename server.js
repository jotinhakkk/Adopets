const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'adopetz',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

// Pasta de uploads de imagens
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `pet_${Date.now()}${path.extname(file.originalname) || '.png'}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'adopetz_secret_2026',
  resave: false,
  saveUninitialized: false
}));

// Servir arquivos estáticos e mapear /images para /Images
app.use('/images', express.static(path.join(__dirname, 'public', 'Images')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

function formatarAnimal(row) {
  const dataIso = row.data_nascimento ? new Date(row.data_nascimento).toISOString().split('T')[0] : '';
  const img = row.imagem_data || 'Images/cachorro1.png';
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
    idade: row.idade,
    tipo: row.tipo || 'Cachorro',
    localidade: row.localidade || 'RJ',
    local: row.localidade || 'RJ',
    porte: row.porte || 'Médio',
    status_anuncio: row.status_anuncio || 'ATIVO',
    imagem_data: img,
    imagem_url: img,
    imagem: img,
    usuario_id: row.usuario_id
  };
}

async function obterUsuarioAtual(req) {
  if (req.session && req.session.usuario) {
    const [rows] = await pool.query('SELECT * FROM usuario WHERE id = ?', [req.session.usuario.id]);
    if (rows.length > 0) return rows[0];
  }
  const [rows] = await pool.query('SELECT * FROM usuario ORDER BY id ASC LIMIT 1');
  return rows[0] || null;
}

// --- AUTENTICAÇÃO E PERFIL ---
app.post(['/login', '/api/login'], async (req, res) => {
  try {
    const { email, senha } = req.body;
    const [users] = await pool.query('SELECT * FROM usuario WHERE email = ? AND senha = ?', [email, senha]);
    if (users.length > 0) {
      req.session.usuario = users[0];
      return res.json({ message: 'Login realizado!', usuario: users[0] });
    }
    const [admins] = await pool.query('SELECT * FROM administrador WHERE email = ? AND senha = ?', [email, senha]);
    if (admins.length > 0) {
      req.session.usuario = admins[0];
      return res.json({ message: 'Login admin realizado!', usuario: admins[0] });
    }
    res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/register', '/api/register'], async (req, res) => {
  try {
    const { nome, email, cpf, cep, telefone, senha, datanasc, estado, genero } = req.body;
    const [existe] = await pool.query('SELECT id FROM usuario WHERE email = ? OR cpf = ?', [email, cpf]);
    if (existe.length > 0) return res.status(409).json({ error: 'E-mail ou CPF já cadastrado.' });

    const endereco = `${estado || 'RJ'} - CEP ${cep || '00000-000'}`;
    const [result] = await pool.query(
      `INSERT INTO usuario (nome, cpf, telefone, cep, senha, email, estado, genero, endereco, datanasc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, cpf, telefone, cep, senha, email, estado || 'RJ', genero || 'outro', endereco, datanasc || '2000-01-01']
    );
    res.status(201).json({ message: 'Usuário cadastrado!', id: result.insertId });
  } catch (err) {
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
    const u = await obterUsuarioAtual(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado' });
    const [[doados]] = await pool.query('SELECT COUNT(*) AS total FROM animais WHERE usuario_id = ?', [u.id]);
    const [[adotados]] = await pool.query('SELECT COUNT(*) AS total FROM adocao WHERE adotante_id = ?', [u.id]);
    res.json({ ...u, pets_doados: doados.total, pets_adotados: adotados.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/perfil', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const { nome, email, telefone, endereco } = req.body;
    await pool.query(
      'UPDATE usuario SET nome = ?, email = ?, telefone = ?, endereco = ? WHERE id = ?',
      [nome || u.nome, email || u.email, telefone || u.telefone, endereco || u.endereco, u.id]
    );
    const atualizado = await obterUsuarioAtual(req);
    res.json({ message: 'Perfil atualizado!', usuario: atualizado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/perfil', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    await pool.query('DELETE FROM usuario WHERE id = ?', [u.id]);
    req.session.destroy(() => res.json({ message: 'Conta excluída!' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ANIMAIS E ANÚNCIOS ---
app.get('/api/animais', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM animais WHERE status_anuncio = 'ATIVO' ORDER BY id DESC");
    res.json(rows.map(formatarAnimal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/animais/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Animal não encontrado' });
    res.json(formatarAnimal(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/animais', upload.single('foto'), async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const nome = req.body.anuncioNome || req.body.anuncio_nome || req.body.nome;
    const descricao = req.body.descricao || '';
    const raca = req.body.raca || 'SRD';
    const dataNasc = req.body.dataNascimento || req.body.data_nascimento || '2024-01-01';
    const vacinado = req.body.vacinado || 'Não';
    const coloracao = req.body.coloracao || 'Não informada';
    const localidade = req.body.localidade || 'RJ';
    const tipo = req.body.tipo || 'Cachorro';
    const idade = req.body.idade !== undefined ? parseInt(req.body.idade, 10) : Math.max(0, new Date().getFullYear() - new Date(dataNasc).getFullYear());
    const imagem = req.file ? `uploads/${req.file.filename}` : (req.body.imagem || 'Images/cachorro1.png');

    const [result] = await pool.query(
      `INSERT INTO animais (imagem_data, anuncio_nome, descricao, raca, data_nascimento, coloracao, vacinado, tipo, localidade, idade, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [imagem, nome, descricao, raca, dataNasc, coloracao, vacinado, tipo, localidade, idade, u ? u.id : 1]
    );
    const [novo] = await pool.query('SELECT * FROM animais WHERE id = ?', [result.insertId]);
    res.status(201).json(formatarAnimal(novo[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meus_anuncios', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM animais ORDER BY id DESC');
    res.json(rows.map(formatarAnimal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meus_anuncios/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Anúncio não encontrado' });
    res.json(formatarAnimal(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/meus_anuncios/:id', upload.single('imagem'), async (req, res) => {
  try {
    const [atuais] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.params.id]);
    if (atuais.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    const atual = atuais[0];

    const nome = req.body.anuncio_nome || req.body.nome || atual.anuncio_nome;
    const descricao = req.body.descricao !== undefined ? req.body.descricao : atual.descricao;
    const raca = req.body.raca || atual.raca;
    const data_nascimento = req.body.data_nascimento || atual.data_nascimento;
    const coloracao = req.body.coloracao || atual.coloracao;
    const vacinado = req.body.vacinado || atual.vacinado;
    const idade = req.body.idade !== undefined ? parseInt(req.body.idade, 10) : atual.idade;
    const imagem = req.file ? `uploads/${req.file.filename}` : (req.body.imagem && req.body.imagem.trim() !== '' ? req.body.imagem : atual.imagem_data);

    await pool.query(
      `UPDATE animais SET anuncio_nome=?, descricao=?, raca=?, data_nascimento=?, coloracao=?, vacinado=?, idade=?, imagem_data=? WHERE id=?`,
      [nome, descricao, raca, data_nascimento, coloracao, vacinado, idade, imagem, req.params.id]
    );
    const [atualizado] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.params.id]);
    res.json(formatarAnimal(atualizado[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/meus_anuncios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM animais WHERE id = ?', [req.params.id]);
    res.json({ message: 'Excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CHATS, MENSAGENS E ADOÇÃO ---
app.get('/api/chats', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.id AS chat_id, c.animal_id, c.adotante_id, c.anunciante_id,
             a.anuncio_nome AS nome, a.imagem_data AS imagem
      FROM chats c
      JOIN animais a ON c.animal_id = a.id
      ORDER BY c.id DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const animalId = parseInt(req.body.animal_id, 10);
    const [existentes] = await pool.query('SELECT * FROM chats WHERE animal_id = ? LIMIT 1', [animalId]);
    if (existentes.length > 0) return res.json(existentes[0]);

    const [[animal]] = await pool.query('SELECT * FROM animais WHERE id = ?', [animalId]);
    const [result] = await pool.query(
      'INSERT INTO chats (animal_id, adotante_id, anunciante_id) VALUES (?, ?, ?)',
      [animalId, u ? u.id : 1, animal ? animal.usuario_id : 1]
    );
    const [[novo]] = await pool.query('SELECT * FROM chats WHERE id = ?', [result.insertId]);
    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/mensagens', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const meuId = u ? u.id : 1;
    const [rows] = await pool.query('SELECT * FROM mensagens WHERE chat_id = ? ORDER BY data_envio ASC', [req.params.chatId]);
    res.json(rows.map(m => ({
      id: m.id,
      texto: m.mensagem,
      timestamp: m.data_envio,
      tipo: m.remetente_id === meuId ? 'sent' : 'received'
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/:chatId/mensagens', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const { texto } = req.body;
    const [result] = await pool.query(
      'INSERT INTO mensagens (chat_id, remetente_id, mensagem) VALUES (?, ?, ?)',
      [req.params.chatId, u ? u.id : 1, texto]
    );
    const [[nova]] = await pool.query('SELECT * FROM mensagens WHERE id = ?', [result.insertId]);
    res.status(201).json({ id: nova.id, texto: nova.mensagem, timestamp: nova.data_envio, tipo: 'sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/adocao', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const [[animal]] = await pool.query('SELECT * FROM animais WHERE id = ?', [req.body.animal_id]);
    if (!animal) return res.status(404).json({ error: 'Animal não encontrado' });

    await pool.query(
      `INSERT INTO adocao (id_animal, animal_nome, animal_raca, adotante_id, Status, anunciante_id, adotante_nome, adotante_cpf)
       VALUES (?, ?, ?, ?, 'Aprovada', ?, ?, ?)`,
      [animal.id, animal.anuncio_nome, animal.raca, u ? u.id : 1, animal.usuario_id || 1, u ? u.nome : 'Adotante', u ? u.cpf : '000.000.000-00']
    );
    await pool.query("UPDATE animais SET status_anuncio = 'ADOTADO' WHERE id = ?", [animal.id]);
    res.status(201).json({ message: 'Adoção registrada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BLOG, CALENDÁRIO E ONGS ---
app.get('/api/postagens', async (req, res) => {
  try {
    const [posts] = await pool.query('SELECT * FROM postagens ORDER BY fixado DESC, id DESC');
    const [comentarios] = await pool.query('SELECT * FROM comentarios ORDER BY id ASC');
    res.json(posts.map(p => ({ ...p, comentarios: comentarios.filter(c => c.postagem_id === p.id) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const { texto, imagem_url, tags } = req.body;
    const [result] = await pool.query(
      'INSERT INTO postagens (usuario_id, autor_nome, autor_foto, texto, imagem_url, tags) VALUES (?, ?, ?, ?, ?, ?)',
      [u ? u.id : 1, 'Você', u ? u.foto : 'Images/meuamor.jpg', texto, imagem_url, Array.isArray(tags) ? tags.join(' ') : tags]
    );
    const [[nova]] = await pool.query('SELECT * FROM postagens WHERE id = ?', [result.insertId]);
    res.status(201).json({ ...nova, comentarios: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/postagens/:id', async (req, res) => {
  try {
    const { texto, imagem_url, tags } = req.body;
    await pool.query('UPDATE postagens SET texto=?, imagem_url=?, tags=? WHERE id=?', [texto, imagem_url, Array.isArray(tags) ? tags.join(' ') : tags, req.params.id]);
    res.json({ message: 'Post atualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/postagens/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM postagens WHERE id = ?', [req.params.id]);
    res.json({ message: 'Post removido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens/:id/curtir', async (req, res) => {
  try {
    await pool.query('UPDATE postagens SET num_curtidas = num_curtidas + 1 WHERE id = ?', [req.params.id]);
    const [[p]] = await pool.query('SELECT num_curtidas FROM postagens WHERE id = ?', [req.params.id]);
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/postagens/:id/comentarios', async (req, res) => {
  try {
    const u = await obterUsuarioAtual(req);
    const [result] = await pool.query(
      'INSERT INTO comentarios (postagem_id, usuario_id, autor_nome, autor_foto, texto) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, u ? u.id : 1, u ? u.nome : 'Karen', u ? u.foto : 'Images/meuamor.jpg', req.body.texto]
    );
    const [[novo]] = await pool.query('SELECT * FROM comentarios WHERE id = ?', [result.insertId]);
    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Inicialização automática do banco e start do servidor
async function iniciar() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true
    });
    const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [process.env.DB_NAME || 'adopetz']);
    if (dbs.length === 0) {
      const sql = fs.readFileSync(path.join(__dirname, 'mysql', 'Adopetz.sql'), 'utf8');
      await conn.query(sql);
      console.log('Banco MySQL "adopetz" criado e populado automaticamente!');
    }
    await conn.end();
  } catch (e) {
    console.warn('Aviso MySQL:', e.message);
  }
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}

iniciar();