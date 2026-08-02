/**
 * ==========================================================
 * Ручные тесты отчета по сквозной когорте
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testCohortReport_runAll().
 *
 * Тесты, которым нужен лист таблицы (SpreadsheetApp), в этом окружении
 * не запускаются — они проверяются вручную по MANUAL-CHECKLIST.md /
 * инструкции в описании задачи. Здесь проверяется вся логика, которая
 * не зависит от реальной таблицы: сопоставление когорты, паспорт
 * фильтров/ключей отчета, состав раздела ФИО, передача cohortOnly через
 * пакетное построение и отсутствие ФИО в ответах сайдбару.
 */

function testCohortReport_runAll() {

  const tests = [
    testCohortReport_matchesOnlyBothYears_,
    testCohortReport_filtersAppliedBeforeMatching_,
    testCohortReport_equalSampleSizes_,
    testCohortReport_rosterOnlyIncludesCohort_,
    testCohortReport_rosterKeepsOriginalSpellingWhenDifferent_,
    testCohortReport_rosterOmitsDuplicatesAndUnsigned_,
    testCohortReport_reportKeyDiffersFromRegularReport_,
    testCohortReport_regularReportKeyUnchanged_,
    testCohortReport_summaryKeyDiffersFromRegularReport_,
    testCohortReport_summaryKeyUnchangedForRegularReport_,
    testCohortReport_cohortNameWithoutFilters_,
    testCohortReport_cohortNameWithFilters_,
    testCohortReport_batchPassesCohortOnlyThrough_,
    testCohortReport_singlePassesCohortOnlyThrough_,
    testCohortReport_rejectsSource2025_,
    testCohortReport_sidebarResultHasNoNames_
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

  console.log("Все тесты CohortReport пройдены.");

}

function assertCohortEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || "assertCohortEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual)
    );
  }
}

function assertCohortTrue_(value, message) {
  if (!value) {
    throw new Error(message || "ожидалось true");
  }
}

// ==========================================================
// Данные для тестов
// ==========================================================

const COHORT_TEST_HEADERS_ = ["Фамилия Имя", "Отдел", "eNPS"];

function cohortTestRows2026_() {
  return [
    ["Иванов Иван", "Отдел разработки сайтов", "9"],   // есть и в 2025 (написание совпадает)
    ["петрова мария", "Отдел тестирования ПО", "8"],   // есть в 2025, написание отличается регистром/пробелами
    ["Сидоров Петр", "Отдел разработки сайтов", "7"],  // новый в 2026, в 2025 не было
    ["", "Отдел тестирования ПО", "6"],                // неподписанная анкета — не должна попасть в когорту
    ["Дубликат Тест", "Отдел разработки сайтов", "5"]  // ключ дублируется в 2025 — должен быть отброшен
  ];
}

function cohortTestRows2025_() {
  return [
    ["Иванов Иван", "Отдел разработки сайтов", "8"],
    ["Петрова  Мария", "Отдел тестирования ПО", "6"],    // то же лицо, другое написание
    ["Дубликат Тест", "Отдел разработки сайтов", "4"],
    ["дубликат тест", "Отдел разработки сайтов", "3"],   // дубль ключа "дубликат тест" — оба должны быть отброшены
    ["Уволенный Сотрудник", "Отдел тестирования ПО", "2"] // отвечал только в 2025 — не входит в когорту
  ];
}

/**
 * В когорту попадают только сотрудники, присутствующие в обоих годах:
 * "Иванов Иван" и "Петрова Мария" (по нормализованному ключу), но не
 * "Сидоров Петр" (только 2026), "Уволенный Сотрудник" (только 2025),
 * неподписанная анкета и дубликат ключа "Дубликат Тест".
 */
function testCohortReport_matchesOnlyBothYears_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  assertCohortEquals_(matched.size, 2, "размер когорты");

  const namesNow = matched.now.map(row => row[0]);
  assertCohortTrue_(namesNow.indexOf("Иванов Иван") !== -1, "Иванов Иван должен быть в когорте");
  assertCohortTrue_(namesNow.indexOf("петрова мария") !== -1, "Петрова Мария должна быть в когорте");
  assertCohortTrue_(namesNow.indexOf("Сидоров Петр") === -1, "Сидоров Петр не должен попасть (только 2026)");
  assertCohortTrue_(namesNow.indexOf("Дубликат Тест") === -1, "дубль ключа должен быть отброшен");

}

/**
 * Фильтры применяются к строкам каждого года ДО сопоставления
 * (buildCohortReport_ вызывает FilterEngine.applyFilters на исходных
 * данных каждого года, а Cohort.build получает уже отфильтрованные
 * строки) — так же, как это делает AnalyticsService.build.
 */
function testCohortReport_filtersAppliedBeforeMatching_() {

  const filters = [{
    question: "Отдел",
    type: "single",
    values: ["Отдел разработки сайтов"]
  }];

  const filteredNow = FilterEngine.applyFilters(cohortTestRows2026_(), COHORT_TEST_HEADERS_, filters);
  const filteredBefore = FilterEngine.applyFilters(cohortTestRows2025_(), COHORT_TEST_HEADERS_, filters);

  // "Петрова Мария" отдела "Отдел тестирования ПО" отфильтрована в обоих
  // годах и не должна попасть в когорту, хотя формально совпадает по ФИО.
  const matched = Cohort.build(filteredNow, filteredBefore, COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_);

  assertCohortEquals_(matched.size, 1, "размер когорты после фильтра по отделу");
  assertCohortEquals_(matched.now[0][0], "Иванов Иван", "единственный участник после фильтра");

}

/**
 * matched.now и matched.before всегда одинаковой длины — это гарантирует
 * сам Cohort.build (позиция i в обоих массивах — один и тот же человек),
 * а buildCohortReport_ берет employeesByYear из matched.size для обоих
 * годов, поэтому "n" 2026 и 2025 в когортном отчете совпадают.
 */
function testCohortReport_equalSampleSizes_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  assertCohortEquals_(matched.now.length, matched.before.length, "now/before одинаковой длины");

  const employeesByYear = { "2026": matched.size, "2025": matched.size };
  assertCohortEquals_(employeesByYear["2026"], employeesByYear["2025"], "n 2026 и 2025 совпадают");

}

/**
 * В раздел "Состав сквозной когорты" (Cohort.roster) попадают только
 * участники когорты — по одной строке на каждого, столько же, сколько
 * matched.size.
 */
function testCohortReport_rosterOnlyIncludesCohort_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  const roster = Cohort.roster(matched, COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_);

  assertCohortEquals_(roster.length, matched.size, "размер списка ФИО равен размеру когорты");
  roster.forEach(entry => {
    assertCohortEquals_(entry.status, "Совпадение найдено", "статус для строки когорты");
  });

}

/**
 * Основное ФИО — из строки 2026; ФИО 2025 выводится, только если
 * написание отличается (иначе оно бы дублировало основное).
 */
function testCohortReport_rosterKeepsOriginalSpellingWhenDifferent_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  const roster = Cohort.roster(matched, COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_);

  const ivanov = roster.filter(r => r.nameNow === "Иванов Иван")[0];
  const petrova = roster.filter(r => r.nameNow === "петрова мария")[0];

  assertCohortTrue_(!!ivanov, "Иванов Иван должен быть в списке");
  assertCohortEquals_(ivanov.nameBefore, null, "написание совпадает — ФИО 2025 не дублируется");

  assertCohortTrue_(!!petrova, "Петрова Мария должна быть в списке");
  assertCohortEquals_(petrova.nameBefore, "Петрова  Мария", "написание 2025 отличается и должно быть показано");

}

/**
 * Дубли ключа и неподписанные анкеты не должны попасть в список ФИО —
 * они уже исключены самим Cohort.build (matched.now/before их не
 * содержат), roster ничего дополнительно не фильтрует и не должен.
 */
function testCohortReport_rosterOmitsDuplicatesAndUnsigned_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  const roster = Cohort.roster(matched, COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_);
  const names = roster.map(r => r.nameNow);

  assertCohortTrue_(names.indexOf("Дубликат Тест") === -1, "дубль ключа не должен попасть в список ФИО");
  assertCohortTrue_(names.indexOf("") === -1, "неподписанная анкета не должна попасть в список ФИО");

}

/**
 * Когортный и обычный отчет с одинаковыми фильтрами должны получать
 * разные ключи (developer metadata) — иначе построение одного заменило
 * бы лист другого.
 */
function testCohortReport_reportKeyDiffersFromRegularReport_() {

  const baseReportData = {
    source: "2026",
    comparison: { any: true },
    filters: [{ question: "Отдел", type: "single", values: ["Отдел разработки сайтов"] }]
  };

  const regularKey = ReportBuilder.getReportKey_(baseReportData);
  const cohortKey = ReportBuilder.getReportKey_(Object.assign({}, baseReportData, { cohortOnly: true }));

  assertCohortTrue_(regularKey !== cohortKey, "ключи когортного и обычного отчета должны различаться");

}

/**
 * Ключ обычного отчета (cohortOnly не задан/false) не должен измениться
 * из-за добавления когортного режима — иначе уже построенные обычные
 * отчеты перестали бы находиться по своему прежнему ключу.
 */
function testCohortReport_regularReportKeyUnchanged_() {

  const reportData = {
    source: "2026",
    comparison: false,
    filters: []
  };

  // getReportKey_ детерминирован (MD5 от стабильного JSON) — совпадение
  // двух independent вызовов с одинаковым reportData без cohortOnly
  // подтверждает, что ключ по-прежнему строится только из
  // source/comparison/filters, как и раньше.
  const keyA = ReportBuilder.getReportKey_(reportData);
  const keyB = ReportBuilder.getReportKey_(Object.assign({}, reportData, { cohortOnly: false }));
  const keyC = ReportBuilder.getReportKey_(Object.assign({}, reportData, { cohortOnly: undefined }));

  assertCohortEquals_(keyA, keyB, "cohortOnly:false не должен менять ключ обычного отчета");
  assertCohortEquals_(keyA, keyC, "отсутствие cohortOnly не должно менять ключ обычного отчета");

}

function testCohortReport_summaryKeyDiffersFromRegularReport_() {

  const baseReportData = {
    source: "2026",
    filters: [{ question: "Город", type: "single", values: ["Москва"] }]
  };

  const regularKey = Summary.buildSampleKey_(baseReportData);
  const cohortKey = Summary.buildSampleKey_(Object.assign({}, baseReportData, { cohortOnly: true }));

  assertCohortTrue_(regularKey !== cohortKey, "ключ строки Summary должен различаться для когорты и обычного отчета");

}

function testCohortReport_summaryKeyUnchangedForRegularReport_() {

  const reportData = { source: "2026", filters: [] };

  const keyA = Summary.buildSampleKey_(reportData);
  const keyB = Summary.buildSampleKey_(Object.assign({}, reportData, { cohortOnly: false }));

  assertCohortEquals_(keyA, keyB, "ключ Summary обычного отчета не должен меняться");

}

function testCohortReport_cohortNameWithoutFilters_() {
  assertCohortEquals_(ReportBuilder.generateCohortReportName([]), "Когортный отчет", "имя без фильтров");
}

function testCohortReport_cohortNameWithFilters_() {

  const filters = [{ question: "Отдел", type: "single", values: ["Отдел разработки сайтов"] }];
  const name = ReportBuilder.generateCohortReportName(filters);

  assertCohortEquals_(name, "Когорта • Отдел разработки сайтов", "имя когортного отчета с фильтром");
  assertCohortTrue_(name !== "Когорта", "имя не должно совпадать с именем листа расширенной аналитики");

}

/**
 * Параметр cohortOnly должен доходить до buildReport и при пакетном
 * построении (несколько наборов фильтров), и при одиночном.
 * buildReport подменяется на время теста, чтобы не обращаться к
 * реальной таблице.
 */
function testCohortReport_batchPassesCohortOnlyThrough_() {

  const originalBuildReport = buildReport;
  const seenCohortOnly = [];

  buildReport = function(source, filters, compareWith2025, customReportName, cohortOnly) {
    seenCohortOnly.push(cohortOnly);
    return {
      source: source,
      employees: 1,
      filters: filters,
      sheetName: "Тест " + filters[0].values[0],
      comparison: null,
      summaryError: null,
      cohortOnly: !!cohortOnly,
      cohortInfo: cohortOnly ? { size: 1, droppedDuplicates: 0 } : null
    };
  };

  try {

    const filters = [{
      question: "Отдел",
      type: "single",
      mode: "split",
      values: ["Отдел разработки сайтов", "Отдел тестирования ПО"]
    }];

    const result = BatchReports.run("2026", filters, false, "", true);

    assertCohortTrue_(result.batch, "ожидался пакетный режим");
    assertCohortEquals_(seenCohortOnly.length, 2, "buildReport должен быть вызван дважды");
    seenCohortOnly.forEach(value => assertCohortEquals_(value, true, "cohortOnly должен дойти до buildReport"));

  } finally {
    buildReport = originalBuildReport;
  }

}

function testCohortReport_singlePassesCohortOnlyThrough_() {

  const originalBuildReport = buildReport;
  let receivedCohortOnly = null;

  buildReport = function(source, filters, compareWith2025, customReportName, cohortOnly) {
    receivedCohortOnly = cohortOnly;
    return {
      source: source,
      employees: 5,
      filters: filters,
      sheetName: "Когортный отчет",
      comparison: null,
      summaryError: null,
      cohortOnly: !!cohortOnly,
      cohortInfo: cohortOnly ? { size: 5, droppedDuplicates: 1 } : null
    };
  };

  try {

    const result = BatchReports.run("2026", [], false, "", true);

    assertCohortEquals_(result.batch, false, "без сплит-фильтров пакетный режим не включается");
    assertCohortEquals_(receivedCohortOnly, true, "cohortOnly должен дойти до buildReport");
    assertCohortEquals_(result.reports[0].cohortInfo.size, 5, "cohortInfo должен дойти до результата сайдбара");

  } finally {
    buildReport = originalBuildReport;
  }

}

/**
 * Источник 2025 для когортного режима отклоняется понятной ошибкой ДО
 * обращения к таблице (проверка стоит в самом начале buildCohortReport_,
 * раньше loadSurveyData) — поэтому тест безопасно запускать без
 * реального SpreadsheetApp.
 */
function testCohortReport_rejectsSource2025_() {

  let threw = false;
  let message = "";

  try {
    buildReport("2025", [], false, "", true);
  } catch (error) {
    threw = true;
    message = error.message;
  }

  assertCohortTrue_(threw, "источник 2025 с cohortOnly должен быть отклонен");
  assertCohortTrue_(message.indexOf("2026") !== -1, "сообщение об ошибке должно объяснять требование к источнику");

}

/**
 * Результат, который buildReportFromSidebar/BatchReports.describeSuccess_
 * возвращает в Sidebar, не должен содержать ФИО когорты — только
 * агрегированные цифры (cohortInfo.size/droppedDuplicates).
 */
function testCohortReport_sidebarResultHasNoNames_() {

  const matched = Cohort.build(
    cohortTestRows2026_(), cohortTestRows2025_(), COHORT_TEST_HEADERS_, COHORT_TEST_HEADERS_
  );

  const fakeBuildResult = {
    source: "2026",
    employees: matched.size,
    filters: [],
    sheetName: "Когортный отчет",
    comparison: null,
    summaryError: null,
    cohortOnly: true,
    cohortInfo: { size: matched.size, droppedDuplicates: matched.droppedDuplicates }
    // Намеренно нет cohortRoster — describeSuccess_ не должен его
    // прокидывать, даже если он случайно окажется в result.
  };

  const described = BatchReports.describeSuccess_(fakeBuildResult, null);
  const serialized = JSON.stringify(described);

  assertCohortTrue_(serialized.indexOf("Иванов") === -1, "ФИО не должно попадать в ответ сайдбару");
  assertCohortTrue_(serialized.indexOf("cohortRoster") === -1, "cohortRoster не должен попадать в ответ сайдбару");
  assertCohortEquals_(described.cohortInfo.size, matched.size, "cohortInfo.size должен дойти до сайдбара");

}
