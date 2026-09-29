/** Google-authenticated, journal-only transport. Installing this file does not
 * create a trigger. Never run legacy business handlers or copy a Google token.
 * Script Properties: EUNEOS_RAW_ENDPOINT (Worker origin), EUNEOS_RAW_SECRET (ingestion bridge secret),
 * EUNEOS_RAW_SOURCES (private JSON allowlist), EUNEOS_RAW_ENABLED (exactly "true" to send to /ingest).
 * Google permissions remain in Google; no NocoDB credentials are needed here.
 */
function euneosRawConfig_() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = (props.getProperty('EUNEOS_RAW_ENDPOINT') || '').replace(/\/$/, '');
  var secret = props.getProperty('EUNEOS_RAW_SECRET') || '';
  var sources;
  try { sources = JSON.parse(props.getProperty('EUNEOS_RAW_SOURCES') || 'null'); }
  catch (_) { throw new Error('sources_invalid'); }
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(endpoint) || secret.length < 32 || secret.length > 256 ||
      !Array.isArray(sources) || !sources.length || sources.length > 30) throw new Error('configuration_invalid');
  var seen = {};
  sources.forEach(function(s) {
    if (!s || !/^[\w-]{20,128}$/.test(s.spreadsheetId) || !Number.isSafeInteger(s.sheetId) || s.sheetId < 0 ||
        !Number.isSafeInteger(s.firstRow) || s.firstRow < 2) throw new Error('source_invalid');
    var key = s.spreadsheetId + ':' + s.sheetId;
    if (seen[key]) throw new Error('source_duplicate');
    seen[key] = true;
  });
  return { props: props, endpoint: endpoint, secret: secret, sources: sources,
    enabled: props.getProperty('EUNEOS_RAW_ENABLED') === 'true' };
}
function euneosRawSnapshot_(source) {
  var book = SpreadsheetApp.openById(source.spreadsheetId);
  var sheet = book.getSheets().filter(function(s) { return s.getSheetId() === source.sheetId; })[0];
  if (!sheet) throw new Error('sheet_missing');
  var height = sheet.getLastRow(), width = sheet.getLastColumn();
  if (height < 1 || height > 2001 || width < 1 || width > 256) throw new Error('snapshot_shape');
  // Display strings must hash identically to parsed CSV strings. Do not trim,
  // reformat dates, drop blank columns, or deduplicate question labels.
  var values = sheet.getRange(1, 1, height, width).getDisplayValues();
  return { version: 1, source: { spreadsheetId: source.spreadsheetId, sheetId: source.sheetId },
    headers: values[0], rows: values.slice(1) };
}
function euneosRawRequest_(config, path, snapshot) {
  var body = JSON.stringify(snapshot);
  if (Utilities.newBlob(body).getBytes().length > 1000000) throw new Error('snapshot_too_large');
  var response = UrlFetchApp.fetch(config.endpoint + path, { method: 'post',
    contentType: 'application/json', headers: { Authorization: 'Bearer ' + config.secret },
    payload: body, muteHttpExceptions: true, followRedirects: false });
  var status = response.getResponseCode();
  // Never log a response body, answers, identifiers, endpoint or secret.
  if (status !== 200) throw new Error('worker_http_' + status);
  var result;
  try { result = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('worker_response_invalid'); }
  if (!result || typeof result.state !== 'string') throw new Error('worker_response_invalid');
  return result;
}
/** Read-only: reads Google and compares fingerprints with seeded D1 receipts.
 * No property, trigger, receipt, cursor, journal or business record is changed.
 * Review differences BEFORE enabling ingestion. New rows are reported too.
 */
function euneosRawCheckDry() {
  var config = euneosRawConfig_(), deadline = Date.now() + 180000, reports = [];
  config.sources.forEach(function(source, index) {
    if (Date.now() >= deadline) throw new Error('dry_budget');
    var result = euneosRawRequest_(config, '/check', euneosRawSnapshot_(source));
    if (result.state !== 'checked' || result.inputMode !== 'push' || result.projectionEnabled !== false ||
        result.configured !== true) throw new Error('worker_not_ready');
    reports.push({ source: index + 1, enabled: result.enabled, matched: result.matched,
      fresh: result.fresh, changed: result.changed, pending: result.pending, missing: result.missing,
      differences: result.differences, differencesTruncated: result.differencesTruncated });
  });
  // Technical counts and row numbers only; no source identifiers or cell values.
  console.log(JSON.stringify(reports));
  return reports;
}
/** Explicit operator action after dry-run review. It creates only our own timer,
 * never removes or modifies other projects' or legacy triggers. Idempotent.
 */
function euneosRawInstallTrigger() {
  var config = euneosRawConfig_();
  if (!config.enabled) throw new Error('disabled');
  var reports = euneosRawCheckDry();
  if (reports.some(function(r) { return !r.enabled || r.changed || r.missing || r.pending; }))
    throw new Error('bootstrap_review_required');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('busy');
  try {
    var exists = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'euneosRawSweep'; });
    if (!exists) ScriptApp.newTrigger('euneosRawSweep').timeBased().everyMinutes(15).create();
    return { state: exists ? 'already_installed' : 'installed' };
  } finally { lock.releaseLock(); }
}
/** At most three sources per invocation, one complete snapshot per POST. The
 * Worker owns row receipts/cursors and may need subsequent sweeps for a source.
 * Advance the source cursor even on failure so one inaccessible sheet cannot
 * starve the other sources. Failures remain visible in Apps Script executions.
 */
function euneosRawSweep() {
  // Disabled must not ask for Google access or make any network request.
  if (PropertiesService.getScriptProperties().getProperty('EUNEOS_RAW_ENABLED') !== 'true') return { state: 'disabled' };
  var config = euneosRawConfig_(), deadline = Date.now() + 150000;
  var failures = [], processed = 0;
  for (var n = 0; n < Math.min(3, config.sources.length) && Date.now() < deadline; n++) {
    // This lock covers ONLY the cursor update, never network/Google reads. Do
    // not hold the project's shared lock while legacy handlers may need it.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) throw new Error('busy');
    var index;
    try {
      var cursor = Number(config.props.getProperty('EUNEOS_RAW_NEXT_SOURCE') || '0');
      if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
      index = cursor % config.sources.length;
      // Advance before the Google read: even a hard GAS execution timeout cannot
      // pin every later invocation to one inaccessible source.
      config.props.setProperty('EUNEOS_RAW_NEXT_SOURCE', String((index + 1) % config.sources.length));
    } finally { lock.releaseLock(); }
    try {
      var result = euneosRawRequest_(config, '/ingest', euneosRawSnapshot_(config.sources[index]));
      if (['complete', 'catching_up'].indexOf(result.state) < 0) throw new Error('worker_attention');
      processed++;
    } catch (_) { failures.push(index + 1); }
  }
  if (failures.length) throw new Error('source_failed_' + failures.join('_'));
  return { state: 'complete', sources: processed };
}
