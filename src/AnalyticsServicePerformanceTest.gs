/**
 * ==========================================================
 * Ручные тесты: новые срезы "Соответствие ожиданиям"/"Грейд"
 * в AnalyticsService.build
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testAnalyticsServicePerformance_runAll().
 *
 * loadEnrichedSurveyData_ подменяется на фикстуру (тот же прием
 * подмены глобальной функции, что и в CohortReportTest.gs для
 * buildReport) — тест не требует реального листа "перформанс" и
 * реального SpreadsheetApp.
 */

function testAnalyticsServicePerformance_runAll() {

  const tests = [
    testAnalyticsServicePerformance_addsPerformanceDimensionsFor2026_,
    testAnalyticsServicePerformance_incompleteHeadcountDoesNotBlock_,
    testAnalyticsServicePerformance_noPerformanceDimensionsForOtherYears_,
    testAnalyticsServicePerformance_performanceDimensionsHaveNoHistory_,
    testAnalyticsServicePerformance_performanceDimensionsExcludedFromComposition_
  ];

  const failures = [];

  tests.forEach(test => {
    try {
      test();
      console.log("PASS: " + test.name);
    } catch (error) {
      failures.push(test.name + ": " + error.message);
      console.error("FAIL: " + test.name + " — " + error.message);
    }
  });

  if (failures.length) {
    throw new Error(failures.length + " тест(ов) упало:\n" + failures.join("\n"));
  }

  console.log("Все тесты AnalyticsServicePerformance пройдены.");

}

function assertASPEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertASPEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertASPTrue_(value, message) {
  if (!value) throw new Error(message || "ожидалось true");
}

const ASP_HEADERS_ = ["Фамилия Имя", "Отдел", "Формат работы", "Стаж", "Город",
  "Соответствие ожиданиям", "Грейд", "Роль в отделе", "eNPS"];

function aspRow_(name, department, format, tenure, city, expectations, grade, role, enps) {
  return [name, department, format, tenure, city, expectations, grade, role, enps];
}

function aspRows2026_() {
  return [
    aspRow_("A", "Отдел разработки сайтов", "полностью из офиса", "от 1 года до 3х лет", "Москва", "Соответствует", "middle", "Сотрудник отдела", "9"),
    aspRow_("B", "Отдел разработки сайтов", "полностью из офиса", "от 1 года до 3х лет", "Москва", "Превышает", "senior", "Сотрудник отдела", "8"),
    aspRow_("C", "Отдел тестирования ПО", "полностью удаленно", "от 3х до 6 лет", "Казань", "Соответствует", "junior", "Сотрудник отдела", "7")
  ];
}

function aspHeadcountRows_() {
  return [
    { year: "2025", departmentId: "sites", division: "Управление", department: "Отдел разработки сайтов", count: 5, row: 2 },
    { year: "2025", departmentId: "testing", division: "Управление", department: "Отдел тестирования ПО", count: 4, row: 3 },
    { year: "2026", departmentId: "sites", division: "Управление", department: "Отдел разработки сайтов", count: 6, row: 4 },
    { year: "2026", departmentId: "testing", division: "Управление", department: "Отдел тестирования ПО", count: 5, row: 5 }
  ];
}

/**
 * Подменяет loadEnrichedSurveyData_ фикстурой: для "2026" отдает
 * обогащенные строки (включая "Соответствие ожиданиям"/"Грейд"), для
 * "2025" — бросает ошибку (листа нет), как и в реальном проекте на
 * начальном этапе — AnalyticsService должен пережить это через
 * hasPrevious=false.
 */
function withAnalyticsServiceFixture_(fn) {

  const original = loadEnrichedSurveyData_;
  const originalHeadcountRows = Headcount.rowsCache_;
  const originalHeadcountDirectory = Headcount.directory_;

  Headcount.rowsCache_ = aspHeadcountRows_();
  Headcount.directory_ = null;

  loadEnrichedSurveyData_ = function (source, includeData) {
    if (source === "2026") {
      return { source: "Ответы 2026", rows: 3, columns: ASP_HEADERS_.length, headers: ASP_HEADERS_, data: aspRows2026_() };
    }
    throw new Error("Лист \"Ответы 2025\" не найден");
  };

  try {
    fn();
  } finally {
    loadEnrichedSurveyData_ = original;
    Headcount.rowsCache_ = originalHeadcountRows;
    Headcount.directory_ = originalHeadcountDirectory;
  }

}

function testAnalyticsServicePerformance_addsPerformanceDimensionsFor2026_() {

  withAnalyticsServiceFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);
    const dimensionTitles = analytics.segments.map(s => s.dimension);

    assertASPTrue_(dimensionTitles.indexOf("Соответствие ожиданиям") !== -1, "срез \"Соответствие ожиданиям\" добавлен");
    assertASPTrue_(dimensionTitles.indexOf("Грейд") !== -1, "срез \"Грейд\" добавлен");

  });

}

function testAnalyticsServicePerformance_incompleteHeadcountDoesNotBlock_() {

  const originalDataLoader = loadEnrichedSurveyData_;
  const originalHeadcountLoader = Headcount.loadRows_;

  Headcount.resetCache_();
  Headcount.loadRows_ = function () {
    throw new Error("строка 2: численность пока не заполнена");
  };
  loadEnrichedSurveyData_ = function (source, includeData) {
    if (source === "2026") {
      return {
        source: "Ответы 2026",
        rows: 3,
        columns: ASP_HEADERS_.length,
        headers: ASP_HEADERS_,
        data: aspRows2026_()
      };
    }
    throw new Error('Лист "Ответы 2025" не найден');
  };

  try {
    const analytics = AnalyticsService.build("2026", "2025", []);
    const department = analytics.segments.find(item => item.dimension === "Отдел");

    assertASPEquals_(analytics.meta.n, 3, "все ответы вошли в расширенную аналитику");
    assertASPTrue_(!!department, "срез по отделам построен без численности");
    assertASPEquals_(department.company.headcount, undefined, "численность не подставлена");
    assertASPEquals_(department.company.responseRatePercent, undefined, "явка не рассчитывается");
  } finally {
    loadEnrichedSurveyData_ = originalDataLoader;
    Headcount.loadRows_ = originalHeadcountLoader;
    Headcount.resetCache_();
  }

}

function testAnalyticsServicePerformance_noPerformanceDimensionsForOtherYears_() {

  const original = loadEnrichedSurveyData_;
  const originalHeadcountRows = Headcount.rowsCache_;
  const originalHeadcountDirectory = Headcount.directory_;

  Headcount.rowsCache_ = aspHeadcountRows_();
  Headcount.directory_ = null;

  loadEnrichedSurveyData_ = function (source, includeData) {
    return { source: source, rows: 3, columns: ASP_HEADERS_.length, headers: ASP_HEADERS_, data: aspRows2026_() };
  };

  try {

    // sourceYear = "2025": новые срезы добавляются только при
    // sourceYear === "2026" — здесь их быть не должно, даже если
    // (гипотетически) в данных случайно оказались бы такие колонки.
    const analytics = AnalyticsService.build("2025", "2025", []);
    const dimensionTitles = analytics.segments.map(s => s.dimension);

    assertASPTrue_(dimensionTitles.indexOf("Соответствие ожиданиям") === -1, "нет среза \"Соответствие ожиданиям\" для 2025");
    assertASPTrue_(dimensionTitles.indexOf("Грейд") === -1, "нет среза \"Грейд\" для 2025");

  } finally {
    loadEnrichedSurveyData_ = original;
    Headcount.rowsCache_ = originalHeadcountRows;
    Headcount.directory_ = originalHeadcountDirectory;
  }

}

/**
 * Новые срезы не должны пытаться использовать данные 2025: previousN=0
 * и yearDelta=null для каждой группы, независимо от того, что для
 * ОСТАЛЬНЫХ срезов сравнение с прошлым годом в этом же прогоне
 * доступно (hasPrevious могло бы быть true, если бы 2025 не бросал
 * ошибку — здесь она нарочно бросается, чтобы дополнительно
 * убедиться, что это не влияет на признак noHistory).
 */
function testAnalyticsServicePerformance_performanceDimensionsHaveNoHistory_() {

  withAnalyticsServiceFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);

    ["Соответствие ожиданиям", "Грейд"].forEach(title => {

      const dimension = analytics.segments.find(s => s.dimension === title);

      assertASPTrue_(dimension.noHistory === true, "\"" + title + "\": noHistory=true");

      dimension.segments.forEach(segment => {
        assertASPEquals_(segment.previousN, 0, "\"" + title + "\"/" + segment.name + ": previousN=0");
        assertASPEquals_(segment.yearDelta, null, "\"" + title + "\"/" + segment.name + ": yearDelta=null");
      });

    });

  });

}

function testAnalyticsServicePerformance_performanceDimensionsExcludedFromComposition_() {

  withAnalyticsServiceFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);

    const compositionDimensions = analytics.composition.map(entry => entry.dimension);

    assertASPTrue_(compositionDimensions.indexOf("Соответствие ожиданиям") === -1,
      "\"Соответствие ожиданиям\" не участвует в compositionShift (нет данных 2025 для сравнения состава)");
    assertASPTrue_(compositionDimensions.indexOf("Грейд") === -1,
      "\"Грейд\" не участвует в compositionShift");

  });

}
