// Moments waitlist catcher. Paste into Extensions > Apps Script of a Google Sheet
// on your PERSONAL Google account, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone). Copy the /exec URL into index.html.

const SHEET_NAME = 'waitlist';
const HEADERS = ['Timestamp', 'First name', 'Email', 'Phone', 'OK to text', 'Instagram', 'Neighborhood',
  'Favorite moments', 'Most interested in', 'Age', 'Time in Miami', 'Wants to host', 'Invite code', 'Referred by', 'Source', 'Campaign'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const ig = (p.instagram || '').trim();
  getSheet_().appendRow([
    new Date(),
    p.name || '',
    p.email || '',
    p.phone ? "'" + p.phone : '',
    p.text_consent || '',
    ig ? '@' + ig : '',
    p.neighborhood || '',
    p.moments || '',
    p.intent || '',
    p.age || '',
    p.miami || '',
    p.host || '',
    p.invite_code || '',
    p.ref || '',
    p.source || '',
    p.campaign || ''
  ]);
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('moments waitlist catcher is running.');
}
