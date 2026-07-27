/**
 * ==========================================================
 * Сервис построения отчета
 * ==========================================================
 */

// Годы, за которые сводная аналитика всегда должна иметь показатели —
// независимо и от выбранного источника, и от галочки "Сравнить с 2025".
// Оба этих контрола управляют только детальным отчетом и не влияют на
// полноту данных сводной. Порядок — от свежего года к старому.
const REPORT_YEARS = ['2026', '2025'];

function buildReport(source, filters, compareWith2025, customReportName) {

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

  // Полные (неусеченные) частоты ответов на открытые вопросы считаются
  // ОДИН раз и служат единственным источником и для Топ-5, и для
  // сравнения с 2025 (см. ниже). Топ-5 не считается по сырым строкам
  // отдельно — он только выбирается из этих же частот
  // (Statistics.selectTopAnswers), поэтому прохода по данным ровно два
  // (по одному на вопрос Топ-5), а не четыре, как было раньше.
  const topAnswerFrequencies = Questions.getTopAnswerQuestions().map(question => ({
    question: question,
    frequencies: Statistics.calculateAnswerFrequencies(
      filteredData,
      survey.headers,
      question
    )
  }));

  const topAnswers = topAnswerFrequencies.map(entry => ({
    question: entry.question,
    items: Statistics.selectTopAnswers(entry.frequencies, 5)
  }));

  // ==========================================================
  // Выборки по годам
  // ==========================================================
  //
  // Каждый лист-источник читается и фильтруется НЕ БОЛЕЕ ОДНОГО РАЗА за
  // построение отчета, даже если одни и те же данные нужны сразу
  // детальному отчету, сравнению с 2025 и сводной аналитике. Выборка
  // выбранного источника уже готова выше — она кладется в кэш как есть,
  // остальные годы догружаются по требованию.

  const samplesByYear = {};

  if (REPORT_YEARS.indexOf(source) !== -1) {
    samplesByYear[source] = { headers: survey.headers, rows: filteredData };
  }

  const getYearSample = year => {

    if (!samplesByYear[year]) {

      const yearSurvey = loadSurveyData(year, true);

      samplesByYear[year] = {
        headers: yearSurvey.headers,
        rows: FilterEngine.applyFilters(yearSurvey.data, yearSurvey.headers, filters)
      };

    }

    return samplesByYear[year];

  };

  // Размер выборки и eNPS за каждый год — для сводной аналитики. За год
  // выбранного источника eNPS уже посчитан выше и берется как есть,
  // второй раз не считается.
  //
  // Отсутствующий лист другого года не должен ломать построение отчета:
  // до появления сводной аналитики отчет по 2026 без сравнения к листу
  // 2025 вообще не обращался, и это поведение сохраняется — год без
  // данных просто остается без показателей. Ошибка самого расчета при
  // этом не глушится, а если лист нужен для включенного сравнения — оно
  // запросит его ниже и упадет с прежним сообщением "Лист не найден".

  const enpsByYear = {};
  const employeesByYear = {};

  REPORT_YEARS.forEach(year => {

    let yearSample = null;

    if (year === source) {

      yearSample = samplesByYear[year];

    } else {

      try {
        yearSample = getYearSample(year);
      } catch (error) {
        yearSample = null;
      }

    }

    employeesByYear[year] = yearSample ? yearSample.rows.length : null;

    enpsByYear[year] = (year === source)
      ? enps
      : (yearSample ? Statistics.calculateENPS(yearSample.rows, yearSample.headers) : null);

  });

  // ==========================================================
  // Сравнение с 2025 (только когда выбран источник 2026 и
  // сравнение включено пользователем)
  // ==========================================================

  const comparisonEnabled = !!compareWith2025 && source === '2026';

  let comparison = null;

  if (comparisonEnabled) {

    // Выборка 2025 уже загружена и отфильтрована выше (для eNPS по
    // годам) — переиспользуется как есть, лист второй раз не читается.
    const sample2025 = getYearSample('2025');

    const filteredData2025 = sample2025.rows;

    // "Отдел" — единственный вопрос, где несколько значений 2025 года
    // нужно привести к названию 2026 (переименования/опечатка, см.
    // Comparison.DEPARTMENT_NAME_MAP_2025_TO_2026_) до расчета
    // распределения, иначе Statistics.calculateDistribution молча
    // отбросит старое название как не входящее в каталог 2026 года.
    const departmentRows2025 = Comparison.remapDepartmentRows_(filteredData2025, sample2025.headers);

    const distributions2025 = Questions.getDistributionQuestions().map(question => ({
      question: question,
      items: Statistics.calculateDistribution(
        question.title === "Отдел" ? departmentRows2025 : filteredData2025,
        sample2025.headers,
        question
      )
    }));

    // Полные (неусеченные) частоты для вопросов Топ-5 — сравнение
    // должно строиться по ним, а не по уже обрезанным до 5 позиций
    // спискам, иначе вариант, выпавший из топа одного года, потеряется.
    // За текущий год они уже посчитаны выше (topAnswerFrequencies) и
    // переиспользуются здесь как есть; для 2025 считаются по уже
    // загруженной и отфильтрованной выборке этого года.
    const topAnswerFrequencies2025 = Questions.getTopAnswerQuestions().map(question => ({
      question: question,
      frequencies: Statistics.calculateAnswerFrequencies(
        filteredData2025,
        sample2025.headers,
        question
      )
    }));

    // Средние оценки за 2025 нужны только сравнению — за 2026 они уже
    // посчитаны выше и передаются готовыми, как и eNPS обоих годов.
    const averageRatings2025 = Statistics.calculateAverageRatings(
      filteredData2025,
      sample2025.headers
    );

    comparison = Comparison.build(
      {
        employees: filteredData.length,
        enps: enps,
        averageRatings: averageRatings
      },
      {
        employees: filteredData2025.length,
        enps: enpsByYear['2025'],
        averageRatings: averageRatings2025
      },
      distributions,
      distributions2025,
      topAnswerFrequencies,
      topAnswerFrequencies2025
    );

  }

  // ==========================================================
  // Создаем отчет
  // ==========================================================

  const trimmedCustomName = (customReportName || "").trim();
  const isCustomName = trimmedCustomName.length > 0;
  const reportName = isCustomName
    ? ReportBuilder.sanitizeSheetName(trimmedCustomName)
    : ReportBuilder.generateReportName(filters);

  // Один объект со всей уже посчитанной статистикой — общий для
  // детального отчета и для сводной аналитики. Оба его только читают,
  // ни один ничего не пересчитывает.
  const reportData = {
    employees: filteredData.length,
    filters: filters,
    source: source,
    enps: enps,
    // Размер выборки и eNPS по каждому году отдельно — нужны сводной
    // аналитике, которая должна быть одинаково полной при любом
    // источнике и при выключенном сравнении. Детальный отчет ими не
    // пользуется: он показывает выборку и eNPS выбранного источника
    // (employees/enps) и динамику из comparison. Год без данных — null.
    enpsByYear: enpsByYear,
    employeesByYear: employeesByYear,
    averageRatings: averageRatings,
    distributions: distributions,
    topAnswers: topAnswers,
    headers: survey.headers,
    filteredRows: filteredData,
    comparison: comparison
  };

  const sheet = ReportBuilder.createReport(reportData, reportName, isCustomName);

  // ==========================================================
  // Обновляем сводную аналитику
  // ==========================================================
  //
  // Строго после отчета и никогда не роняя его: лист отчета к этому
  // моменту уже создан, и исключение отсюда выглядело бы в сайдбаре
  // так, будто отчет не построился. Ошибка при этом не проглатывается —
  // она возвращается отдельным полем и показывается пользователю.

  let summaryError = null;

  try {
    Summary.update(reportData, sheet);
  } catch (error) {
    summaryError = error.message;
  }

  return {
    source: source,
    employees: filteredData.length,
    filters: filters,
    sheetName: sheet.getName(),
    comparison: comparison,
    summaryError: summaryError
  };

}