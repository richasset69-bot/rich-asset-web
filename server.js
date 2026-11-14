// Rich Asset Manager — เว็บเซิร์ฟเวอร์ + API รับใบขอเสนอราคา
// ส่งข้อมูลเข้าอีเมล (SMTP) และ LINE Official Account (Messaging API) พร้อมกัน
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ---------- helpers ----------
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465, // 465 = SSL, 587 = STARTTLS
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function buildText(q) {
  return [
    '📩 มีคำขอใบเสนอราคาใหม่',
    `ชื่อ: ${q.name}`,
    `โทร: ${q.phone}`,
    q.email ? `อีเมล: ${q.email}` : null,
    `โครงการ: ${q.project}`,
    q.type ? `ประเภท: ${q.type}` : null,
    q.units ? `จำนวนหน่วย: ${q.units}` : null,
    q.services.length ? `บริการ: ${q.services.join(', ')}` : null,
    q.message ? `รายละเอียด: ${q.message}` : null,
    `เวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`
  ].filter(Boolean).join('\n');
}

async function sendEmail(q, text) {
  if (!process.env.SMTP_HOST || !process.env.MAIL_TO) throw new Error('SMTP not configured');
  const html = `<pre style="font-family:Tahoma,sans-serif;font-size:15px">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`;
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    replyTo: q.email || undefined,
    subject: `[ใบขอเสนอราคา] ${q.project} — ${q.name}`,
    text,
    html
  });
}

async function sendLine(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TO_ID; // userId, groupId หรือ roomId
  if (!token || !to) throw new Error('LINE not configured');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: text.slice(0, 4900) }]
    })
  });
  if (!res.ok) throw new Error(`LINE responded ${res.status}: ${await res.text()}`);
}

// ---------- API ----------
app.post('/api/quote', async (req, res) => {
  const b = req.body || {};

  // honeypot: บอทมักกรอกช่องที่ซ่อนไว้ ให้ตอบว่าสำเร็จแต่ไม่ส่งจริง
  if (b.website) return res.json({ ok: true });

  const q = {
    name: clean(b.name, 120),
    phone: clean(b.phone, 30),
    email: clean(b.email, 120),
    project: clean(b.project, 200),
    type: clean(b.type, 60),
    units: clean(b.units, 20),
    services: Array.isArray(b.services) ? b.services.map(s => clean(s, 80)).slice(0, 20) : [],
    message: clean(b.message, 2000)
  };

  if (!q.name || !q.phone || !q.project) {
    return res.status(400).json({ ok: false, error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' });
  }
  if (!/^[0-9+\-\s()]{9,15}$/.test(q.phone)) {
    return res.status(400).json({ ok: false, error: 'รูปแบบเบอร์โทรไม่ถูกต้อง' });
  }
  if (q.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) {
    return res.status(400).json({ ok: false, error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }

  const text = buildText(q);
  const results = await Promise.allSettled([sendEmail(q, text), sendLine(text)]);
  const failed = results.filter(r => r.status === 'rejected');

  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[quote] ${i === 0 ? 'email' : 'line'} failed:`, r.reason.message);
  });

  // ถ้าช่องทางใดช่องทางหนึ่งสำเร็จ ถือว่ารับเรื่องแล้ว ไม่ให้ลูกค้าต้องส่งซ้ำ
  if (failed.length === results.length) {
    return res.status(502).json({ ok: false, error: 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่' });
  }
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Rich Asset Manager running at http://localhost:${PORT}`));
