function onOpen() {

  var ui = SpreadsheetApp.getUi();

  // Подменю вместо одного пункта: "Все сразу" сохраняет прежнее
  // поведение (один пересчет analytics, все листы разом), остальные
  // пункты строят и перезаписывают только один лист, не трогая
  // остальные (см. AnalyticsWriter.writeOne_/runSingleAdvancedAnalyticsSheet_
  // в AnalyticsWriter.gs).
  var advancedAnalyticsMenu = ui.createMenu('Расширенная аналитика')
    .addItem('Все сразу', 'runAdvancedAnalytics')
    .addSeparator()
    .addItem('Методика', 'runMethodologyOnly')
    .addItem('Выводы', 'runFindingsOnly')
    .addItem('Светофор', 'runTrafficLightOnly')
    .addItem('Драйверы', 'runDriversOnly')
    .addItem('Отклонения срезов', 'runSegmentsOnly')
    .addItem('Когорта', 'runCohortOnly')
    .addItem('Сервисные vs доменные', 'runTeamTypeComparisonOnly')
    .addItem('Руководитель и команда', 'runManagerTeamOnly');

  ui.createMenu('HR Analytics')
    .addItem('Создать отчет', 'showSidebar')
    .addItem('Убрать из сводной строки без отчета', 'pruneSummaryDeletedSamples')
    .addSeparator()
    .addItem('Открыть численность', 'openHeadcountSheet')
    .addItem('Проверить численность', 'diagnoseHeadcount')
    .addSeparator()
    .addItem('Разметить тональность (открытая ОС)', 'runOpenFeedbackAnalysis')
    .addSeparator()
    .addSubMenu(advancedAnalyticsMenu)
    .addToUi();

  // Одноразовая миграция: при первом открытии создается редактируемый
  // лист с текущими значениями. Ошибка не должна мешать появлению меню —
  // пользователь сможет повторить создание отдельным пунктом.
  try {
    Headcount.ensureSheet();
  } catch (error) {
    console.warn('Не удалось создать лист численности: ' + error.message);
  }

  try {
    pinLeadingSheets_();
  } catch (error) {
    console.warn('Не удалось закрепить порядок первых листов: ' + error.message);
  }

  ensureChangeTrigger_();
}

/**
 * Закрепляет порядок первых трёх вкладок таблицы: "Сводная аналитика",
 * "Численность", "перформанс" — именно в этом порядке, независимо от
 * того, как листы были созданы/переставлены руками. Вызывается при
 * каждом открытии таблицы (onOpen), поэтому порядок не "уезжает" со
 * временем.
 *
 * Лист, которого нет (чаще всего "перформанс" — он не создается кодом,
 * см. PerformanceDirectory.gs), молча пропускается: остальные листы
 * из списка все равно встают подряд, без пропуска позиции.
 */
function pinLeadingSheets_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const leadingSheetNames = [Summary.SHEET_NAME, Headcount.SHEET_NAME, PerformanceDirectory.SHEET_NAME];

  let position = 1;

  leadingSheetNames.forEach(name => {

    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    sheet.activate();
    ss.moveActiveSheet(position);
    position++;

  });

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
