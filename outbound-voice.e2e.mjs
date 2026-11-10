/**
 * End-to-end: a fake SpeechRecognition drives the real mic button.
 * Run: node outbound-voice.e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const CASES = [
  {
    name: 'estes after the name',
    phrase: 'all set health PO 48213 tomorrow pickup 20 pallets Estes',
    reference: 'PO-48213',
  },
  {
    name: 'estes before the name',
    phrase: 'Estes pickup 20 pallets tomorrow PO 48213 all set health',
    reference: 'PO-48213',
  },
  {
    name: 'spanish recogida',
    phrase: 'all set health PO 48213 mañana recogida 20 tarimas Estes',
    reference: 'PO-48213',
  },
  {
    name: 'chinese pickup',
    phrase: 'Estes 自提 20托盘 明天 订单号 48213 all set health',
    reference: '48213',
  },
];

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const type = file.endsWith('.js') ? 'text/javascript' : 'text/html';
      res.writeHead(200, { 'content-type': type });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const FAKE = () => {
  const Ctor = class FakeSpeech {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = ''; }
    start() { window.__rec = this; this.started = true; }
    stop() { this.stopped = true; /* phones often never fire onend here */ }
    abort() { this.aborted = true; }
  };
  window.SpeechRecognition = Ctor;
  window.webkitSpeechRecognition = Ctor;
};

function emit(page, text, isFinal) {
  return page.evaluate(({ text, isFinal }) => {
    const rec = window.__rec;
    if (!rec || !rec.onresult) throw new Error('recognition is not listening');
    const list = [{ 0: { transcript: text }, isFinal, length: 1 }];
    list.length = 1;
    rec.onresult({ results: list });
  }, { text, isFinal });
}

async function readForm(page) {
  return page.evaluate(() => {
    const marked = name => {
      const input = document.getElementById(name);
      const field = input && input.closest('.field');
      return {
        value: input ? input.value : '',
        voice: !!(field && field.classList.contains('voice-filled')),
        check: !!(field && field.classList.contains('voice-check')),
      };
    };
    return {
      customer: marked('f_customer'),
      reference: marked('f_number'),
      carrier: marked('f_extra'),
      date: marked('f_date'),
      cartons: marked('f_cartons'),
      method: document.querySelector('.seg button.on-a')?.textContent || '',
      methodVoice: !!document.querySelector('.seg')?.closest('.field')?.classList.contains('voice-filled'),
      summary: document.getElementById('voiceSummary')?.textContent || '',
      chips: [...document.querySelectorAll('.cust-chip')].map(b => b.textContent),
      heard: document.getElementById('voiceHeardText')?.textContent || '',
    };
  });
}

function assertFilled(form, label, spec) {
  const problems = [];
  if (form.customer.value !== 'Allsethealth') problems.push(`customer ${form.customer.value}`);
  if (!form.customer.voice) problems.push('customer missing Voice mark');
  if (!form.chips.includes('Allsethealth')) problems.push('missing Allsethealth chip');
  if (form.reference.value !== spec.reference) problems.push(`reference ${form.reference.value}`);
  if (!form.reference.voice) problems.push('reference missing Voice mark');
  if (form.carrier.value !== 'Estes') problems.push(`carrier ${form.carrier.value}`);
  if (!form.carrier.voice) problems.push('carrier missing Voice mark');
  if (form.date.value !== tomorrowISO()) problems.push(`date ${form.date.value}`);
  if (!form.date.voice) problems.push('date missing Voice mark');
  if (form.cartons.value !== '20 pallets') problems.push(`cartons ${form.cartons.value}`);
  if (!form.cartons.voice) problems.push('cartons missing Voice mark');
  if (form.method !== 'Carrier pickup') problems.push(`method ${form.method}`);
  if (!form.methodVoice) problems.push('method missing Voice mark');
  if (!form.summary.startsWith('Filled ')) problems.push(`summary ${form.summary}`);
  if (!form.heard.includes('all set health')) problems.push('transcript missing');
  if (problems.length) throw new Error(`${label}: ${problems.join('; ')} | ${JSON.stringify(form)}`);
}

async function runCase(browserType, name, phrase, drive) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
  const page = await context.newPage();
  await page.addInitScript(FAKE);
  await page.goto(`${base}/?voiceDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#voiceMic');
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.click('#voiceMic');
  await page.waitForFunction(() => window.__rec && window.__rec.started);
  await drive(page);
  const label = await page.$eval('#voiceMicLabel', el => el.textContent || '');
  if (label.includes('stop')) await page.click('#voiceMic');
  await page.waitForFunction(() => (document.getElementById('f_customer')?.value || '') === 'Allsethealth');
  const form = await readForm(page);
  assertFilled(form, name, { reference: phrase.reference });
  if (errors.length) throw new Error(errors.join('\n'));
  await browser.close();
  console.log('ok', name);
}

let base;
const server = await startServer();
base = `http://127.0.0.1:${server.address().port}`;

try {
  for (const [type, engine] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
    for (const spec of CASES) {
      await runCase(type, `${engine} ${spec.name}`, spec, async page => {
        await emit(page, spec.phrase.slice(0, 14), false);
        await emit(page, spec.phrase, true);
      });
    }
    const exact = CASES[0];
    await runCase(type, `${engine} onend-first ${exact.name}`, exact, async page => {
      await page.evaluate(() => window.__rec.onend && window.__rec.onend());
      await emit(page, exact.phrase, false);
    });
  }
} finally {
  server.close();
}
