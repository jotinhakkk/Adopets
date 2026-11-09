-- ============================================================================
-- SCRIPT SQL COMPLETO - PROJETO ADOPETZ (FOCO NO CÓDIGO)
-- ============================================================================

DROP DATABASE IF EXISTS adopetz;
CREATE DATABASE IF NOT EXISTS adopetz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adopetz;

-- 1. Tabela de Super Administrador
CREATE TABLE IF NOT EXISTS super_administrador (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cep CHAR(12) NOT NULL,
    cpf CHAR(14) NOT NULL UNIQUE,
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 2. Tabela de Administrador
CREATE TABLE IF NOT EXISTS administrador (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cep CHAR(12) NOT NULL,
    cpf CHAR(14) NOT NULL UNIQUE,
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 3. Tabela de Clientes (Usuários)
CREATE TABLE IF NOT EXISTS usuario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cpf CHAR(14) NOT NULL UNIQUE,
    telefone VARCHAR(20) NOT NULL,
    cep CHAR(12) NOT NULL,
    senha VARCHAR(255) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    estado CHAR(2) NOT NULL DEFAULT 'RJ',
    genero VARCHAR(20) DEFAULT 'outro',
    endereco VARCHAR(255) DEFAULT 'Rua das Flores, 123 - Rio de Janeiro',
    foto VARCHAR(255) DEFAULT 'Images/meuamor.jpg',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    datanasc DATE NOT NULL
) ENGINE=InnoDB;

-- 4. Tabela de Animais / Anúncios
CREATE TABLE IF NOT EXISTS animais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    imagem_data LONGTEXT NOT NULL,
    anuncio_nome VARCHAR(255) NOT NULL,
    descricao TEXT NOT NULL,
    raca VARCHAR(100) NOT NULL,
    data_nascimento DATE NOT NULL,
    coloracao VARCHAR(100) NOT NULL,
    vacinado VARCHAR(10) NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'Cachorro',
    localidade CHAR(2) NOT NULL DEFAULT 'RJ',
    porte VARCHAR(50) NOT NULL DEFAULT 'Médio',
    status_anuncio ENUM('ATIVO', 'ADOTADO', 'ENCERRADO') NOT NULL DEFAULT 'ATIVO',
    data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ano_registro INT GENERATED ALWAYS AS (YEAR(data_registro)) STORED,
    idade INT NOT NULL,
    usuario_id INT,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Tabela de Chats
CREATE TABLE IF NOT EXISTS chats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    animal_id INT NOT NULL,
    adotante_id INT NOT NULL,
    anunciante_id INT NOT NULL,
    data_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (adotante_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (anunciante_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (animal_id) REFERENCES animais(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Tabela de Mensagens
CREATE TABLE IF NOT EXISTS mensagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chat_id INT NOT NULL,
    remetente_id INT NOT NULL,
    mensagem TEXT NOT NULL,
    data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (remetente_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Tabela de Adoção
CREATE TABLE IF NOT EXISTS adocao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_animal INT NOT NULL,
    animal_nome VARCHAR(255) NOT NULL,
    animal_raca VARCHAR(100) NOT NULL,
    adotante_id INT NOT NULL,
    Status ENUM('Pendente', 'Aprovada', 'Rejeitada') NOT NULL DEFAULT 'Aprovada',
    anunciante_id INT NOT NULL,
    adotante_nome VARCHAR(255),
    adotante_cpf VARCHAR(50),
    anunciante_nome VARCHAR(255),
    anunciante_cpf VARCHAR(50),
    data_adocao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (adotante_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (anunciante_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (id_animal) REFERENCES animais(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Tabela de Avaliações
CREATE TABLE IF NOT EXISTS avaliacao (
    Idavaliacao INT AUTO_INCREMENT PRIMARY KEY,
    Comentario TEXT,
    usuario_id INT,
    adocao_id INT,
    Data TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (adocao_id) REFERENCES adocao(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. Tabelas do Blog PetSocial (Postagens, Curtidas e Comentários)
CREATE TABLE IF NOT EXISTS postagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT,
    autor_nome VARCHAR(100) NOT NULL,
    autor_foto VARCHAR(255) DEFAULT 'Images/meuamor.jpg',
    texto LONGTEXT NOT NULL,
    imagem_url TEXT,
    tags VARCHAR(255) DEFAULT '',
    num_curtidas INT DEFAULT 0,
    fixado TINYINT(1) DEFAULT 0,
    link_externo VARCHAR(255) DEFAULT NULL,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comentarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    postagem_id INT NOT NULL,
    usuario_id INT,
    autor_nome VARCHAR(100) NOT NULL,
    autor_foto VARCHAR(255) DEFAULT 'Images/meuamor.jpg',
    texto TEXT NOT NULL,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (postagem_id) REFERENCES postagens(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 10. Tabela de Eventos do Calendário
CREATE TABLE IF NOT EXISTS eventos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(100) NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'adoção',
    descricao VARCHAR(255) NOT NULL,
    local VARCHAR(150) NOT NULL,
    data_evento DATE NOT NULL
) ENGINE=InnoDB;

-- 11. Tabela de ONGs Parceiras (colaboradores.html)
CREATE TABLE IF NOT EXISTS ongs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    cnpj VARCHAR(25) NOT NULL,
    email VARCHAR(150) NOT NULL,
    telefone VARCHAR(30),
    cidade VARCHAR(100),
    descricao TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================================
-- CARGA INICIAL DE DADOS
-- ============================================================================

INSERT INTO super_administrador (nome, cep, cpf, telefone, email, senha) 
VALUES ('João Souza', '12345-678', '12134522122', '11223452222', 'admin123@admin', 'senha123');

INSERT INTO administrador (nome, cep, cpf, telefone, email, senha) 
VALUES ('João Souza', '12345-678', '11134522122', '11223452222', 'admin@admin.com', 'senha123');

INSERT INTO usuario (id, nome, cpf, telefone, cep, senha, email, estado, genero, endereco, foto, datanasc) VALUES
(1, 'Karen', '181.612.667-25', '(21) 97743-1548', '22290-240', 'senha123', 'karenzinha123@email.com', 'RJ', 'feminino', 'Rua das Flores, 123 - Rio de Janeiro', 'Images/meuamor.jpg', '2006-05-15'),
(2, 'Carlos Silva', '123.456.789-00', '(11) 98765-4321', '12345-678', 'senha_cliente', 'carlos@cliente.com', 'SP', 'masculino', 'Av. Paulista, 1000 - São Paulo', 'Images/cliente.png', '1985-02-15'),
(3, 'Mariana Souza Lima', '526.018.159-06', '(21) 98801-1001', '22270-010', 'senha123', 'mariana.lima@email.com', 'RJ', 'feminino', 'Rua Voluntários da Pátria, 120, Botafogo - RJ', 'Images/cliente.png', '1998-07-20');

INSERT INTO animais (id, imagem_data, anuncio_nome, descricao, raca, data_nascimento, coloracao, vacinado, tipo, localidade, porte, status_anuncio, idade, usuario_id) VALUES
(1, 'Images/cachorro1.png', 'Beto – O Aventureiro de Quatro Patas', 'Beto é um vira-lata caramelo de 2 anos, cheio de energia e amor pra dar. Ama passear, correr no parque e brincar com bolinhas. Ideal para famílias ativas ou alguém que curta um bom companheiro para caminhadas. Castrado, vacinado e pronto para amar!', 'Vira-lata', '2023-05-10', 'Caramelo', 'Não', 'Cachorro', 'RJ', 'Médio', 'ATIVO', 2, 1),
(2, 'Images/cachorro2.png', 'Bob – O Bulldog Carinhoso', 'Bob é um bulldog inglês de 3 anos com aquele jeitão ranzinza de aparência, mas um coração mole que derrete qualquer um. Ama cochilar no sofá, receber carinho na barriga e fazer companhia em dias preguiçosos. Se dá bem com outros animais e é extremamente dócil com crianças.', 'Buldogue-Ingles', '2023-02-16', 'Branco e Preto', 'Sim', 'Cachorro', 'SP', 'Médio', 'ATIVO', 2, 1),
(3, 'Images/gato1.png', 'Tomás – O Rei da Soneca', 'Tomás tem 3 anos e ama uma janela ensolarada. É daqueles gatinhos que ronronam só de você chegar perto. Muito sociável com humanos, mas prefere ser filho único felino. Está castrado, vacinado e é FIV/FeLV negativo.', 'Siames', '2022-03-15', 'Cinza', 'Sim', 'Gato', 'SP', 'Pequeno', 'ATIVO', 3, 2),
(4, 'Images/gato2.png', 'Nina – A Exploradora Silenciosa', 'Com apenas 1 ano, Nina é curiosa, elegante e independente. Gosta de cantinhos altos e brinquedos com penas. Perfeita para quem quer um pet com personalidade, mas também com carinho nos momentos certos.', 'Siames', '2024-03-15', 'Laranja', 'Sim', 'Gato', 'RJ', 'Pequeno', 'ATIVO', 1, 1),
(5, 'Images/coelho1.png', 'Lua – A Encantadora de Nariz Rosa', 'Lua é uma coelhinha de 1 ano, branca com manchinhas cinza, super dócil e sociável. Ama cenourinhas, colo e um espaço para pular livremente. Já está castrada e acostumada com uso de bandeja higiênica.', 'Rex', '2024-03-15', 'Branca e Cinza', 'Sim', 'Outros', 'MG', 'Pequeno', 'ATIVO', 1, 3),
(6, 'Images/coelho2.png', 'Tico – O Saltitante Curioso', 'Tico tem 1 ano e é um coelho macho mini-lop. Adora explorar ambientes, subir em almofadas e interagir com humanos. Muito inteligente e já responde ao nome quando escuta o som do pote de comida.', 'Holland Lop', '2024-03-15', 'Branco e Marrom', 'Sim', 'Outros', 'MG', 'Pequeno', 'ATIVO', 1, 3),
(7, 'Images/rato1.png', 'Pipoca – Um Grãozinho de Alegria', 'Pequenino e hiperativo, o Pipoca adora escalar, roer e correr na rodinha. Tem 3 meses e já está acostumado a receber petiscos direto da mão. Ótimo para crianças acompanhadas pelos pais.', 'Sírio', '2024-03-15', 'Bege', 'Sim', 'Outros', 'SP', 'Pequeno', 'ATIVO', 1, 2),
(8, 'Images/rato2.png', 'Bolinha – A Fofura Noturna', 'Bolinha tem 5 meses e é do tipo mais calminho. Gosta de fazer ninhos com papel e tirar longas sonecas durante o dia. Está saudável, come bem e ama esconder petiscos. Ideal para lares tranquilos.', 'Sírio', '2024-03-15', 'Cinza', 'Sim', 'Outros', 'RJ', 'Pequeno', 'ATIVO', 1, 1);

INSERT INTO chats (id, animal_id, adotante_id, anunciante_id) VALUES
(1, 1, 3, 1),
(2, 3, 1, 2);

INSERT INTO mensagens (chat_id, remetente_id, mensagem) VALUES
(1, 3, 'Olá! Tenho interesse em adotar o Beto. Ele ainda está disponível?'),
(1, 1, 'Oi Mariana! Está disponível sim, podemos combinar uma visita.'),
(2, 1, 'Olá Carlos! Gostaria de saber mais sobre o Tomás.');

INSERT INTO postagens (id, usuario_id, autor_nome, autor_foto, texto, imagem_url, tags, num_curtidas, fixado, link_externo) VALUES
(1, NULL, 'Admin PetSocial', 'https://randomuser.me/api/portraits/men/1.jpg', '🌟 Nova Campanha de Adoção em andamento! Conheça os pets disponíveis e ajude a compartilhar.', 'https://images.unsplash.com/photo-1555685812-4b943f1cb0eb?auto=format&fit=crop&w=800&q=80', '#cachorro', 18, 1, 'https://carioca.rio/servicos/smpda-campanha-municipal-de-adocao-adote-um-amigo/'),
(2, 3, 'Lucia Brito', 'https://randomuser.me/api/portraits/women/44.jpg', 'Hoje foi só por aqui relaxando 🧃', 'https://placedog.net/800/300?id=2', '#passeio', 12, 0, NULL),
(3, 2, 'Marcos Jorge', 'https://randomuser.me/api/portraits/men/46.jpg', 'Meus Filinhos 🐶🐱', 'Images/cachorro1.png', '#cachorro', 25, 0, NULL),
(4, 1, 'Karen', 'Images/meuamor.jpg', 'Hoje foi dia de passeio no parque! 🐾☀️', 'Images/cachorro2.png', '#passeio #cachorro', 15, 0, NULL);

INSERT INTO eventos (titulo, tipo, descricao, local, data_evento) VALUES
('Campanha de Adoção', 'adoção', 'Feira de adoção com mais de 30 pets disponíveis.', 'Praça Central, Bairro Jardim', '2025-06-05'),
('Vacinação Gratuita', 'vacinação', 'Vacinas básicas para cães e gatos.', 'UBS Animal - Rua das Flores, 88', '2025-06-12'),
('Workshop de Primeiros Socorros', 'workshop', 'Aprenda como socorrer seu pet em emergências.', 'Auditório da Faculdade PetAmigos', '2025-06-18'),
('Feira de Adoção do Flamengo', 'adoção', 'Feira com animais resgatados disponíveis para adoção responsável.', 'Parque do Flamengo, Rio de Janeiro', '2026-10-25'),
('Palestra sobre Guarda Responsável', 'workshop', 'Palestra gratuita sobre cuidados básicos e saúde animal.', 'Auditório CCET UNIRIO, Urca', '2026-10-30'),
('Campanha de Vacinação Antirrábica', 'vacinação', 'Vacinação gratuita para cães e gatos a partir de três meses.', 'Praça Saens Peña, Tijuca', '2026-11-08'),
('Mutirão de Castração Gratuita', 'vacinação', 'Atendimento por ordem de chegada com cadastro prévio.', 'Quinta da Boa Vista, São Cristóvão', '2026-11-15'),
('Natal Solidário Pet', 'doação', 'Arrecadação de ração e cobertores e feira de adoção.', 'Shopping Madureira, Madureira', '2026-12-12');
