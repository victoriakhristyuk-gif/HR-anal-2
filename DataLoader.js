function loadSurveyData(source, includeData) {
  if (includeData === undefined) {
    includeData = false;
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (source === '2025') {
    return loadSingleSheet_(spreadsheet, 'Ответы 2025', 'Ответы 2025', includeData);
  }

  if (source === '2026') {
    return loadSingleSheet_(spreadsheet, 'Ответы 2026', 'Ответы 2026', includeData);
  }

  if (source === 'both') {
    return loadBothSheets_(spreadsheet, includeData);
  }

  throw new Error('Неизвестный источник данных: ' + source);
}

function loadSingleSheet_(spreadsheet, sheetName, sourceLabel, includeData) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Лист "' + sheetName + '" не найден');
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var headers = [];

  if (lastColumn > 0) {
    headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  }

  var result = {
    source: sourceLabel,
    rows: Math.max(0, lastRow - 1),
    columns: lastColumn,
    headers: headers
  };

  if (includeData) {
    result.data = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
      : [];
  }

  return result;
}

function loadBothSheets_(spreadsheet, includeData) {
  var info2025 = loadSingleSheet_(spreadsheet, 'Ответы 2025', 'Ответы 2025', includeData);
  var info2026 = loadSingleSheet_(spreadsheet, 'Ответы 2026', 'Ответы 2026', includeData);

  if (!headersEqual_(info2025.headers, info2026.headers)) {
    throw new Error('Заголовки листов "Ответы 2025" и "Ответы 2026" не совпадают');
  }

  var result = {
    source: 'Ответы 2025 + 2026',
    rows: info2025.rows + info2026.rows,
    columns: info2025.columns,
    headers: info2025.headers
  };

  if (includeData) {
    result.data = info2025.data.concat(info2026.data);
  }

  return result;
}

function headersEqual_(headersA, headersB) {
  if (headersA.length !== headersB.length) {
    return false;
  }

  for (var i = 0; i < headersA.length; i++) {
    if (headersA[i] !== headersB[i]) {
      return false;
    }
  }

  return true;
}
