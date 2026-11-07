const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || '213773760420').replace(/\D/g, '');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGE_DIR = path.join(__dirname, 'public', 'images');
const DB_FILE = path.join(DATA_DIR, 'products.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

function readProducts() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function saveProducts(items) { fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2)); }
function telegram(method, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST', headers: {'Content-Type': 'application/json'}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) return reject(new Error(parsed.description || 'Telegram API error'));
          resolve(parsed.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body)); req.end();
  });
}
function parsePost(post) {
  const caption = (post.caption || '').trim();
  const lines = caption.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const title = lines[0] || 'منتج جديد';
  const priceMatch = caption.match(/(?:السعر\s*[:：]?\s*)?([\d][\d\s.,]*)\s*(?:دج|د\.ج|DA|دنانير)/i);
  const price = priceMatch ? priceMatch[1].replace(/\s/g, '').replace(/,/g, '') : '';
  const description = lines.slice(1).join('\n') || caption || 'منتج جديد من بزناسة العلمة للجملة';
  const photo = post.photo && post.photo.length ? post.photo[post.photo.length - 1].file_id : null;
  return { title, price, description, photoFileId: photo, telegramMessageId: post.message_id };
}
async function saveTelegramPhoto(fileId, productId) {
  const info = await telegram('getFile', { file_id: fileId });
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`;
  const target = path.join(IMAGE_DIR, `${productId}.jpg`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    https.get(fileUrl, response => {
      if (response.statusCode !== 200) return reject(new Error('Could not download Telegram image'));
      response.pipe(out); out.on('finish', () => out.close(resolve));
    }).on('error', reject);
  });
  return `/images/${productId}.jpg`;
}
app.post('/telegram/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET)
    return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const post = req.body.channel_post;
    if (!post) return;
    const product = parsePost(post);
    const id = `${post.chat.id}_${post.message_id}`;
    if (product.photoFileId) product.image = await saveTelegramPhoto(product.photoFileId, id);
    else product.image = '';
    const products = readProducts();
    const existing = products.findIndex(p => p.id === id);
    const record = {
      id, title: product.title, price: product.price, description: product.description,
      image: product.image, createdAt: new Date((post.date || Date.now()/1000)*1000).toISOString(),
      telegramLink: `https://t.me/${(post.chat.username || '').replace('@','')}/${post.message_id}`
    };
    if (existing >= 0) products[existing] = record; else products.unshift(record);
    saveProducts(products);
  } catch (err) { console.error('Telegram sync error:', err.message); }
});
app.get('/api/products', (req, res) => res.json(readProducts()));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({ whatsappNumber: WHATSAPP_NUMBER }));

app.post('/setup-webhook', async (req, res) => {
  if (!BOT_TOKEN) return res.status(400).json({error:'Set TELEGRAM_BOT_TOKEN first'});
  const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!baseUrl) return res.status(400).json({error:'Set APP_URL to your deployed HTTPS URL'});
  try {
    const result = await telegram('setWebhook', {
      url: `${baseUrl}/telegram/webhook`,
      ...(WEBHOOK_SECRET ? {secret_token: WEBHOOK_SECRET} : {}),
      allowed_updates: ['channel_post']
    });
    res.json({ok:true, result});
  } catch (e) { res.status(500).json({error:e.message}); }
});

app.listen(PORT, async () => {
  console.log(`Catalog running on port ${PORT}`);

  if (!BOT_TOKEN) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is missing');
    return;
  }

  const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  if (!baseUrl) {
    console.error('ERROR: APP_URL is missing');
    return;
  }

  try {
    const result = await telegram('setWebhook', {
      url: `${baseUrl}/telegram/webhook`,
      ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
      allowed_updates: ['channel_post']
    });

    console.log('TELEGRAM WEBHOOK CONFIGURED:', result);
  } catch (error) {
    console.error('WEBHOOK ERROR:', error.message);
  }
});
