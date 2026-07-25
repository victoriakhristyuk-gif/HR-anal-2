/**
 * ==========================================================
 * Сервис построения отчета
 * ==========================================================
 */

function buildReport(source, filters) {

  // ==========================================================
  // Загружаем данные
  // ==========================================================

  const survey = loadSurveyData(source, true);

  // ==========================================================
  // Применяем фильтры
  // ==========================================================

  const filteredData = FilterEngine.applyFilters(
    survey.data,
    survey.headers,
    filters
  );

  // ==========================================================
  // Рассчитываем статистику
  // ==========================================================

  const enps = Statistics.calculateENPS(
    filteredData,
    survey.headers
  );

  const averageRatings = Statistics.calculateAverageRatings(
    filteredData,
    survey.headers
  );

  const distributions = Questions.getDistributionQuestions().map(question => ({
    question: question,
    items: Statistics.calculateDistribution(
      filteredData,
      survey.headers,
      question
    )
  }));

  const topAnswers = Questions.getTopAnswerQuestions().map(question => ({
    question: question,
    items: Statistics.calculateTopAnswers(
      filteredData,
      survey.headers,
      question,
      5
    )
  }));

  // ==========================================================
  // Создаем отчет
  // ==========================================================

  const reportName = ReportBuilder.generateReportName(filters);

  const sheet = ReportBuilder.createReport(
    {
      employees: filteredData.length,
      filters: filters,
      source: source,
      enps: enps,
      averageRatings: averageRatings,
      distributions: distributions,
      topAnswers: topAnswers,
      headers: survey.headers,
      filteredRows: filteredData
    },
    reportName
  );

  return {
    source: source,
    employees: filteredData.length,
    filters: filters,
    sheetName: sheet.getName()
  };

}