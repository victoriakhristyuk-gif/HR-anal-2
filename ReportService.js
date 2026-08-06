/**
 * ==========================================================
 * Сервис построения отчета
 * ==========================================================
 */

function buildReport(source, filters) {

  // Если источник 2025 – строим обычный отчёт
  if (source === '2025') {
    const survey = loadSurveyData(source, true);
    const filteredData = FilterEngine.applyFilters(
      survey.data,
      survey.headers,
      filters
    );

    // ----- Проверка на пустой результат -----
    if (filteredData.length === 0) {
      throw new Error('Ответов не найдено. Измените фильтры.');
    }

    const enps = Statistics.calculateENPS(filteredData, survey.headers);
    const averageRatings = Statistics.calculateAverageRatings(filteredData, survey.headers);
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

    const reportName = "Отчет";

    ReportBuilder.createReport(
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
        comparison: false
      },
      reportName
    );

    return {
      source: source,
      employees: filteredData.length,
      filters: filters,
      sheetName: reportName
    };
  }

  // ---- ИСТОЧНИК 2026 ----
  if (source === '2026') {
    // Загружаем оба года
    const survey2025 = loadSurveyData('2025', true);
    const survey2026 = loadSurveyData('2026', true);

    // Проверяем совпадение заголовков
    if (!headersEqual_(survey2025.headers, survey2026.headers)) {
      throw new Error('Заголовки листов "Ответы 2025" и "Ответы 2026" не совпадают');
    }

    // Применяем одинаковые фильтры к обоим наборам
    const filtered2025 = FilterEngine.applyFilters(
      survey2025.data,
      survey2025.headers,
      filters
    );
    const filtered2026 = FilterEngine.applyFilters(
      survey2026.data,
      survey2026.headers,
      filters
    );

    // ----- Проверка на пустой результат (для 2026) -----
    if (filtered2026.length === 0) {
      throw new Error('Ответов за 2026 год не найдено. Измените фильтры.');
    }

    // ---- Статистика для 2025 ----
    const enps2025 = Statistics.calculateENPS(filtered2025, survey2025.headers);
    const avg2025 = Statistics.calculateAverageRatings(filtered2025, survey2025.headers);

    // ---- Статистика для 2026 ----
    const enps2026 = Statistics.calculateENPS(filtered2026, survey2026.headers);
    const avg2026 = Statistics.calculateAverageRatings(filtered2026, survey2026.headers);

    // ---- Распределения для обоих годов ----
    const distQuestions = Questions.getDistributionQuestions();
    const distributions2025 = distQuestions.map(question => ({
      question: question,
      items: Statistics.calculateDistribution(
        filtered2025,
        survey2025.headers,
        question
      )
    }));
    const distributions2026 = distQuestions.map(question => ({
      question: question,
      items: Statistics.calculateDistribution(
        filtered2026,
        survey2026.headers,
        question
      )
    }));

    // ---- TOP-5 открытых ответов (только для 2026) ----
    const topAnswers2026 = Questions.getTopAnswerQuestions().map(question => ({
      question: question,
      items: Statistics.calculateTopAnswers(
        filtered2026,
        survey2026.headers,
        question,
        5
      )
    }));

    // ---- Самые большие изменения (rating5) ----
    const ratingChanges = Statistics.calculateRatingChanges(
      filtered2025,
      filtered2026,
      survey2025.headers
    );

    const reportName = "Отчет";

    ReportBuilder.createReport(
      {
        employees: filtered2026.length,
        filters: filters,
        source: source,
        comparison: true,
        // Данные для сравнения
        enps2025: enps2025,
        enps2026: enps2026,
        avg2025: avg2025,
        avg2026: avg2026,
        ratingChanges: ratingChanges,
        // Распределения для обоих годов
        distributions2025: distributions2025,
        distributions2026: distributions2026,
        // Данные только для 2026
        topAnswers: topAnswers2026,
        headers: survey2026.headers,
        filteredRows: filtered2026
      },
      reportName
    );

    return {
      source: source,
      employees: filtered2026.length,
      filters: filters,
      sheetName: reportName
    };
  }

  throw new Error('Неизвестный источник данных: ' + source);
}

// Вспомогательная функция для сравнения заголовков
function headersEqual_(headersA, headersB) {
  if (headersA.length !== headersB.length) return false;
  for (var i = 0; i < headersA.length; i++) {
    if (headersA[i] !== headersB[i]) return false;
  }
  return true;
}