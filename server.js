const express = require('express');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const BUCKET = 'documents';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.txt', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido.'));
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.get('/style.css', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, 'public', 'style.css')));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'agross-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

function isAdmin(req) { return req.session && req.session.isAdmin; }

// ── ROTAS DO USUÁRIO ──────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/upload', upload.array('arquivos', 10), async (req, res) => {
  const { cnpj, razao_social, filial, obs } = req.body;
  if (!cnpj || !razao_social || !filial || !req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, msg: 'CNPJ, Razão Social, Filial e ao menos um arquivo são obrigatórios.' });
  }

  const submissionId = uuidv4();
  const arquivos = [];

  for (const file of req.files) {
    const ext = path.extname(file.originalname);
    const storagePath = `${submissionId}/${uuidv4()}${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype
    });
    if (error) return res.status(500).json({ ok: false, msg: 'Erro ao salvar arquivo: ' + error.message });
    arquivos.push({ original: file.originalname, path: storagePath, tamanho: file.size });
  }

  const { error } = await supabase.from('submissions').insert([{
    id: submissionId,
    cnpj,
    razao_social,
    filial,
    obs: obs || '',
    data: new Date().toISOString(),
    arquivos
  }]);

  if (error) return res.status(500).json({ ok: false, msg: 'Erro ao salvar dados: ' + error.message });
  res.json({ ok: true, msg: 'Documentos enviados com sucesso!' });
});

// ── ROTAS DO ADMIN ────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.post('/admin/login', (req, res) => {
  if (req.body.senha === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, msg: 'Senha incorreta.' });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

app.get('/admin/dados', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, msg: 'Não autorizado.' });
  const { data, error } = await supabase.from('submissions').select('*').order('data', { ascending: false });
  if (error) return res.status(500).json({ ok: false, msg: error.message });
  res.json(data);
});

app.get('/admin/download', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send('Não autorizado.');
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('Caminho inválido.');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 120);
  if (error) return res.status(404).send('Arquivo não encontrado.');
  res.redirect(data.signedUrl);
});

app.delete('/admin/excluir/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { data: entry } = await supabase.from('submissions').select('arquivos').eq('id', req.params.id).single();
  if (entry) {
    const paths = entry.arquivos.map(f => f.path);
    await supabase.storage.from(BUCKET).remove(paths);
  }
  await supabase.from('submissions').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Plataforma rodando em http://localhost:${PORT}`);
  console.log(`Painel admin: http://localhost:${PORT}/admin`);
});
