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
  var survey = loadSurveyData(source || '2026', true);

  return Filters.getFilterableQuestions().map(function(question) {
    var isOperatorType = question.type === 'rating5' || question.type === 'enps';

    return {
      question: question.title,
      type: question.type,
      operators: isOperatorType ? Filters.operators : null,
      options: isOperatorType ? null : Filters.getValueOptions(question, survey.headers, survey.data)
    };
  });
}

/**
 * Построить отчет
 */
function buildReportFromSidebar(source, filters, compareWith2025) {
  return buildReport(source, filters, compareWith2025);
}