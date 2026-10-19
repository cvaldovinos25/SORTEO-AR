/**
 * Kotex RA | Backend de jugadas sobre Google Sheets
 *
 * Cada jugada ganadora genera una fila con: código único, fecha y hora (Chile),
 * tienda, góndola y, luego del registro, nombre y celular.
 * La hoja "Jugadas" se puede descargar como Excel (Archivo > Descargar > .xlsx).
 *
 * Uso: pega este archivo en Extensiones > Apps Script de tu planilla,
 * ejecuta setup() una vez y publica como "Aplicación web" (ver README).
 */

const TZ = 'America/Santiago';
const SHEET_PLAYS = 'Jugadas';
const SHEET_DRAW = 'Sorteo';
const SHEET_CONFIG = 'Config';
const MAX_CODES_PER_DEVICE_DAY = 3; // tope anti abuso por celular y día

const COLS = {CODE: 1, TS: 2, ISO: 3, CLIENT_TS: 4, STORE: 5, GONDOLA: 6, DEVICE: 7,
              NAME: 8, PHONE: 9, OPTIN: 10, STATE: 11, REGISTERED_AT: 12, UA: 13, CAMPAIGN: 14};
const HEADERS = ['Código', 'Fecha y hora (Chile)', 'Timestamp UTC', 'Hora reportada por el celular',
                 'Tienda', 'Góndola', 'Dispositivo', 'Nombre', 'Teléfono', 'Opt-in', 'Estado',
                 'Registrado en', 'User agent', 'Campaña'];
const CODE_RE = /^KTX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/* ---------------- Endpoints ---------------- */

function doGet() {
  return json_({ok: true, service: 'kotex-ra'});
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ok: false, error: 'busy'});
  }
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'play') return json_(handlePlay_(body));
    if (body.action === 'register') return json_(handleRegister_(body));
    return json_({ok: false, error: 'bad_action'});
  } catch (err) {
    return json_({ok: false, error: 'server', detail: String(err)});
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Lógica ---------------- */

function handlePlay_(b) {
  const sh = playsSheet_();
  const code = String(b.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return {ok: false, error: 'bad_code'};
  if (findRow_(sh, code)) return {ok: false, error: 'duplicate'};

  const device = clean_(b.device, 64);
  const now = new Date();
  const dayKey = day_(now);

  // Tope de códigos por dispositivo y día
  const last = sh.getLastRow();
  if (last >= 2 && device) {
    const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    let n = 0;
    rows.forEach(function (r) {
      if (String(r[COLS.DEVICE - 1]) === device && day_(r[COLS.TS - 1]) === dayKey) n++;
    });
    if (n >= MAX_CODES_PER_DEVICE_DAY) return {ok: false, error: 'limit'};
  }

  const row = new Array(HEADERS.length).fill('');
  row[COLS.CODE - 1] = code;
  row[COLS.TS - 1] = now;
  row[COLS.ISO - 1] = now.toISOString();
  row[COLS.CLIENT_TS - 1] = clean_(b.clientTs, 40);
  row[COLS.STORE - 1] = clean_(b.store, 40);
  row[COLS.GONDOLA - 1] = clean_(b.gondola, 40);
  row[COLS.DEVICE - 1] = device;
  row[COLS.STATE - 1] = 'SIN_REGISTRO';
  row[COLS.UA - 1] = clean_(b.ua, 180);
  row[COLS.CAMPAIGN - 1] = clean_(b.campaign, 60);
  sh.appendRow(row);

  return {ok: true, ts: now.toISOString(), tsLocal: fmt_(now)};
}

function handleRegister_(b) {
  const sh = playsSheet_();
  const code = String(b.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return {ok: false, error: 'bad_code'};
  const name = clean_(b.name, 80);
  const phone = normPhone_(b.phone);
  if (name.length < 2) return {ok: false, error: 'bad_name'};
  if (!phone) return {ok: false, error: 'bad_phone'};
  if (b.optin !== true) return {ok: false, error: 'no_optin'};

  const row = findRow_(sh, code);
  if (!row) return {ok: false, error: 'not_found'};

  const rec = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (rec[COLS.NAME - 1]) {
    return {ok: true, already: true, estado: rec[COLS.STATE - 1], tsLocal: fmt_(rec[COLS.TS - 1])};
  }

  // Un celular solo puede tener una participación válida por día
  const dayKey = day_(rec[COLS.TS - 1]);
  const last = sh.getLastRow();
  const all = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  let dup = false;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (String(r[COLS.PHONE - 1]) === phone && r[COLS.STATE - 1] === 'VALIDA' &&
        day_(r[COLS.TS - 1]) === dayKey) { dup = true; break; }
  }
  const estado = dup ? 'DUPLICADA' : 'VALIDA';
  sh.getRange(row, COLS.NAME, 1, 3).setValues([[name, phone, 'SI']]);
  sh.getRange(row, COLS.STATE, 1, 2).setValues([[estado, new Date()]]);
  return {ok: true, estado: estado, tsLocal: fmt_(rec[COLS.TS - 1])};
}

/* ---------------- Preparación y sorteo (menú de la planilla) ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kotex')
    .addItem('Preparar hojas (una sola vez)', 'setup')
    .addItem('Sortear ganadoras', 'sortear')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SSID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);

  let sh = ss.getSheetByName(SHEET_PLAYS) || ss.insertSheet(SHEET_PLAYS);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#ece3fa');
  sh.setFrozenRows(1);
  sh.getRange(2, COLS.TS, sh.getMaxRows() - 1, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  sh.getRange(2, COLS.REGISTERED_AT, sh.getMaxRows() - 1, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  sh.getRange(2, COLS.PHONE, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  sh.getRange(2, COLS.DEVICE, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  sh.setColumnWidth(COLS.CODE, 140);
  sh.setColumnWidth(COLS.TS, 160);

  let dr = ss.getSheetByName(SHEET_DRAW) || ss.insertSheet(SHEET_DRAW);
  dr.getRange(1, 1, 1, 8).setValues([['Fecha del sorteo', 'Puesto', 'Tipo', 'Código', 'Nombre',
                                      'Teléfono', 'Tienda', 'Hora de la jugada']])
    .setFontWeight('bold').setBackground('#ece3fa');
  dr.setFrozenRows(1);

  let cf = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  cf.getRange('A1:A2').setValues([['Considerar jugadas desde (fecha y hora, opcional)'],
                                  ['Considerar jugadas hasta (fecha y hora, opcional)']]);
  cf.getRange('B1:B2').setNumberFormat('dd-mm-yyyy hh:mm:ss');
  cf.setColumnWidth(1, 380);

  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function sortear() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Sorteo Kotex', '¿Cuántas ganadoras?', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const nWin = parseInt(r1.getResponseText(), 10);
  const r2 = ui.prompt('Sorteo Kotex', '¿Cuántas suplentes?', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const nSub = parseInt(r2.getResponseText(), 10);
  if (!(nWin > 0) || !(nSub >= 0)) { ui.alert('Ingresa números válidos.'); return; }

  const ss = ss_();
  const sh = ss.getSheetByName(SHEET_PLAYS);
  const cfg = ss.getSheetByName(SHEET_CONFIG);
  const from = cfg.getRange('B1').getValue();
  const to = cfg.getRange('B2').getValue();
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];

  const pool = rows.filter(function (r) {
    if (r[COLS.STATE - 1] !== 'VALIDA') return false;
    const t = r[COLS.TS - 1];
    if (from instanceof Date && t < from) return false;
    if (to instanceof Date && t > to) return false;
    return true;
  });
  if (pool.length < nWin + nSub) {
    ui.alert('Hay ' + pool.length + ' participaciones válidas, menos de las ' + (nWin + nSub) + ' que pediste.');
    return;
  }

  // Fisher-Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  const picks = pool.slice(0, nWin + nSub);
  const now = new Date();
  const out = picks.map(function (r, i) {
    return [now, i + 1, i < nWin ? 'Ganadora' : 'Suplente', r[COLS.CODE - 1], r[COLS.NAME - 1],
            String(r[COLS.PHONE - 1]), r[COLS.STORE - 1], r[COLS.TS - 1]];
  });
  const dr = ss.getSheetByName(SHEET_DRAW);
  const start = dr.getLastRow() + 1;
  dr.getRange(start, 1, out.length, 8).setValues(out);
  dr.getRange(start, 1, out.length, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  dr.getRange(start, 8, out.length, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  dr.getRange(start, 6, out.length, 1).setNumberFormat('@');
  ui.alert('Sorteo listo', 'Se registraron ' + nWin + ' ganadoras y ' + nSub + ' suplentes en la hoja "Sorteo".', ui.ButtonSet.OK);
}

/* ---------------- Auxiliares ---------------- */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SSID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function playsSheet_() {
  const sh = ss_().getSheetByName(SHEET_PLAYS);
  if (!sh) throw new Error('Falta la hoja Jugadas. Ejecuta setup().');
  return sh;
}
function findRow_(sh, code) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const f = sh.getRange(2, COLS.CODE, last - 1, 1).createTextFinder(code)
    .matchEntireCell(true).matchCase(true).findNext();
  return f ? f.getRow() : 0;
}
function normPhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.indexOf('56') === 0) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? d : null;
}
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas inyectadas
  return s;
}
function fmt_(d) { return Utilities.formatDate(new Date(d), TZ, 'dd-MM-yyyy HH:mm:ss'); }
function day_(d) { return Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd'); }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
