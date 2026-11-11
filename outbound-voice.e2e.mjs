/**
 * End-to-end: a fake SpeechRecognition drives the real mic button.
 * Run: node outbound-voice.e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { CARRIER_NAMES, topCarriers } from './outbound-voice.js';

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
      note: marked('f_note'),
      method: document.querySelector('#methodSeg button.on-a, #methodSeg button.on-b')?.textContent || '',
      methodVoice: !!document.getElementById('methodSeg')?.closest('.field')?.classList.contains('voice-filled'),
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
  if (form.method !== 'Pickup') problems.push(`method ${form.method}`);
  if (!form.methodVoice) problems.push('method missing Voice mark');
  if (!form.summary.startsWith('Filled ')) problems.push(`summary ${form.summary}`);
  if (!form.heard.includes('all set health')) problems.push('transcript missing');
  if (!form.note.value.includes('Voice:')) problems.push(`note missing Voice line: ${form.note.value}`);
  if (!form.note.value.includes('all set health')) problems.push('note missing transcript');
  if (!form.note.voice) problems.push('note missing Voice mark');
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

const SHOT_BEFORE = '/opt/cursor/artifacts/outbound_tap_form_before_voice.png';
const SHOT_AFTER = '/opt/cursor/artifacts/outbound_tap_form_after_voice.png';
const DEMO_CARRIERS = ['Estes', 'Saia', 'Old Dominion', 'FedEx', 'Saia', 'Estes'];

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
    await runControls(type, engine);
  }
} finally {
  server.close();
}

async function openFresh(page) {
  if (await page.locator('#formOverlay').count()) {
    await page.locator('#formOverlay .panel-h [data-action="close-form"]').click();
  }
  await page.locator('.controls [data-action="new"]').click();
  await page.waitForSelector('#methodSeg');
}

async function shotForm(page, file) {
  const saved = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.panel');
    return panel && getComputedStyle(panel).opacity === '1';
  });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const panel = document.querySelector('.panel-b');
    const field = document.getElementById('methodSeg')?.closest('.field');
    const sticky = document.querySelector('.voice-wrap');
    if (!panel || !field) return;
    const stickyH = sticky ? sticky.getBoundingClientRect().height : 0;
    const top = field.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    panel.scrollTop = Math.max(0, top - stickyH - 8);
  });
  await page.screenshot({ path: file, fullPage: false, scale: 'css' });
  if (saved) await page.setViewportSize(saved);
}

async function runControls(browserType, engine) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(FAKE);
  await page.goto(`${base}/?voiceDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#methodSeg');
  if (engine === 'chromium') await shotForm(page, SHOT_BEFORE);

  const size = await page.evaluate(() => {
    const method = document.querySelector('#methodSeg button');
    const chip = document.querySelector('#carrierChips .pick-chip');
    const seg = document.getElementById('methodSeg').getBoundingClientRect();
    const btn = method.getBoundingClientRect();
    return {
      methodH: btn.height,
      methodW: btn.width,
      segW: seg.width,
      chipH: chip.getBoundingClientRect().height,
      inputmode: document.getElementById('f_qty').getAttribute('inputmode'),
      chips: [...document.querySelectorAll('#carrierChips .pick-chip')].map(el => el.dataset.v),
    };
  });
  const expectedChips = topCarriers(DEMO_CARRIERS.map(carrier => ({ carrier })), CARRIER_NAMES, 6);
  if (size.methodH < 48) throw new Error(`${engine} method button height ${size.methodH}`);
  if (size.chipH < 48) throw new Error(`${engine} carrier chip height ${size.chipH}`);
  if (size.methodW < size.segW - 4) throw new Error(`${engine} method button is not full width (${size.methodW} vs ${size.segW})`);
  if (size.inputmode !== 'numeric') throw new Error(`${engine} quantity inputmode ${size.inputmode}`);
  if (JSON.stringify(size.chips) !== JSON.stringify([...expectedChips, '__other__'])) {
    throw new Error(`${engine} chips ${size.chips.join('|')}`);
  }

  await page.locator('#methodSeg button[data-v="delivery"]').click();
  await page.locator('#methodSeg button[data-v="pickup"]').click();
  await page.locator('#methodSeg button[data-v="delivery"]').click();
  const methodOn = await page.locator('#methodSeg button.on-b').innerText();
  if (methodOn !== 'Delivery') throw new Error(`${engine} method tap ${methodOn}`);

  for (const name of expectedChips) {
    await page.locator(`#carrierChips button[data-v="${name}"]`).click();
    const got = await page.locator('#f_extra').inputValue();
    const hidden = await page.locator('#f_extra').evaluate(el => el.classList.contains('is-hidden'));
    if (got !== name || !hidden) throw new Error(`${engine} carrier ${name} -> ${got} hidden=${hidden}`);
  }
  await page.locator('#carrierChips button[data-v="__other__"]').click();
  await page.locator('#f_extra').fill('Roadrunner');
  const other = await page.evaluate(() => ({
    value: document.getElementById('f_extra').value,
    hidden: document.getElementById('f_extra').classList.contains('is-hidden'),
    on: document.querySelector('#carrierChips button[data-v="__other__"]').classList.contains('on'),
  }));
  if (other.value !== 'Roadrunner' || other.hidden || !other.on) throw new Error(`${engine} other ${JSON.stringify(other)}`);

  await page.locator('#qtyUnit button[data-v="pallets"]').click();
  await page.locator('[aria-label="Increase"]').click();
  await page.locator('[aria-label="Increase"]').click();
  await page.locator('[aria-label="Decrease"]').click();
  let cartons = await page.locator('#f_cartons').inputValue();
  let shown = await page.locator('#f_qty').inputValue();
  if (cartons !== '1 pallet' || shown !== '1') throw new Error(`${engine} pallet step ${cartons} / ${shown}`);
  await page.locator('#qtyUnit button[data-v="cartons"]').click();
  await page.locator('[aria-label="Increase"]').click();
  cartons = await page.locator('#f_cartons').inputValue();
  shown = await page.locator('#f_qty').inputValue();
  if (cartons !== '1 carton, 1 pallet' || shown !== '1') throw new Error(`${engine} carton step ${cartons} / ${shown}`);

  for (const status of ['staged', 'loaded', 'shipped', 'scheduled']) {
    await page.locator(`#statusSeg button[data-v="${status}"]`).click();
    const got = await page.locator('#f_status').inputValue();
    if (got !== status) throw new Error(`${engine} status ${status} -> ${got}`);
  }

  await openFresh(page);
  await page.locator('#f_customer').fill('Northwind Trading');
  await page.locator('#f_number').fill('PO-9001');
  await page.locator('#methodSeg button[data-v="delivery"]').click();
  await page.locator('#carrierChips button[data-v="Saia"]').click();
  await page.locator('#qtyUnit button[data-v="pallets"]').click();
  await page.locator('[aria-label="Increase"]').click();
  await page.locator('[aria-label="Increase"]').click();
  await page.locator('#statusSeg button[data-v="loaded"]').click();
  await page.locator('[data-action="save-form"]').click();
  await page.waitForFunction(() => window.__lastOutboundPayload && window.__lastOutboundPayload.reference === 'PO-9001');
  const saved = await page.evaluate(() => window.__lastOutboundPayload);
  const expectSaved = {
    customer: 'Northwind Trading',
    reference: 'PO-9001',
    carrier: 'Saia',
    cartons: '2 pallets',
    method: 'delivery',
    status: 'loaded',
  };
  for (const [key, value] of Object.entries(expectSaved)) {
    if (saved[key] !== value) throw new Error(`${engine} saved ${key} ${JSON.stringify(saved[key])} !== ${value}`);
  }

  await openFresh(page);
  await page.locator('#voiceMic').click();
  await page.waitForFunction(() => window.__rec && window.__rec.started);
  const phrase = 'all set health PO 48213 tomorrow pickup 20 pallets Estes';
  await emit(page, phrase, true);
  const stopLabel = await page.locator('#voiceMicLabel').innerText();
  if (stopLabel.includes('stop')) await page.locator('#voiceMic').click();
  await page.waitForFunction(() => document.getElementById('f_customer')?.value === 'Allsethealth');
  if (engine === 'chromium') await shotForm(page, SHOT_AFTER);
  const voiced = await page.evaluate(() => ({
    method: document.querySelector('#methodSeg button.on-a')?.textContent || '',
    methodVoice: document.getElementById('methodSeg').closest('.field').classList.contains('voice-filled'),
    methodBadge: document.getElementById('methodSeg').closest('.field').querySelector('.voice-badge')?.textContent || '',
    carrier: document.getElementById('f_extra').value,
    carrierOn: document.querySelector('#carrierChips button.on')?.dataset.v || '',
    carrierVoice: document.getElementById('f_extra').closest('.field').classList.contains('voice-filled'),
    cartons: document.getElementById('f_cartons').value,
    qty: document.getElementById('f_qty').value,
    qtyVoice: document.getElementById('f_qty').closest('.field').classList.contains('voice-filled'),
    note: document.getElementById('f_note').value,
  }));
  if (voiced.method !== 'Pickup' || !voiced.methodVoice || voiced.methodBadge !== 'Voice') throw new Error(`${engine} voice method ${JSON.stringify(voiced)}`);
  if (voiced.carrier !== 'Estes' || voiced.carrierOn !== 'Estes' || !voiced.carrierVoice) throw new Error(`${engine} voice carrier ${JSON.stringify(voiced)}`);
  if (voiced.cartons !== '20 pallets' || voiced.qty !== '20' || !voiced.qtyVoice) throw new Error(`${engine} voice qty ${JSON.stringify(voiced)}`);
  if (!voiced.note.includes('Voice:')) throw new Error(`${engine} voice note missing`);

  await page.locator('#methodSeg button[data-v="delivery"]').click();
  await page.locator('#carrierChips button[data-v="FedEx"]').click();
  await page.locator('#f_qty').fill('7');
  const overridden = await page.evaluate(() => ({
    methodVoice: document.getElementById('methodSeg').closest('.field').classList.contains('voice-filled'),
    method: document.querySelector('#methodSeg button.on-b')?.textContent || '',
    carrierVoice: document.getElementById('f_extra').closest('.field').classList.contains('voice-filled'),
    carrier: document.getElementById('f_extra').value,
    qtyVoice: document.getElementById('f_qty').closest('.field').classList.contains('voice-filled'),
    cartons: document.getElementById('f_cartons').value,
    note: document.getElementById('f_note').value,
  }));
  if (overridden.methodVoice || overridden.method !== 'Delivery') throw new Error(`${engine} override method ${JSON.stringify(overridden)}`);
  if (overridden.carrierVoice || overridden.carrier !== 'FedEx') throw new Error(`${engine} override carrier ${JSON.stringify(overridden)}`);
  if (overridden.qtyVoice || overridden.cartons !== '7 pallets') throw new Error(`${engine} override qty ${JSON.stringify(overridden)}`);
  if (!overridden.note.includes(`Voice: ${phrase}`)) throw new Error(`${engine} note lost transcript ${overridden.note}`);

  await page.locator('[data-action="save-form"]').click();
  await page.waitForFunction(() => window.__lastOutboundPayload && window.__lastOutboundPayload.reference === 'PO-48213');
  const voicedSave = await page.evaluate(() => window.__lastOutboundPayload);
  const voicedExpect = { customer: 'Allsethealth', reference: 'PO-48213', carrier: 'FedEx', method: 'delivery', cartons: '7 pallets', status: 'scheduled' };
  for (const [key, value] of Object.entries(voicedExpect)) {
    if (voicedSave[key] !== value) throw new Error(`${engine} voice saved ${key} ${JSON.stringify(voicedSave[key])} !== ${value}`);
  }
  if (!String(voicedSave.note).includes(`Voice: ${phrase}`)) throw new Error(`${engine} saved note ${voicedSave.note}`);

  await page.locator('#formOverlay .panel-h [data-action="close-form"]').click();
  await page.locator('[data-action="set-mode"][data-v="inbound"]').click();
  await page.locator('.controls [data-action="new"]').click();
  await page.waitForSelector('#f_status');
  const inbound = await page.evaluate(() => ({
    status: document.getElementById('f_status')?.tagName || '',
    extra: document.getElementById('f_extra')?.tagName || '',
    methods: [...document.querySelectorAll('.seg button')].map(el => el.textContent),
    qty: !!document.getElementById('f_qty'),
    chips: !!document.getElementById('carrierChips'),
  }));
  if (inbound.status !== 'SELECT' || inbound.extra !== 'SELECT' || inbound.qty || inbound.chips) {
    throw new Error(`${engine} inbound form changed ${JSON.stringify(inbound)}`);
  }
  if (inbound.methods.join('|') !== 'Live unload|Drop') throw new Error(`${engine} inbound methods ${inbound.methods.join('|')}`);

  await browser.close();
  console.log('ok', engine, 'tap controls');
}
