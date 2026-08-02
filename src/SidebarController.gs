function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('HR Analytics')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getSurveyInfo(source) {
  return loadSurveyData(source);
}

/**
 * Вопросы, доступные для фильтрации, вместе с операторами
 * (rating5, enps) или вариантами ответа (single, scale4, scale5).
 *
 * Для вопросов "Город" и "Отдел" варианты ответа сортируются
 * по количеству ответов в данных выбранного источника.
 */
function getFilterableQuestions(source) {
  var resolvedSource = source || '2026';
  var survey = loadEnrichedSurveyData_(resolvedSource, true);

  return Filters.getFilterableQuestions(resolvedSource).map(function(question) {
    var isOperatorType = question.type === 'rating5' || question.type === 'enps';

    return {
      question: question.title,
      dataTitle: question.dataTitle || null,
      type: question.type,
      operators: isOperatorType ? Filters.operators : null,
      options: isOperatorType ? null : Filters.getValueOptions(question, survey.headers, survey.data)
    };
  });
}

/**
 * Построить отчет.
 *
 * Если среди фильтров есть переведенные в режим "отдельный отчет на
 * каждое значение", строится пакет отчетов — по одному обычному отчету
 * на значение (см. BatchReports). Во всех остальных случаях, как и
 * раньше, строится ровно один отчет.
 */
function buildReportFromSidebar(source, filters, compareWith2025, customReportName, cohortOnly) {
  ensureChangeTrigger_();
  return BatchReports.run(source, filters, compareWith2025, customReportName, cohortOnly);
}