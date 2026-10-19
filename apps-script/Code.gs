/**
 * Kotex RA | Backend de jugadas sobre Google Sheets
 *
 * Reglas del concurso que implementa este script:
 *  - Cada persona juega UNA sola vez (1 jugada por dispositivo y 1 participación válida por celular).
 *  - Cada jugada recibe un código único, la hora oficial de Chile y su puntaje.
 *  - En el sorteo, cada punto es un boleto: más puntaje = más probabilidad de ganar.
 *
 * La hoja "Jugadas" se puede descargar como Excel (Archivo > Descargar > .xlsx).
 * Uso: pega este archivo en Extensiones > Apps Script de tu planilla,
 * ejecuta setup() una vez y publica como "Aplicación web" (ver README).
 */

const TZ = 'America/Santiago';
const SHEET_PLAYS = 'Jugadas';
const SHEET_DRAW = 'Sorteo';
const SHEET_CONFIG = 'Config';
const MAX_PLAYS_PER_DEVICE = 1;   // solo se puede jugar 1 vez
const SCORE_MAX = 500;            // = ROUNDS * MAX_PER_ROUND en index.html (5 x 100)

const COLS = {CODE: 1, TS: 2, ISO: 3, CLIENT_TS: 4, STORE: 5, GONDOLA: 6, DEVICE: 7,
              NAME: 8, PHONE: 9, OPTIN: 10, STATE: 11, REGISTERED_AT: 12, UA: 13, CAMPAIGN: 14,
              SCORE: 15};
const HEADERS = ['Código', 'Fecha y hora (Chile)', 'Timestamp UTC', 'Hora reportada por el celular',
                 'Tienda', 'Góndola', 'Dispositivo', 'Nombre', 'Teléfono', 'Opt-in', 'Estado',
                 'Registrado en', 'User agent', 'Campaña', 'Puntaje'];
const CODE_RE = /^KTX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/* ---------------- Endpoints ---------------- */

function doGet() {
  // Sirve para verificar la conexión: abre la URL /exec en el navegador o usa ?debug=1 en la página
  try {
    const sh = playsSheet_();
    return json_({ok: true, service: 'kotex-ra', sheet: SHEET_PLAYS, rows: Math.max(0, sh.getLastRow() - 1)});
  } catch (err) {
    return json_({ok: false, service: 'kotex-ra', error: 'no_sheet', detail: String(err)});
  }
}

/** Escribe una jugada de prueba, la borra y avisa. Ejecútala desde el editor o el menú Kotex. */
function probarConexion() {
  const sh = playsSheet_();
  const code = 'KTX-TEST-2345';
  const before = sh.getLastRow();
  const res = handlePlay_({code: code, store: 'PRUEBA', gondola: 'PRUEBA', device: 'prueba-' + Date.now(),
                           clientTs: new Date().toISOString(), ua: 'probarConexion', campaign: 'PRUEBA', score: 1});
  const row = findRow_(sh, code);
  if (row) sh.deleteRow(row);
  const msg = res.ok ? 'Conexión OK: se escribió y borró una fila de prueba (' + res.tsLocal + ').'
                     : 'Falló la prueba: ' + JSON.stringify(res);
  Logger.log(msg + ' Filas antes: ' + before);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
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

  const score = Math.round(Number(b.score));
  if (!isFinite(score) || score < 0 || score > SCORE_MAX) return {ok: false, error: 'bad_score'};

  const device = clean_(b.device, 64);
  const now = new Date();

  // Solo 1 jugada por dispositivo
  const last = sh.getLastRow();
  if (last >= 2 && device) {
    const devs = sh.getRange(2, COLS.DEVICE, last - 1, 1).getValues();
    let n = 0;
    for (let i = 0; i < devs.length; i++) if (String(devs[i][0]) === device) n++;
    if (n >= MAX_PLAYS_PER_DEVICE) return {ok: false, error: 'limit'};
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
  row[COLS.SCORE - 1] = score;
  sh.appendRow(row);

  return {ok: true, ts: now.toISOString(), tsLocal: fmt_(now), score: score};
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

  // Un mismo celular solo puede tener una participación válida en toda la campaña
  const last = sh.getLastRow();
  const all = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  let dup = false;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (String(r[COLS.PHONE - 1]) === phone && r[COLS.STATE - 1] === 'VALIDA') { dup = true; break; }
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
    .addItem('Probar conexión', 'probarConexion')
    .addItem('Sortear ganadoras (por puntaje)', 'sortear')
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
  dr.getRange(1, 1, 1, 9).setValues([['Fecha del sorteo', 'Puesto', 'Tipo', 'Código', 'Nombre',
                                      'Teléfono', 'Tienda', 'Hora de la jugada', 'Puntaje (boletos)']])
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

/**
 * Sorteo ponderado: cada participante válida tiene tantos boletos como puntos obtuvo (mínimo 1).
 * Probabilidad de ser elegida = sus boletos / boletos de todas las participantes.
 */
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

  const picks = weightedPick_(pool, nWin + nSub);
  const now = new Date();
  const out = picks.map(function (r, i) {
    return [now, i + 1, i < nWin ? 'Ganadora' : 'Suplente', r[COLS.CODE - 1], r[COLS.NAME - 1],
            String(r[COLS.PHONE - 1]), r[COLS.STORE - 1], r[COLS.TS - 1], weight_(r)];
  });
  const dr = ss.getSheetByName(SHEET_DRAW);
  const start = dr.getLastRow() + 1;
  dr.getRange(start, 1, out.length, 9).setValues(out);
  dr.getRange(start, 1, out.length, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  dr.getRange(start, 8, out.length, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss');
  dr.getRange(start, 6, out.length, 1).setNumberFormat('@');
  let tickets = 0;
  pool.forEach(function (r) { tickets += weight_(r); });
  ui.alert('Sorteo listo', 'Participaron ' + pool.length + ' personas con ' + tickets + ' boletos en total. ' +
           'Se registraron ' + nWin + ' ganadoras y ' + nSub + ' suplentes en la hoja "Sorteo".', ui.ButtonSet.OK);
}

/** Boletos de una jugada: su puntaje, con mínimo 1. */
function weight_(row) {
  const s = Math.round(Number(row[COLS.SCORE - 1]));
  return isFinite(s) && s > 0 ? s : 1;
}

/**
 * Muestreo ponderado sin reemplazo (Efraimidis-Spirakis): clave = ln(u) / peso, se eligen las mayores.
 * Cada elección sucesiva tiene probabilidad proporcional al peso entre las que quedan.
 */
function weightedPick_(pool, n) {
  const keyed = pool.map(function (r) {
    let u = Math.random();
    if (u <= 0) u = Number.MIN_VALUE;
    return {r: r, k: Math.log(u) / weight_(r)};
  });
  keyed.sort(function (a, b) { return b.k - a.k; });
  return keyed.slice(0, n).map(function (x) { return x.r; });
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
