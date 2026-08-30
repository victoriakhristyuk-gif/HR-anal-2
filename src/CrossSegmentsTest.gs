/**
 * ==========================================================
 * Ручные тесты: CrossSegments (связи между срезами перформанса)
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testCrossSegments_runAll().
 */

function testCrossSegments_runAll() {

  const tests = [
    testCrossSegments_crossTabBuildsCells_,
    testCrossSegments_crossTabFlagsFragileCells_,
    testCrossSegments_cramersVIndependentIsNearZero_,
    testCrossSegments_cramersVPerfectAssociationIsOne_,
    testCrossSegments_cramersVNullOnSingleCategory_,
    testCrossSegments_cramersVIgnoresMissingPairs_,
    testCrossSegments_analyzeAllSkipsEmptyDimensionPair_,
    testCrossSegments_analyzeAllOnlyFor2026_
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

  console.log("Все тесты CrossSegments пройдены.");

}

function assertCSEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertCSEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertCSTrue_(value, message) {
  if (!value) throw new Error(message || "ожидалось true");
}

const CS_HEADERS_ = ["Фамилия Имя", "Соответствие ожиданиям", "Грейд", "Роль в отделе", "eNPS"];

function csRow_(name, expectations, grade, role, enps) {
  return [name, expectations, grade, role, enps];
}

function csQuestions_() {
  return [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];
}

/**
 * crossTab строит по одной ячейке на каждое непустое сочетание
 * "Грейд" × "Роль в отделе" с правильным n.
 */
function testCrossSegments_crossTabBuildsCells_() {

  const rows = [
    csRow_("A", "Соответствует", "middle", "Сотрудник отдела", "9"),
    csRow_("B", "Соответствует", "middle", "Сотрудник отдела", "8"),
    csRow_("C", "Превышает", "senior", "Руководитель отдела", "10")
  ];

  const result = CrossSegments.crossTab(rows, CS_HEADERS_, csQuestions_(), "Грейд", "Роль в отделе");

  assertCSEquals_(result.cells.length, 2, "две непустые ячейки: middle/Сотрудник, senior/Руководитель");

  const middleCell = result.cells.find(c => c.a === "middle");
  const seniorCell = result.cells.find(c => c.a === "senior");

  assertCSTrue_(!!middleCell, "ячейка middle найдена");
  assertCSEquals_(middleCell.metrics.n, 2, "middle/Сотрудник отдела: n=2");
  assertCSTrue_(!!seniorCell, "ячейка senior найдена");
  assertCSEquals_(seniorCell.metrics.n, 1, "senior/Руководитель отдела: n=1");

}

/**
 * Ячейка с n < Norms.FRAGILE_SEGMENT_SIZE помечается fragile — как и
 * в Segments.analyze, данные не скрываются, только помечаются.
 */
function testCrossSegments_crossTabFlagsFragileCells_() {

  const rows = [
    csRow_("A", "Соответствует", "middle", "Сотрудник отдела", "9"),
    csRow_("B", "Соответствует", "middle", "Сотрудник отдела", "8")
  ];

  const result = CrossSegments.crossTab(rows, CS_HEADERS_, csQuestions_(), "Соответствие ожиданиям", "Грейд");

  assertCSEquals_(result.cells.length, 1, "одна ячейка");
  assertCSTrue_(result.cells[0].fragile, "n=2 < 25 → fragile=true");

}

/**
 * Полностью независимые категории (равномерно перемешанные) дают
 * V, близкий к нулю.
 */
function testCrossSegments_cramersVIndependentIsNearZero_() {

  const a = ["x", "x", "y", "y", "x", "x", "y", "y"];
  const b = ["p", "q", "p", "q", "p", "q", "p", "q"];

  const result = MathStats.cramersV(a, b);

  assertCSTrue_(!!result, "результат посчитан");
  assertCSEquals_(result.v, 0, "полностью независимые категории → V=0");

}

/**
 * Полное совпадение категорий (каждому значению A соответствует
 * ровно одно значение B) дает V=1.
 */
function testCrossSegments_cramersVPerfectAssociationIsOne_() {

  const a = ["x", "x", "y", "y", "z", "z"];
  const b = ["p", "p", "q", "q", "r", "r"];

  const result = MathStats.cramersV(a, b);

  assertCSTrue_(!!result, "результат посчитан");
  assertCSEquals_(result.v, 1, "полная связь → V=1");

}

/**
 * Меньше 2 категорий по одной из осей — вырожденная таблица, V не
 * определен (не 0 — именно "нельзя посчитать").
 */
function testCrossSegments_cramersVNullOnSingleCategory_() {

  const a = ["x", "x", "x"];
  const b = ["p", "q", "p"];

  assertCSEquals_(MathStats.cramersV(a, b), null, "одна категория по A → null");

}

/**
 * Пары, где хотя бы одно значение пустое/null, исключаются из расчета
 * так же, как MathStats.pairwise делает для числовых корреляций.
 */
function testCrossSegments_cramersVIgnoresMissingPairs_() {

  const a = ["x", "x", "y", "y", ""];
  const b = ["p", "q", "p", "q", "p"];

  const result = MathStats.cramersV(a, b);

  assertCSTrue_(!!result, "результат посчитан несмотря на пропуск");
  assertCSEquals_(result.n, 4, "пустое значение A исключено из n");

}

/**
 * analyzeAll пропускает пару, где одно из измерений полностью пустое
 * во всей выборке (например, справочник "перформанс" недоступен, и
 * enrich_ не заполнил колонку) — вместо падения с ошибкой.
 */
function testCrossSegments_analyzeAllSkipsEmptyDimensionPair_() {

  const rows = [
    csRow_("A", "Соответствует", "", "Сотрудник отдела", "9"),
    csRow_("B", "Превышает", "", "Руководитель отдела", "8")
  ];

  const result = CrossSegments.analyzeAll(rows, CS_HEADERS_, csQuestions_());
  const pairTitles = result.map(p => p.dimA + " × " + p.dimB);

  assertCSTrue_(pairTitles.indexOf("Соответствие ожиданиям × Грейд") === -1,
    "пара с полностью пустым \"Грейд\" пропущена");
  assertCSTrue_(pairTitles.indexOf("Грейд × Роль в отделе") === -1,
    "пара с полностью пустым \"Грейд\" пропущена");
  assertCSTrue_(pairTitles.indexOf("Соответствие ожиданиям × Роль в отделе") !== -1,
    "пара без пустых измерений осталась");

}

/**
 * AnalyticsService.build считает crossSegments только для sourceYear
 * === "2026" — как и сами срезы "Соответствие ожиданиям"/"Грейд"/
 * "Роль в отделе" (см. AnalyticsServicePerformanceTest.gs).
 */
function testCrossSegments_analyzeAllOnlyFor2026_() {

  withAnalyticsServiceFixture_(() => {

    const analytics2026 = AnalyticsService.build("2026", "2025", []);
    assertCSTrue_(analytics2026.crossSegments.length > 0, "2026: crossSegments посчитаны");

  });

  const original = loadEnrichedSurveyData_;
  const originalHeadcountRows = Headcount.rowsCache_;
  const originalHeadcountDirectory = Headcount.directory_;

  Headcount.rowsCache_ = aspHeadcountRows_();
  Headcount.directory_ = null;

  loadEnrichedSurveyData_ = function (source) {
    return { source: source, rows: 3, columns: ASP_HEADERS_.length, headers: ASP_HEADERS_, data: aspRows2026_() };
  };

  try {
    const analytics2025 = AnalyticsService.build("2025", "2025", []);
    assertCSEquals_(analytics2025.crossSegments.length, 0, "2025: crossSegments пуст");
  } finally {
    loadEnrichedSurveyData_ = original;
    Headcount.rowsCache_ = originalHeadcountRows;
    Headcount.directory_ = originalHeadcountDirectory;
  }

}
