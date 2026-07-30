function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HR Analytics')
    .addItem('Создать отчет', 'showSidebar')
    .addItem('Убрать из сводной строки без отчета', 'pruneSummaryDeletedSamples')
    .addSeparator()
    .addItem('Расширенная аналитика', 'runAdvancedAnalytics')
    .addToUi();

  ensureChangeTrigger_();
}

/**
 * onChange-обработчик: при переименовании листа синхронизирует
 * заголовок отчета в шапке и название среза в сводной таблице.
 */
function onSpreadsheetChange(e) {

  if (e && e.changeType !== "OTHER") {
    return;
  }

  syncSheetNames_();

}

/**
 * Пройти по всем листам-отчетам и обновить заголовок/сводную, если
 * название листа изменилось.
 */
function syncSheetNames_() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var reportMetadata = ss.createDeveloperMetadataFinder()
    .withKey(ReportBuilder.REPORT_KEY_METADATA_KEY)
    .find();

  reportMetadata.forEach(function (m) {
    ReportBuilder.syncHeader(m.getLocation().getSheet());
  });

  Summary.syncSampleNames(ss);

}

/**
 * Установить installable onChange-триггер, если его еще нет.
 * Вызывается из onOpen — simple trigger может не иметь прав на
 * ScriptApp.newTrigger; в этом случае ошибка подавляется, а триггер
 * будет установлен при первой авторизованной операции (buildReport).
 */
function ensureChangeTrigger_() {

  try {

    var triggers = ScriptApp.getProjectTriggers();
    var exists = triggers.some(function (t) {
      return t.getHandlerFunction() === "onSpreadsheetChange" && t.getEventType() === ScriptApp.EventType.ON_CHANGE;
    });

    if (!exists) {
      ScriptApp.newTrigger("onSpreadsheetChange")
        .forSpreadsheet(SpreadsheetApp.getActive())
        .onChange()
        .create();
    }

  } catch (ignore) {
    // Simple trigger не имеет прав — триггер установится позже.
  }

}

/**
 * Ручная очистка сводной от строк, чей лист отчета уже удален —
 * без необходимости пересобирать какой-либо отчет (см.
 * Summary.pruneDeletedSamples).
 */
function pruneSummaryDeletedSamples() {

  const ui = SpreadsheetApp.getUi();

  try {

    const removed = Summary.pruneDeletedSamples();

    ui.alert(removed > 0
      ? 'Удалено строк без отчета: ' + removed
      : 'Все строки сводной ссылаются на существующие отчеты.');

  } catch (error) {
    ui.alert('Не удалось обновить сводную: ' + error.message);
  }

}
