/**
 * ==========================================================
 * Ручные тесты справочника "перформанс"
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testPerformanceDirectory_runAll().
 *
 * PerformanceDirectory.parse_/enrich_ — чистые функции над уже
 * прочитанными массивами, не требуют SpreadsheetApp (тот же прием,
 * что и у SegmentsTest.gs/CohortReportTest.gs).
 */

function testPerformanceDirectory_runAll() {

  const tests = [
    testPerformanceDirectory_parsesValidDirectory_,
    testPerformanceDirectory_normalizesNameForMatching_,
    testPerformanceDirectory_rejectsMissingHeaders_,
    testPerformanceDirectory_collectsDuplicateNamesAsIssueNotThrow_,
    testPerformanceDirectory_collectsInvalidManagerValueAsIssueNotThrow_,
    testPerformanceDirectory_skipsEmptyRows_,
    testPerformanceDirectory_managerCanHaveGradeLead_,
    testPerformanceDirectory_employeeCanHaveGradeLeadWithoutBeingManager_,
    testPerformanceDirectory_enrichJoinsExpectationsGradeRole_,
    testPerformanceDirectory_enrichDoesNotMutateInputArrays_,
    testPerformanceDirectory_enrichDoesNotThrowOnMissingRespondent_,
    testPerformanceDirectory_enrichDoesNotThrowOnCityMismatch_,
    testPerformanceDirectory_enrichDoesNotThrowOnDepartmentMismatch_,
    testPerformanceDirectory_enrichExcludesMismatchedRowFromNewFields_,
    testPerformanceDirectory_loadEnrichedPassesThroughFor2025AndBoth_,
    testPerformanceDirectory_loadEnrichedFallsBackWhenDirectoryBroken_,
    testPerformanceDirectory_directoryErrorDoesNotAffect2025_,
    testPerformanceDirectory_managerIssuesExactlyOneManagerIsClean_,
    testPerformanceDirectory_managerIssuesReportsMissingManager_,
    testPerformanceDirectory_managerIssuesReportsMultipleManagers_,
    testPerformanceDirectory_managerIssuesDoesNotStopAtFirstError_,
    testPerformanceDirectory_managerIssuesIndependentOfGrade_,
    testPerformanceDirectory_countsForFiltersUnfiltered_,
    testPerformanceDirectory_countsForFiltersExcludesEmptyValues_,
    testPerformanceDirectory_countsForFiltersSupportsDepartmentFilter_,
    testPerformanceDirectory_countsForFiltersUnsupportedForOtherFilters_,
    testPerformanceDirectory_countsForFiltersUnsupportedWhenDirectoryBroken_
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

  console.log("Все тесты PerformanceDirectory пройдены.");

}

function assertPerfEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertPerfEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertPerfTrue_(value, message) {
  if (!value) {
    throw new Error(message || "ожидалось true");
  }
}

function assertPerfThrows_(fn, messageContains, description) {

  let threw = false;
  let message = "";

  try {
    fn();
  } catch (error) {
    threw = true;
    message = error.message;
  }

  assertPerfTrue_(threw, (description || "должно было выброситься исключение"));

  if (messageContains) {
    assertPerfTrue_(message.indexOf(messageContains) !== -1,
      (description || "assertPerfThrows_") + ": сообщение должно содержать «" + messageContains +
      "», получено: " + message);
  }

}

// ==========================================================
// Фикстуры
// ==========================================================

const PERF_TEST_HEADERS_ = ["Фамилия Имя", "Город", "Отдел", "Соответствие ожиданиям", "Грейд", "Руководитель отдела"];

function perfDirectoryRows_() {
  return [
    ["Иванов Иван", "Москва", "Отдел разработки сайтов", "Соответствует", "middle", true],
    ["Петрова Мария", "Казань", "Отдел разработки сайтов", "Превышает", "senior", false],
    ["Сидоров Петр", "Казань", "Отдел тестирования ПО", "Соответствует", "lead", false],
    ["", "", "", "", "", ""] // пустая строка — должна игнорироваться
  ];
}

function perfDirectoryValid_() {
  return PerformanceDirectory.parse_(PERF_TEST_HEADERS_, perfDirectoryRows_());
}

// ==========================================================
// parse_
// ==========================================================

function testPerformanceDirectory_parsesValidDirectory_() {

  const directory = perfDirectoryValid_();

  assertPerfEquals_(directory.size, 3, "три содержательные строки справочника");
  assertPerfTrue_(directory.byKey.hasOwnProperty("иванов иван"), "Иванов Иван присутствует по нормализованному ключу");
  assertPerfEquals_(directory.byKey["иванов иван"].isManager, true, "Иванов Иван — руководитель");
  assertPerfEquals_(directory.byKey["петрова мария"].isManager, false, "Петрова Мария — не руководитель");

}

function testPerformanceDirectory_normalizesNameForMatching_() {

  const directory = perfDirectoryValid_();

  // "  Иванов   ИВАН " -> те же правила: обрезать края, схлопнуть
  // пробелы, привести регистр.
  const key = PerformanceDirectory.normalizeName_("  Иванов   ИВАН ");

  assertPerfEquals_(key, "иванов иван", "нормализация ФИО");
  assertPerfTrue_(directory.byKey.hasOwnProperty(key), "нормализованный ключ находит запись справочника");

}

function testPerformanceDirectory_skipsEmptyRows_() {

  const directory = perfDirectoryValid_();
  assertPerfEquals_(Object.keys(directory.byKey).length, 3, "пустая строка не создает запись");

}

function testPerformanceDirectory_rejectsMissingHeaders_() {

  const brokenHeaders = ["Фамилия Имя", "Город", "Отдел", "Грейд", "Руководитель отдела"]; // нет "Соответствие ожиданиям"

  assertPerfThrows_(
    () => PerformanceDirectory.parse_(brokenHeaders, perfDirectoryRows_()),
    "Соответствие ожиданиям",
    "должен требовать столбец \"Соответствие ожиданиям\" (структурная проблема — throw остается)"
  );

}

/**
 * Дубликат ФИО в справочнике больше НЕ блокирует весь лист "перформанс"
 * (см. PerformanceDirectory.parse_/loadEnrichedSurveyData_) — это
 * диагностика, собираемая в directory.issues.duplicateNames, а не
 * исключение. Первая встреченная запись используется как есть.
 */
function testPerformanceDirectory_collectsDuplicateNamesAsIssueNotThrow_() {

  const rows = perfDirectoryRows_().concat([
    ["Иванов Иван", "Москва", "Отдел разработки сайтов", "Соответствует", "middle", false]
  ]);

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);

  assertPerfEquals_(directory.issues.duplicateNames.length, 1, "дубликат собран в issues");
  assertPerfEquals_(directory.issues.duplicateNames[0].name, "Иванов Иван", "имя дубликата верное");
  assertPerfTrue_(directory.byKey.hasOwnProperty("иванов иван"), "первая запись осталась в справочнике");
  assertPerfEquals_(directory.byKey["иванов иван"].isManager, true, "используется именно первая запись (isManager=true), а не вторая");

}

/**
 * Некорректное значение чекбокса "Руководитель отдела" тоже больше не
 * блокирует весь лист — попадает в directory.issues.invalidManagerRows,
 * а сама запись сохраняется с isManager=null (как и раньше).
 */
function testPerformanceDirectory_collectsInvalidManagerValueAsIssueNotThrow_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел разработки сайтов", "Соответствует", "middle", "да"] // не boolean
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);

  assertPerfEquals_(directory.issues.invalidManagerRows.length, 1, "некорректный чекбокс собран в issues");
  assertPerfEquals_(directory.issues.invalidManagerRows[0].name, "Иванов Иван", "имя верное");
  assertPerfEquals_(directory.byKey["иванов иван"].isManager, null, "isManager не определен для некорректной строки");

}

/**
 * Грейд = lead у руководителя отдела — независимые признаки, оба
 * значения сохраняются как есть, ни одно не переопределяет другое.
 */
function testPerformanceDirectory_managerCanHaveGradeLead_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел разработки сайтов", "Соответствует", "lead", true]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const entry = directory.byKey["иванов иван"];

  assertPerfEquals_(entry.grade, "lead", "грейд сохранен как lead");
  assertPerfEquals_(entry.isManager, true, "одновременно является руководителем отдела");

}

/**
 * Грейд = lead у сотрудника, который НЕ руководитель отдела —
 * тоже допустимая независимая комбинация.
 */
function testPerformanceDirectory_employeeCanHaveGradeLeadWithoutBeingManager_() {

  const rows = [
    ["Сидоров Петр", "Казань", "Отдел тестирования ПО", "Соответствует", "lead", false]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const entry = directory.byKey["сидоров петр"];

  assertPerfEquals_(entry.grade, "lead", "грейд lead");
  assertPerfEquals_(entry.isManager, false, "не руководитель отдела");

}

// ==========================================================
// enrich_
// ==========================================================

const SURVEY_2026_TEST_HEADERS_ = ["Фамилия Имя", "Город", "Отдел", "eNPS"];

function survey2026TestRows_() {
  return [
    ["Иванов Иван", "Москва", "Отдел разработки сайтов", "9"],
    ["Петрова Мария", "Казань", "Отдел разработки сайтов", "8"]
  ];
}

function testPerformanceDirectory_enrichJoinsExpectationsGradeRole_() {

  const directory = perfDirectoryValid_();
  const result = PerformanceDirectory.enrich_(SURVEY_2026_TEST_HEADERS_, survey2026TestRows_(), directory);

  assertPerfEquals_(
    result.headers.join("|"),
    "Фамилия Имя|Город|Отдел|eNPS|Соответствие ожиданиям|Грейд|Роль в отделе",
    "заголовки дополнены тремя полями"
  );

  assertPerfEquals_(result.data[0][4], "Соответствует", "Иванов: соответствие ожиданиям присоединено");
  assertPerfEquals_(result.data[0][5], "middle", "Иванов: грейд присоединен");
  assertPerfEquals_(result.data[0][6], "Руководитель отдела", "Иванов — руководитель отдела");

  assertPerfEquals_(result.data[1][6], "Сотрудник отдела", "Петрова — сотрудник отдела");
  assertPerfEquals_(result.issues.length, 0, "нет проблем сопоставления — issues пуст");

}

/**
 * Обязательное требование задачи: исходные headers/rows (и
 * закэшированный объект DataLoader) не должны мутироваться —
 * enrich_ обязан возвращать копии.
 */
function testPerformanceDirectory_enrichDoesNotMutateInputArrays_() {

  const directory = perfDirectoryValid_();
  const originalHeaders = SURVEY_2026_TEST_HEADERS_.slice();
  const originalRows = survey2026TestRows_();
  const originalRowsCopy = originalRows.map(row => row.slice());

  const result = PerformanceDirectory.enrich_(originalHeaders, originalRows, directory);

  assertPerfEquals_(originalHeaders.length, 4, "исходный массив заголовков не изменен по длине");
  assertPerfTrue_(result.headers !== originalHeaders, "возвращен НОВЫЙ массив заголовков, не тот же объект");

  originalRows.forEach((row, i) => {
    assertPerfEquals_(row.length, originalRowsCopy[i].length, "исходная строка " + i + " не удлинена");
    assertPerfTrue_(row !== result.data[i], "строка результата — новый массив, не тот же объект");
  });

}

/**
 * Ошибки сопоставления справочника с ответами (сотрудник не найден,
 * город/отдел не совпадает) больше НЕ блокируют присоединение — см.
 * PerformanceDirectory.enrich_. Строка просто не получает данных
 * справочника, а проблема собирается в issues, которые может показать
 * (или проигнорировать) вызывающий код.
 */
function testPerformanceDirectory_enrichDoesNotThrowOnMissingRespondent_() {

  const directory = perfDirectoryValid_();
  const rows = [
    ["Неизвестный Сотрудник", "Москва", "Отдел разработки сайтов", "9"]
  ];

  const result = PerformanceDirectory.enrich_(SURVEY_2026_TEST_HEADERS_, rows, directory);

  assertPerfEquals_(result.issues.length, 1, "проблема собрана в issues, а не выброшена");
  assertPerfEquals_(result.issues[0].reason, "not_found", "причина — сотрудник не найден в справочнике");
  assertPerfEquals_(result.issues[0].row, null, "строка справочника неизвестна — сотрудника там нет");
  assertPerfEquals_(result.data[0][4], "", "expectations пусто");
  assertPerfEquals_(result.data[0][6], "", "роль пуста");

}

function testPerformanceDirectory_enrichDoesNotThrowOnCityMismatch_() {

  const directory = perfDirectoryValid_();
  const rows = [
    ["Иванов Иван", "Санкт-Петербург", "Отдел разработки сайтов", "9"] // в справочнике — Москва
  ];

  const result = PerformanceDirectory.enrich_(SURVEY_2026_TEST_HEADERS_, rows, directory);

  assertPerfEquals_(result.issues.length, 1, "проблема собрана в issues, а не выброшена");
  assertPerfEquals_(result.issues[0].reason, "city_mismatch", "причина — несовпадение города");
  assertPerfEquals_(result.issues[0].name, "Иванов Иван", "ФИО указано");
  assertPerfTrue_(result.issues[0].row !== null, "указан номер строки листа \"перформанс\"");

}

function testPerformanceDirectory_enrichDoesNotThrowOnDepartmentMismatch_() {

  const directory = perfDirectoryValid_();
  const rows = [
    ["Иванов Иван", "Москва", "Отдел тестирования ПО", "9"] // в справочнике — Отдел разработки сайтов
  ];

  const result = PerformanceDirectory.enrich_(SURVEY_2026_TEST_HEADERS_, rows, directory);

  assertPerfEquals_(result.issues.length, 1, "проблема собрана в issues, а не выброшена");
  assertPerfEquals_(result.issues[0].reason, "department_mismatch", "причина — несовпадение отдела");

}

/**
 * Совпадение ФИО при несовпадении города/отдела — некорректное
 * сопоставление: строка не должна получить перформанс/грейд/роль из
 * чужой (по факту) записи справочника — лучше исключить сотрудника
 * из новых срезов целиком.
 */
function testPerformanceDirectory_enrichExcludesMismatchedRowFromNewFields_() {

  const directory = perfDirectoryValid_();
  const rows = [
    ["Иванов Иван", "Санкт-Петербург", "Отдел разработки сайтов", "9"] // город не совпадает
  ];

  const result = PerformanceDirectory.enrich_(SURVEY_2026_TEST_HEADERS_, rows, directory);

  assertPerfEquals_(result.data[0][4], "", "expectations не присвоено при несовпадении города");
  assertPerfEquals_(result.data[0][5], "", "грейд не присвоен");
  assertPerfEquals_(result.data[0][6], "", "роль не присвоена — сотрудник не попадет ни в руководителей, ни в команду");

}

/**
 * loadEnrichedSurveyData_ не трогает 2025/both — они проходят к
 * loadSurveyData как есть, без обращения к PerformanceDirectory.
 * Проверяется подменой глобальной loadSurveyData (тот же прием, что и
 * в CohortReportTest.gs для buildReport), чтобы тест не требовал
 * реального SpreadsheetApp/листа "перформанс".
 */
function testPerformanceDirectory_loadEnrichedPassesThroughFor2025AndBoth_() {

  const originalLoadSurveyData = loadSurveyData;
  const calls = [];

  loadSurveyData = function (source, includeData) {
    calls.push(source);
    return { source: source, rows: 0, columns: 0, headers: [], data: [] };
  };

  try {

    const result2025 = loadEnrichedSurveyData_("2025", true);
    const resultBoth = loadEnrichedSurveyData_("both", true);
    const resultMetaOnly = loadEnrichedSurveyData_("2026", false);

    assertPerfEquals_(result2025.source, "2025", "2025 проходит без изменений");
    assertPerfEquals_(resultBoth.source, "both", "both проходит без изменений");
    assertPerfEquals_(resultMetaOnly.source, "2026", "includeData=false не запускает обогащение");
    assertPerfEquals_(calls.length, 3, "PerformanceDirectory не вызывался — все три раза ушли прямо в loadSurveyData");

  } finally {
    loadSurveyData = originalLoadSurveyData;
  }

}

/**
 * Обычный отчет за 2026 должен строиться, даже если справочник
 * "перформанс" структурно сломан (лист не найден, столбцы отсутствуют
 * и т.п.) — loadEnrichedSurveyData_ просто не расширяет заголовки и
 * возвращает исходные "Ответы 2026" как есть.
 */
function testPerformanceDirectory_loadEnrichedFallsBackWhenDirectoryBroken_() {

  const originalLoadSurveyData = loadSurveyData;
  const originalDirectoryLoad = PerformanceDirectory.load;

  loadSurveyData = function (source, includeData) {
    return { source: source, rows: 2, columns: SURVEY_2026_TEST_HEADERS_.length, headers: SURVEY_2026_TEST_HEADERS_, data: survey2026TestRows_() };
  };

  PerformanceDirectory.load = function () {
    throw new Error('Лист "перформанс" не найден.');
  };

  try {

    const result = loadEnrichedSurveyData_("2026", true);

    assertPerfEquals_(result.headers.join("|"), SURVEY_2026_TEST_HEADERS_.join("|"),
      "заголовки не расширены — обогащение недоступно, но обычный отчет всё равно строится");
    assertPerfEquals_(result.data.length, 2, "строки сохранены как есть");
    assertPerfEquals_(result.performanceIssues.length, 0, "обогащение не выполнялось — issues пуст");

  } finally {
    loadSurveyData = originalLoadSurveyData;
    PerformanceDirectory.load = originalDirectoryLoad;
  }

}

/**
 * Поломка справочника "перформанс" — проблема только источника 2026.
 * Загрузка 2025 не должна даже пытаться обращаться к PerformanceDirectory.
 */
function testPerformanceDirectory_directoryErrorDoesNotAffect2025_() {

  const originalLoadSurveyData = loadSurveyData;
  const originalDirectoryLoad = PerformanceDirectory.load;
  let directoryLoadCalls = 0;

  loadSurveyData = function (source, includeData) {
    return { source: source, rows: 0, columns: 0, headers: [], data: [] };
  };

  PerformanceDirectory.load = function () {
    directoryLoadCalls++;
    throw new Error("справочник сломан");
  };

  try {

    const result2025 = loadEnrichedSurveyData_("2025", true);

    assertPerfEquals_(result2025.source, "2025", "2025 не затронут поломкой справочника");
    assertPerfEquals_(directoryLoadCalls, 0, "PerformanceDirectory.load не вызывается для источника 2025");

  } finally {
    loadSurveyData = originalLoadSurveyData;
    PerformanceDirectory.load = originalDirectoryLoad;
  }

}

// ==========================================================
// managerIssuesFor_ — проверка "ровно один руководитель отдела"
// ==========================================================

function testPerformanceDirectory_managerIssuesExactlyOneManagerIsClean_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел А", "Соответствует", "middle", true],
    ["Петрова Мария", "Москва", "Отдел А", "Превышает", "senior", false]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const issues = PerformanceDirectory.managerIssuesFor_(directory);

  assertPerfEquals_(issues.length, 0, "ровно один руководитель в отделе — нет проблем");

}

function testPerformanceDirectory_managerIssuesReportsMissingManager_() {

  const rows = [
    ["Петрова Мария", "Москва", "Отдел А", "Превышает", "senior", false]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const issues = PerformanceDirectory.managerIssuesFor_(directory);

  assertPerfEquals_(issues.length, 1, "один проблемный отдел");
  assertPerfEquals_(issues[0].type, "missing", "тип — руководитель не указан");
  assertPerfEquals_(issues[0].department, "Отдел А", "название отдела верное");

}

function testPerformanceDirectory_managerIssuesReportsMultipleManagers_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел А", "Соответствует", "middle", true],
    ["Петрова Мария", "Москва", "Отдел А", "Превышает", "senior", true]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const issues = PerformanceDirectory.managerIssuesFor_(directory);

  assertPerfEquals_(issues.length, 1, "один проблемный отдел");
  assertPerfEquals_(issues[0].type, "multiple", "тип — указано несколько руководителей");
  assertPerfEquals_(issues[0].names.slice().sort().join(","), "Иванов Иван,Петрова Мария", "оба имени перечислены");

}

/**
 * Требование задачи: проверка не должна останавливаться на первой
 * найденной ошибке — оба проблемных отдела возвращаются за один вызов.
 */
function testPerformanceDirectory_managerIssuesDoesNotStopAtFirstError_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел А", "Соответствует", "middle", true],
    ["Петрова Мария", "Москва", "Отдел А", "Превышает", "senior", true],
    ["Сидоров Петр", "Казань", "Отдел Б", "Соответствует", "middle", false]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const issues = PerformanceDirectory.managerIssuesFor_(directory);

  assertPerfEquals_(issues.length, 2, "оба проблемных отдела найдены за один проход, а не только первый");
  assertPerfTrue_(issues.some(i => i.department === "Отдел А" && i.type === "multiple"), "Отдел А — несколько руководителей");
  assertPerfTrue_(issues.some(i => i.department === "Отдел Б" && i.type === "missing"), "Отдел Б — руководитель не указан");

}

/**
 * Профессиональный грейд "lead" НЕ означает руководителя отдела —
 * признак "Руководитель отдела" в справочнике не связан с "Грейд".
 * Отдел, где лидов несколько, но ни один не отмечен как руководитель
 * отдела, — это "руководитель не указан", а не "несколько
 * руководителей".
 */
function testPerformanceDirectory_managerIssuesIndependentOfGrade_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел А", "Соответствует", "lead", false],
    ["Петрова Мария", "Москва", "Отдел А", "Превышает", "lead", false]
  ];

  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);
  const issues = PerformanceDirectory.managerIssuesFor_(directory);

  assertPerfEquals_(issues.length, 1, "один проблемный отдел");
  assertPerfEquals_(issues[0].type, "missing", "грейд lead у нескольких сотрудников — это не руководители отдела");

}

// ==========================================================
// countsForFilters — знаменатель "Приглашены" для срезов
// "Соответствие ожиданиям"/"Грейд" (см. AnalyticsService.build)
// ==========================================================

function withPerfDirectoryCache_(directory, fn) {

  const original = PerformanceDirectory.cache_;
  PerformanceDirectory.cache_ = directory;

  try {
    fn();
  } finally {
    PerformanceDirectory.cache_ = original;
  }

}

/**
 * "Приглашены" считается по ВСЕМ сотрудникам справочника с заполненным
 * полем — независимо от того, попали ли они в опрос вообще (фикстура
 * ниже не пересекается со строками "Ответы 2026").
 */
function testPerformanceDirectory_countsForFiltersUnfiltered_() {

  withPerfDirectoryCache_(perfDirectoryValid_(), () => {

    const expectations = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.EXPECTATIONS, []);

    assertPerfTrue_(expectations.supported, "без фильтров знаменатель поддерживается");
    assertPerfEquals_(expectations.total, 3, "все три сотрудника справочника учтены");
    assertPerfEquals_(expectations.counts["соответствует"], 2, "«Соответствует»: Иванов + Сидоров");
    assertPerfEquals_(expectations.counts["превышает"], 1, "«Превышает»: Петрова");

    const grade = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.GRADE, []);

    assertPerfEquals_(grade.total, 3, "все три сотрудника учтены и для грейда");
    assertPerfEquals_(grade.counts["middle"], 1, "middle: Иванов");
    assertPerfEquals_(grade.counts["senior"], 1, "senior: Петрова");
    assertPerfEquals_(grade.counts["lead"], 1, "lead: Сидоров");

  });

}

function testPerformanceDirectory_countsForFiltersExcludesEmptyValues_() {

  const rows = [
    ["Иванов Иван", "Москва", "Отдел А", "Соответствует", "middle", true],
    ["Петрова Мария", "Москва", "Отдел А", "", "", false] // поле перформанса не заполнено
  ];
  const directory = PerformanceDirectory.parse_(PERF_TEST_HEADERS_, rows);

  withPerfDirectoryCache_(directory, () => {

    const expectations = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.EXPECTATIONS, []);

    assertPerfEquals_(expectations.total, 1, "сотрудник с пустым полем не входит в приглашенные");

  });

}

function testPerformanceDirectory_countsForFiltersSupportsDepartmentFilter_() {

  withPerfDirectoryCache_(perfDirectoryValid_(), () => {

    const filters = [{ question: "Отдел", values: ["Отдел разработки сайтов"] }];
    const expectations = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.EXPECTATIONS, filters);

    assertPerfTrue_(expectations.supported, "фильтр по «Отдел» поддерживается (поле есть и в анкете, и в справочнике)");
    assertPerfEquals_(expectations.total, 2, "только сотрудники «Отдела разработки сайтов»");
    assertPerfEquals_(expectations.counts["соответствует"], 1, "Иванов — «Соответствует»");
    assertPerfEquals_(expectations.counts["превышает"], 1, "Петрова — «Превышает»");

  });

}

function testPerformanceDirectory_countsForFiltersUnsupportedForOtherFilters_() {

  withPerfDirectoryCache_(perfDirectoryValid_(), () => {

    const filters = [{ question: "Город", values: ["Москва"] }];
    const result = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.EXPECTATIONS, filters);

    assertPerfTrue_(!result.supported, "фильтр по «Город» не поддерживается — в справочнике нет знаменателя для города");
    assertPerfEquals_(result.total, null, "total=null, когда знаменатель не поддерживается");

  });

}

function testPerformanceDirectory_countsForFiltersUnsupportedWhenDirectoryBroken_() {

  const original = PerformanceDirectory.cache_;
  const originalLoad = PerformanceDirectory.load;

  PerformanceDirectory.cache_ = null;
  PerformanceDirectory.load = function () {
    throw new Error('Лист "перформанс" не найден.');
  };

  try {
    const result = PerformanceDirectory.countsForFilters(PerformanceDirectory.COLUMNS.EXPECTATIONS, []);
    assertPerfTrue_(!result.supported, "сломанный справочник — знаменатель недоступен, а не ошибка");
  } finally {
    PerformanceDirectory.cache_ = original;
    PerformanceDirectory.load = originalLoad;
  }

}
