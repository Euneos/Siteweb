/** Independent server-to-server bridge. NOT INSTALLED by adding this file.
 * Configure Script Properties only; never embed credentials in this source.
 * GOOGLE_FORMS_SYNC_SECRET, GOOGLE_FORMS_SYNC_CONFIG (see runbook).
 * It neither calls legacy handlers nor sends mail or creates business records.
 */
var EUNEOS_SYNC_ENDPOINT = 'https://euneos.fr/api/hook/google-forms';
function euneosSyncConfig_() {
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('GOOGLE_FORMS_SYNC_CONFIG') || 'null');
  var secret = props.getProperty('GOOGLE_FORMS_SYNC_SECRET') || '';
  if (!config || !Array.isArray(config.sources) || !config.sources.length || config.sources.length > 4 || secret.length < 32) throw new Error('sync_configuration');
  var seen = {};
  config.sources.forEach(function(s) {
    if (!s || !/^[\w-]{10,128}$/.test(s.spreadsheetId) || !Number.isSafeInteger(s.sheetId) || s.sheetId < 0 || s.cohortId !== 2 ||
        ['contact','deploiement'].indexOf(s.kind) < 0 || !Number.isSafeInteger(s.firstRow) || s.firstRow < 2 || !s.headers ||
        !s.headers.timestamp || !s.headers.name || !s.headers.start || !s.headers.end ||
        !(s.headers.city && s.headers.postcode) && !s.headers.referenceEmail) throw new Error('sync_source_configuration');
    var key = s.spreadsheetId + ':' + s.sheetId;
    if (seen[key]) throw new Error('sync_duplicate_source');
    seen[key] = true;
  });
  return { sources: config.sources, secret: secret, props: props };
}
function euneosSyncDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}
function euneosSyncLabel_(x) {
  return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘ʼ]/g, "'").replace(/\s+/g, ' ').trim();
}
function euneosSyncDate_(value, zone) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  var text = String(value || '').trim();
  var fr = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  return fr ? fr[3] + '-' + fr[2] + '-' + fr[1] : text; // invalid dates retained for server issues
}
function euneosSyncPayload_(source, headers, values, row, zone) {
  function field(key) {
    var label = source.headers[key];
    if (!label) return '';
    var found = headers.map(function(h, i) { return euneosSyncLabel_(h) === euneosSyncLabel_(label) ? i : -1; }).filter(function(i) { return i >= 0; });
    if (found.length !== 1) throw new Error('sync_header_invalid');
    return values[found[0]];
  }
  function text(key) { return String(field(key) || '').trim(); }
  var timestamp = field('timestamp');
  // Read getValues(), not display strings: never guess dd/mm versus mm/dd timestamps.
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime()) || !text('name')) throw new Error('sync_row_invalid');
  return {
    version: 1, kind: source.kind, cohortId: 2,
    source: { spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, row: row, submittedAt: timestamp.toISOString(), readAt: new Date().toISOString() },
    identity: { name: text('name'), city: text('city'), postcode: text('postcode'), referenceEmail: text('referenceEmail').toLowerCase() },
    contact: { name: text('contactName'), email: text('referenceEmail'), phone: text('phone') },
    formation: { start: euneosSyncDate_(field('start'), zone), end: euneosSyncDate_(field('end'), zone), format: text('format'), planning: text('planning') },
    declaredTrainer: text('trainer'), participants: text('participants')
  };
}
function euneosSyncRow_(config, source, sheet, row) {
  var key = 'EUNEOS_SYNC_ROW_' + euneosSyncDigest_(source.spreadsheetId + ':' + source.sheetId + ':' + row);
  var last = JSON.parse(config.props.getProperty(key) || 'null');
  var payload;
  try {
    var columns = sheet.getLastColumn();
    payload = euneosSyncPayload_(source, sheet.getRange(1, 1, 1, columns).getValues()[0], sheet.getRange(row, 1, 1, columns).getValues()[0], row, sheet.getParent().getSpreadsheetTimeZone());
  } catch (_) {
    // Only technical coordinates, never raw answers or an exception containing them.
    config.props.setProperty(key, JSON.stringify(Object.assign({}, last || {}, { state: 'review', code: 'row_or_headers_invalid', row: row, sheetId: source.sheetId })));
    return false;
  }
  var stable = JSON.parse(JSON.stringify(payload));
  delete stable.source.readAt;
  var hash = euneosSyncDigest_(JSON.stringify(stable));
  if (last && last.hash === hash && last.code !== 'row_or_headers_invalid' && (['complete','review','stopped'].indexOf(last.state) >= 0 || last.nextAt > Date.now())) return false;
  var revision = last && last.hash === hash ? last.revision : (last && last.revision || 0) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('sync_revision_reconcile');
  payload.source.revision = revision;
  var attempts = last && last.hash === hash ? (last.attempts || 0) + 1 : 1;
  // Reserve the source revision BEFORE sending. A timeout or script termination
  // resumes the same revision. A -> B -> A becomes revisions 1 -> 2 -> 3.
  config.props.setProperty(key, JSON.stringify({ hash: hash, revision: revision, state: 'retryable', code: 'sending',
    attempts: attempts, row: row, sheetId: source.sheetId, nextAt: Date.now() + 300000 }));
  var state = 'retryable', code = 'transport', receipt = '';
  try {
    var response = UrlFetchApp.fetch(EUNEOS_SYNC_ENDPOINT, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      headers: { 'x-google-forms-secret': config.secret },
      muteHttpExceptions: true, followRedirects: false,
    });
    var status = response.getResponseCode();
    var body;
    try { body = JSON.parse(response.getContentText()); } catch (_) { body = {}; }
    if (status === 200 && ['complete','review'].indexOf(body.state) >= 0 && /^[a-f0-9]{64}$/.test(body.receipt || '')) {
      state = body.state; code = /^[a-z_]+$/.test(body.code || '') ? body.code : 'response'; receipt = body.receipt;
    } else if (status === 202 || status === 503 || status === 429 || status >= 500) {
      code = status === 202 ? 'processing' : 'service_unavailable';
    } else { state = 'review'; code = 'request_rejected'; }
  } catch (_) { /* transport uncertainty is retried through the D1 receipt, never around it */ }
  if (state === 'retryable' && attempts >= 6) { state = 'stopped'; code = 'retry_limit'; }
  config.props.setProperty(key, JSON.stringify({ hash: hash, revision: revision, state: state, code: code, receipt: receipt,
    attempts: attempts, row: row, sheetId: source.sheetId, nextAt: Date.now() + Math.min(60, 5 * Math.pow(2, attempts - 1)) * 60000 }));
  return true;
}
/** Operator-only targeted retry after fixing a reviewed identity mapping/notes.
 * Never reset the revision counter or replay an uncertain-write receipt.
 * Install no trigger for this function. Call with one exact source and row.
 */
function euneosNocoRetryRow(spreadsheetId, sheetId, row) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('sync_busy');
  try {
    var config = euneosSyncConfig_();
    var source = config.sources.filter(function(s) { return s.spreadsheetId === spreadsheetId && s.sheetId === sheetId; });
    if (source.length !== 1 || !Number.isSafeInteger(row) || row < source[0].firstRow) throw new Error('sync_source_not_allowed');
    var key = 'EUNEOS_SYNC_ROW_' + euneosSyncDigest_(spreadsheetId + ':' + sheetId + ':' + row);
    var state = JSON.parse(config.props.getProperty(key) || 'null');
    if (!state || ['identity_unresolved','notes_invalid'].indexOf(state.code) < 0) throw new Error('sync_review_not_retryable');
    state.state = 'retryable'; state.nextAt = 0; state.attempts = 0;
    config.props.setProperty(key, JSON.stringify(state));
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetById(sheetId);
    if (!sheet || row > sheet.getLastRow()) throw new Error('sync_row_missing');
    euneosSyncRow_(config, source[0], sheet, row);
  } finally { lock.releaseLock(); }
}
/** Operator status, technical coordinates only. No payload/secret/email logged. */
function euneosNocoStatus() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  var status = Object.keys(properties).filter(function(k) { return k.indexOf('EUNEOS_SYNC_ROW_') === 0; }).map(function(k) {
    var r = JSON.parse(properties[k]);
    return { row: r.row, sheetId: r.sheetId, revision: r.revision || null, state: r.state, code: r.code, receipt: r.receipt || null };
  });
  Logger.log(JSON.stringify(status));
  return status;
}
/** Install as a SPREADSHEET submit trigger, never a FormResponse trigger. */
function euneosNocoOnSubmit(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // bounded sweep recovers this row
  try {
    var config = euneosSyncConfig_();
    if (!e || !e.range) throw new Error('sync_sheet_event_required');
    var sheet = e.range.getSheet(), spreadsheetId = sheet.getParent().getId();
    var source = config.sources.filter(function(s) { return s.spreadsheetId === spreadsheetId && s.sheetId === sheet.getSheetId(); });
    if (source.length !== 1) throw new Error('sync_source_not_allowed');
    var row = e.range.getRow();
    if (row >= source[0].firstRow) euneosSyncRow_(config, source[0], sheet, row);
  } finally { lock.releaseLock(); }
}
/** Up to 100 rows inspected, 5 changed rows sent, 210s soft budget per invocation.
 * Each sheet gets a persistent rotating cursor; a bad row cannot starve the rest.
 * No Utilities.sleep(), and current sheet values are read again on EVERY retry.
 */
function euneosNocoSweep() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var config = euneosSyncConfig_(), deadline = Date.now() + 210000, inspected = 0, sent = 0;
    var order = Number(config.props.getProperty('EUNEOS_SYNC_NEXT_SOURCE') || 0) % config.sources.length;
    for (var n = 0; n < config.sources.length; n++) {
      var index = (order + n) % config.sources.length, source = config.sources[index];
      config.props.setProperty('EUNEOS_SYNC_NEXT_SOURCE', String((index + 1) % config.sources.length));
      var sheet;
      try { sheet = SpreadsheetApp.openById(source.spreadsheetId).getSheetById(source.sheetId); } catch (_) { continue; }
      if (!sheet) continue;
      var cursorKey = 'EUNEOS_SYNC_CURSOR_' + euneosSyncDigest_(source.spreadsheetId + ':' + source.sheetId);
      var end = sheet.getLastRow(), row = Math.max(source.firstRow, Number(config.props.getProperty(cursorKey) || source.firstRow));
      if (row > end) row = source.firstRow;
      var available = end - source.firstRow + 1;
      for (var i = 0; i < available; i++) {
        if (Date.now() >= deadline || sent >= 5 || inspected >= 100) return;
        if (euneosSyncRow_(config, source, sheet, row)) sent++;
        inspected++;
        row = row >= end ? source.firstRow : row + 1;
        config.props.setProperty(cursorKey, String(row));
      }
    }
  } finally { lock.releaseLock(); }
}
/** Explicit operator action AFTER API readiness checks; never called by a hook.
 * Leaves every pre-existing legacy trigger in place. No historical replay here.
 */
function euneosNocoInstallTriggers() {
  var config = euneosSyncConfig_();
  var response = UrlFetchApp.fetch(EUNEOS_SYNC_ENDPOINT, { method: 'get', headers: { 'x-google-forms-secret': config.secret }, muteHttpExceptions: true, followRedirects: false });
  var readiness = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || readiness.ready !== true || readiness.mode !== 'apply') throw new Error('sync_api_not_ready');
  var triggers = ScriptApp.getProjectTriggers();
  config.sources.forEach(function(source) {
    if (!triggers.some(function(t) { return t.getHandlerFunction() === 'euneosNocoOnSubmit' && t.getTriggerSourceId() === source.spreadsheetId; })) {
      ScriptApp.newTrigger('euneosNocoOnSubmit').forSpreadsheet(source.spreadsheetId).onFormSubmit().create();
      triggers = ScriptApp.getProjectTriggers();
    }
  });
  if (!triggers.some(function(t) { return t.getHandlerFunction() === 'euneosNocoSweep'; })) ScriptApp.newTrigger('euneosNocoSweep').timeBased().everyMinutes(15).create();
}
