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
 */
function getFilterableQuestions() {
  return Filters.getFilterableQuestions().map(function(question) {
    var isOperatorType = question.type === 'rating5' || question.type === 'enps';

    return {
      question: question.title,
      type: question.type,
      operators: isOperatorType ? Filters.operators : null,
      options: isOperatorType ? null : Filters.getValueOptions(question)
    };
  });
}

/**
 * Построить отчет
 */
function buildReportFromSidebar(source, filters) {
  return buildReport(source, filters);
}