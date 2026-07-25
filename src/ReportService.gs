/**
 * ==========================================================
 * Сервис построения отчета
 * ==========================================================
 */

function buildReport(source, filters, compareWith2025) {

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
  // Сравнение с 2025 (только когда выбран источник 2026 и
  // сравнение включено пользователем)
  // ==========================================================

  const comparisonEnabled = !!compareWith2025 && source === '2026';

  let comparison = null;

  if (comparisonEnabled) {

    const survey2025 = loadSurveyData('2025', true);

    const filteredData2025 = FilterEngine.applyFilters(
      survey2025.data,
      survey2025.headers,
      filters
    );

    const distributions2025 = Questions.getDistributionQuestions().map(question => ({
      question: question,
      items: Statistics.calculateDistribution(
        filteredData2025,
        survey2025.headers,
        question
      )
    }));

    // Полные (неусеченные) частоты для вопросов Топ-5 — сравнение
    // должно строиться по ним, а не по уже обрезанным до 5 позиций
    // спискам, иначе вариант, выпавший из топа одного года, потеряется.
    const topAnswerFrequencies2026 = Questions.getTopAnswerQuestions().map(question => ({
      question: question,
      frequencies: Statistics.calculateAnswerFrequencies(
        filteredData,
        survey.headers,
        question
      )
    }));

    const topAnswerFrequencies2025 = Questions.getTopAnswerQuestions().map(question => ({
      question: question,
      frequencies: Statistics.calculateAnswerFrequencies(
        filteredData2025,
        survey2025.headers,
        question
      )
    }));

    comparison = Comparison.build(
      filteredData,
      survey.headers,
      filteredData2025,
      survey2025.headers,
      distributions,
      distributions2025,
      topAnswerFrequencies2026,
      topAnswerFrequencies2025
    );

  }

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
      filteredRows: filteredData,
      comparison: comparison
    },
    reportName
  );

  return {
    source: source,
    employees: filteredData.length,
    filters: filters,
    sheetName: sheet.getName(),
    comparison: comparison
  };

}