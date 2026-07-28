function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HR Analytics')
    .addItem('Создать отчет', 'showSidebar')
    .addItem('Убрать из сводной строки без отчета', 'pruneSummaryDeletedSamples')
    .addSeparator()
    .addItem('Расширенная аналитика', 'runAdvancedAnalytics')
    .addToUi();
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
