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

/**
 * Строки для расчета одного распределения в основном отчете.
 *
 * В самостоятельном отчете за 2025 старые названия отделов должны
 * попадать в актуальные категории Questions.catalogue. Для этого
 * канонизируется только копия строк, используемая распределением
 * "Отдел"; исходные строки отчета и остальные вопросы не меняются.
 */
function getReportDistributionRows_(source, question, rows, headers) {

  const isDepartment = Statistics.normalize_(question.title) === Statistics.normalize_("Отдел");

  if (!isDepartment) return rows;

  const columnIndex = headers.findIndex(
    header => Statistics.normalize_(header) === Statistics.normalize_("Отдел")
  );

  if (columnIndex === -1) return rows;

  return rows.map(row => {
    const displayName = Headcount.resolveDepartment(row[columnIndex]).name;
    if (displayName === row[columnIndex]) return row;
    const copy = row.slice();
    copy[columnIndex] = displayName;
    return copy;
  });

}

/** Дополнить варианты отдела названиями из редактируемого справочника. */
function getReportDistributionQuestion_(question) {

  if (Statistics.normalize_(question.title) !== Statistics.normalize_("Отдел")) return question;

  // Последние названия из справочника идут первыми, чтобы старый
  // вариант из фиксированного каталога не вытеснил их при дедупликации
  // по стабильному ID.
  const answers = Headcount.listDepartments().concat(question.answers || []);
  const unique = answers.filter((value, index, list) =>
    list.findIndex(candidate => Headcount.departmentKey(candidate) === Headcount.departmentKey(value)) === index
  );

  return Object.assign({}, question, { answers: unique });

}

/**
 * Показатели одной выборки (за один год), нужные и детальному отчету,
 * и сравнению с другим периодом: eNPS, средние оценки, распределения,
 * полные частоты Топ-5 и сам Топ-5. Общий для обычного пути buildReport
 * (текущий и, при сравнении, 2025 годы) и для когортного отчета
 * (buildCohortReport_, где обеими "выборками" оказываются согласованные
 * массивы Cohort.build) — расчет один и тот же, отличаются только
 * строки, которые в него передаются.
 */
function computeReportMetrics_(yearLabel, rows, headers, populationSize) {

  const enps = Statistics.calculateENPS(rows, headers, populationSize);

  const averageRatings = Statistics.calculateAverageRatings(rows, headers, populationSize);

  const distributions = Questions.getDistributionQuestions().map(question => {
    const reportQuestion = getReportDistributionQuestion_(question);
    return {
      question: reportQuestion,
      items: Statistics.calculateDistribution(
        getReportDistributionRows_(yearLabel, reportQuestion, rows, headers),
        headers,
        reportQuestion
      )
    };
  });

  const topAnswerFrequencies = Questions.getTopAnswerQuestions().map(question => ({
    question: question,
    frequencies: Statistics.calculateAnswerFrequencies(rows, headers, question)
  }));

  const topAnswers = topAnswerFrequencies.map(entry => ({
    question: entry.question,
    items: Statistics.selectTopAnswers(entry.frequencies, 5)
  }));

  return {
    enps: enps,
    averageRatings: averageRatings,
    distributions: distributions,
    topAnswerFrequencies: topAnswerFrequencies,
    topAnswers: topAnswers
  };

}

/** Чистая сборка знаменателя и явки одного года для reportData. */
function calculateResponseRateForYear_(year, yearSample, filters) {

  const invited = Headcount.invitedForFilters(year, filters);
  const headcount = invited.supported ? invited.count : null;
  const responseRatePercent = yearSample && invited.supported && invited.count
    ? MathStats.round(yearSample.rows.length / invited.count * 100, 1)
    : null;

  return { headcount: headcount, responseRatePercent: responseRatePercent };

}

/**
 * Отчет по сквозной когорте: сотрудники, ответившие и в 2025, и в 2026.
 *
 * Фильтры применяются раздельно к строкам каждого года (как в
 * AnalyticsService.build) — ДО сопоставления, а не после, иначе
 * фильтр по данным, которые различаются между годами (например,
 * "Отдел" при переходах между отделами), сузил бы уже готовую когорту
 * несимметрично. Само сопоставление не переписывается — используется
 * существующий Cohort.build.
 *
 * Показатели отчета считаются ТОЛЬКО по согласованным массивам
 * matched.now/matched.before, поэтому размер выборки 2026 и 2025
 * в когортном отчете всегда совпадает.
 */
function buildCohortReport_(source, filters, customReportName) {

  if (source !== '2026') {
    throw new Error("Сквозная когорта доступна только для источника \"Ответы 2026\"");
  }

  const survey = loadEnrichedSurveyData_('2026', true);
  const filteredNow = FilterEngine.applyFilters(survey.data, survey.headers, filters, "2026");

  let survey2025;

  try {
    survey2025 = loadEnrichedSurveyData_('2025', true);
  } catch (error) {
    throw new Error("Не удалось построить когортный отчет: " + error.message);
  }

  const filteredBefore = FilterEngine.applyFilters(survey2025.data, survey2025.headers, filters, "2025");

  const matched = Cohort.build(filteredNow, filteredBefore, survey.headers, survey2025.headers);

  if (matched.reason) {
    throw new Error("Не удалось построить когортный отчет: " + matched.reason);
  }

  if (matched.size === 0) {
    throw new Error(
      "Сквозная когорта пуста: нет сотрудников, ответивших и в 2025, и в 2026 при заданных фильтрах"
    );
  }

  const metricsNow = computeReportMetrics_('2026', matched.now, survey.headers);
  const metricsBefore = computeReportMetrics_('2025', matched.before, survey2025.headers);

  const comparison = Comparison.build(
    { employees: matched.size, enps: metricsNow.enps, averageRatings: metricsNow.averageRatings },
    { employees: matched.size, enps: metricsBefore.enps, averageRatings: metricsBefore.averageRatings },
    metricsNow.distributions,
    metricsBefore.distributions,
    metricsNow.topAnswerFrequencies,
    metricsBefore.topAnswerFrequencies
  );

  const roster = Cohort.roster(matched, survey.headers, survey2025.headers);

  const trimmedCustomName = (customReportName || "").trim();
  const isCustomName = trimmedCustomName.length > 0;
  const reportName = isCustomName
    ? ReportBuilder.sanitizeSheetName(trimmedCustomName)
    : ReportBuilder.generateCohortReportName(filters);

  const cohortInfo = { size: matched.size, droppedDuplicates: matched.droppedDuplicates };

  const reportData = {
    employees: matched.size,
    filters: filters,
    source: '2026',
    currentYear: '2026',
    previousYear: '2025',
    enps: metricsNow.enps,
    enpsByYear: { '2026': metricsNow.enps, '2025': metricsBefore.enps },
    employeesByYear: { '2026': matched.size, '2025': matched.size },
    // Когорта — не все заполнившие анкету, поэтому делить ее размер на
    // численность приглашенных и называть результат явкой нельзя.
    headcountByYear: { '2026': null, '2025': null },
    responseRateByYear: { '2026': null, '2025': null },
    averageRatings: metricsNow.averageRatings,
    distributions: metricsNow.distributions,
    topAnswers: metricsNow.topAnswers,
    headers: survey.headers,
    filteredRows: matched.now,
    comparison: comparison,
    cohortOnly: true,
    cohortInfo: cohortInfo,
    cohortRoster: roster,
    segmentContext: SegmentContext.forFilters('2026', filters)
  };

  const sheet = ReportBuilder.createReport(reportData, reportName, isCustomName);

  let summaryError = null;

  try {
    Summary.update(reportData, sheet);
  } catch (error) {
    summaryError = error.message;
  }

  return {
    source: '2026',
    employees: matched.size,
    filters: filters,
    sheetName: sheet.getName(),
    comparison: comparison,
    summaryError: summaryError,
    cohortOnly: true,
    cohortInfo: cohortInfo
  };

}

/**
 * Есть ли среди фильтров хотя бы один, доступный только для "Ответы
 * 2026" (обогащение справочником "перформанс" — см.
 * Questions.getPerformanceOnlyTitles, PerformanceDirectory.gs).
 */
function hasPerformanceOnlyFilter_(filters) {

  const titles = Questions.getPerformanceOnlyTitles();

  return (filters || []).some(filter => titles.indexOf(filter.question) !== -1);

}

function buildReport(source, filters, compareWith2025, customReportName, cohortOnly) {

  // В 2025 году нет ни "Соответствие ожиданиям", ни "Грейд", ни "Роль
  // в отделе" — сравнивать отфильтрованный по ним срез 2026 со всей
  // компанией 2025 (или строить когорту, которая тоже сопоставляет
  // с 2025) было бы некорректно. Останавливаем построение ДО загрузки
  // данных.
  if ((compareWith2025 || cohortOnly) && hasPerformanceOnlyFilter_(filters)) {
    throw new Error(
      "Сравнение с 2025 недоступно для фильтров «Соответствие ожиданиям», «Грейд» и «Роль в отделе»: " +
      "в данных 2025 этих признаков нет."
    );
  }

  if (cohortOnly) {
    return buildCohortReport_(source, filters, customReportName);
  }

  // ==========================================================
  // Загружаем данные
  // ==========================================================

  const survey = loadEnrichedSurveyData_(source, true);

  // ==========================================================
  // Применяем фильтры
  // ==========================================================

  const filteredData = FilterEngine.applyFilters(
    survey.data,
    survey.headers,
    filters,
    source
  );

  // ==========================================================
  // Рассчитываем статистику
  // ==========================================================

  // Численность (N) для поправки на конечную совокупность (FPC, см.
  // MathStats.finitePopulationCorrection) — та же численность, что
  // используется ниже для явки (calculateResponseRateForYear_).
  // null, если текущий набор фильтров не сводится к одному отделу/
  // управлению/группе команд (Headcount.invitedForFilters) — тогда
  // ДИ считается без поправки, как раньше.
  const sourceHeadcount = calculateResponseRateForYear_(source, { rows: filteredData }, filters).headcount;

  const enps = Statistics.calculateENPS(
    filteredData,
    survey.headers,
    sourceHeadcount
  );

  const averageRatings = Statistics.calculateAverageRatings(
    filteredData,
    survey.headers,
    sourceHeadcount
  );

  const distributions = Questions.getDistributionQuestions().map(question => {
    const reportQuestion = getReportDistributionQuestion_(question);
    return {
      question: reportQuestion,
      items: Statistics.calculateDistribution(
        getReportDistributionRows_(source, reportQuestion, filteredData, survey.headers),
        survey.headers,
        reportQuestion
      )
    };
  });

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

      const yearSurvey = loadEnrichedSurveyData_(year, true);

      samplesByYear[year] = {
        headers: yearSurvey.headers,
        rows: FilterEngine.applyFilters(yearSurvey.data, yearSurvey.headers, filters, year)
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
  const headcountByYear = {};
  const responseRateByYear = {};

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

    const coverage = calculateResponseRateForYear_(year, yearSample, filters);
    headcountByYear[year] = coverage.headcount;
    responseRateByYear[year] = coverage.responseRatePercent;

    enpsByYear[year] = (year === source)
      ? enps
      : (yearSample ? Statistics.calculateENPS(yearSample.rows, yearSample.headers, headcountByYear[year]) : null);

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

    const distributions2025 = Questions.getDistributionQuestions().map(question => {
      const reportQuestion = getReportDistributionQuestion_(question);
      return {
        question: reportQuestion,
        items: Statistics.calculateDistribution(
          getReportDistributionRows_('2025', reportQuestion, filteredData2025, sample2025.headers),
          sample2025.headers,
          reportQuestion
        )
      };
    });

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
      sample2025.headers,
      headcountByYear['2025']
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
      topAnswerFrequencies2025,
      headcountByYear['2026'],
      headcountByYear['2025']
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
    // Явные периоды для пользовательских подписей отчета. Внутренние
    // поля Comparison пока сохраняют исторические имена value2026/
    // value2025, но видимый год больше не выводится из этих имен.
    currentYear: source,
    previousYear: comparisonEnabled ? '2025' : null,
    enps: enps,
    // Размер выборки и eNPS по каждому году отдельно — нужны сводной
    // аналитике, которая должна быть одинаково полной при любом
    // источнике и при выключенном сравнении. Детальный отчет ими не
    // пользуется: он показывает выборку и eNPS выбранного источника
    // (employees/enps) и динамику из comparison. Год без данных — null.
    enpsByYear: enpsByYear,
    employeesByYear: employeesByYear,
    // Число приглашенных и доля заполнивших для каждого года. Значение
    // null означает, что на листе нет численности этого года либо
    // активный фильтр требует неизвестного знаменателя (например город).
    headcountByYear: headcountByYear,
    responseRateByYear: responseRateByYear,
    averageRatings: averageRatings,
    distributions: distributions,
    topAnswers: topAnswers,
    headers: survey.headers,
    filteredRows: filteredData,
    comparison: comparison,
    segmentContext: SegmentContext.forFilters(source, filters)
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
    headcount: headcountByYear[source],
    responseRatePercent: responseRateByYear[source],
    summaryError: summaryError
  };

}
