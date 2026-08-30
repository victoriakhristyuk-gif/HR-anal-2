/**
 * ==========================================================
 * Ручные тесты: AnalyticsWriter — модель листа "Сервисные vs доменные"
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testAnalyticsWriterTeamTypeComparison_runAll().
 *
 * Тестируются только чистые методы AnalyticsWriter (без SpreadsheetApp):
 * buildTeamTypeComparisonSheetModel_ (структура листа — длины строк) и
 * teamTypeComparisonGapColor_ (направление подсветки разрыва). Запись на
 * реальный лист (writeTeamTypeComparison_) требует Google Apps Script и
 * здесь не проверяется — см. отчёт о проверке.
 */

function testAnalyticsWriterTeamTypeComparison_runAll() {

  const tests = [
    testAWTTC_modelAllRowsMatchHeaderLength_,
    testAWTTC_modelHeaderEndsWithComment_,
    testAWTTC_modelWidthsMatchColumnCount_,
    testAWTTC_gapColorGreenWhenServiceBetterOnPositiveMetric_,
    testAWTTC_gapColorRedWhenServiceWorseOnPositiveMetric_,
    testAWTTC_gapColorRedWhenServiceHigherRiskMetric_,
    testAWTTC_gapColorGreenWhenServiceLowerRiskMetric_,
    testAWTTC_gapColorNullWhenNotSignificant_,
    testAWTTC_gapColorNullWhenGapIsZero_,
    testAWTTC_gapColorNullWhenGapMissing_
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

  console.log("Все тесты AnalyticsWriterTeamTypeComparison пройдены.");

}

function assertAWTTCEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertAWTTCEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

/** Строка сравнения в форме, которую возвращает TeamTypeComparison.compareQuestion_. */
function awttcRowFixture_(overrides) {
  const base = {
    question: "ЗП", group: "Вознаграждение", subgroup: "Компенсация", unit: "балла",
    scaleKey: "rating5", higherIsBetter: true, hasPrevious: true,
    a: { current: { value: 5, n: 30 }, previous: { value: 4, n: 28 }, delta: 1, significant: true },
    b: { current: { value: 3, n: 30 }, previous: { value: 3, n: 28 }, delta: 0, significant: false },
    gapCurrent: 2, gapSignificant: true,
    comment: "тест"
  };
  return Object.assign({}, base, overrides || {});
}

function awttcComparisonFixture_(rows) {
  return {
    division: "Управление разработки ПО",
    groupALabel: "Сервисная команда",
    groupBLabel: "Доменная разработка",
    hasPrevious: true,
    passport: {
      division: "Управление разработки ПО",
      a: { label: "Сервисная команда", n2026: 30, n2025: 28, invited2026: 40, invited2025: 38, responseRate2026: 75, responseRate2025: 73.7 },
      b: { label: "Доменная разработка", n2026: 30, n2025: 28, invited2026: 40, invited2025: 38, responseRate2026: 75, responseRate2025: 73.7 },
      note: "тест"
    },
    rows: rows || [awttcRowFixture_()]
  };
}

/**
 * Каждая строка передаваемая в setValues (паспорт + таблица) должна
 * иметь ровно ту же длину, что и заголовок таблицы — иначе setValues
 * падает в реальном Google Sheets (см. review: numCols=17 при
 * 18-колоночной таблице).
 */
function testAWTTC_modelAllRowsMatchHeaderLength_() {

  const comparison = awttcComparisonFixture_([awttcRowFixture_(), awttcRowFixture_({ question: "eNPS", scaleKey: "enps" })]);
  const model = AnalyticsWriter.buildTeamTypeComparisonSheetModel_(comparison);

  assertAWTTCEquals_(model.fullHeader.length, model.numCols, "длина заголовка равна numCols");

  model.passportRows.forEach((row, i) => {
    assertAWTTCEquals_(row.length, model.numCols, "строка паспорта " + i + " имеет длину numCols");
  });

  model.tableRows.forEach((row, i) => {
    assertAWTTCEquals_(row.length, model.numCols, "строка таблицы " + i + " имеет длину numCols");
  });

}

function testAWTTC_modelHeaderEndsWithComment_() {

  const model = AnalyticsWriter.buildTeamTypeComparisonSheetModel_(awttcComparisonFixture_());

  assertAWTTCEquals_(model.fullHeader[model.fullHeader.length - 1], "Комментарий", "последняя колонка — Комментарий");
  assertAWTTCEquals_(model.numCols, 18, "итоговая ширина листа — 18 колонок");

}

function testAWTTC_modelWidthsMatchColumnCount_() {

  const model = AnalyticsWriter.buildTeamTypeComparisonSheetModel_(awttcComparisonFixture_());

  assertAWTTCEquals_(model.widths.length, model.numCols, "ширины заданы для всех 18 колонок");

}

/**
 * Позитивная метрика (higherIsBetter=true), сервисные выше — зелёный.
 */
function testAWTTC_gapColorGreenWhenServiceBetterOnPositiveMetric_() {

  const row = awttcRowFixture_({ higherIsBetter: true, gapCurrent: 2, gapSignificant: true });
  const color = AnalyticsWriter.teamTypeComparisonGapColor_(row);

  assertAWTTCEquals_(color, Norms.COLORS[Norms.STATUS.EXCELLENT], "позитивная метрика, серв. выше — зелёный");

}

/**
 * Позитивная метрика, сервисные ниже — красный (отрицательная разница
 * не считается автоматически плохой — здесь она плохая именно потому,
 * что метрика "выше = лучше" и сервисные оказались ниже).
 */
function testAWTTC_gapColorRedWhenServiceWorseOnPositiveMetric_() {

  const row = awttcRowFixture_({ higherIsBetter: true, gapCurrent: -2, gapSignificant: true });
  const color = AnalyticsWriter.teamTypeComparisonGapColor_(row);

  assertAWTTCEquals_(color, Norms.COLORS[Norms.STATUS.CRITICAL], "позитивная метрика, серв. ниже — красный");

}

/**
 * Риск-метрика (higherIsBetter=false), сервисные ВЫШЕ по значению
 * (то есть у сервисных выше уровень риска) — красный, а не зелёный.
 * Это ключевая проверка review: раньше положительный gapCurrent всегда
 * красился красным независимо от смысла метрики.
 */
function testAWTTC_gapColorRedWhenServiceHigherRiskMetric_() {

  const row = awttcRowFixture_({ scaleKey: "burnoutRisk", higherIsBetter: false, gapCurrent: 5, gapSignificant: true });
  const color = AnalyticsWriter.teamTypeComparisonGapColor_(row);

  assertAWTTCEquals_(color, Norms.COLORS[Norms.STATUS.CRITICAL], "риск-метрика, серв. выше (больше риска) — красный");

}

/**
 * Риск-метрика, сервисные НИЖЕ по значению (меньше риска) — зелёный.
 */
function testAWTTC_gapColorGreenWhenServiceLowerRiskMetric_() {

  const row = awttcRowFixture_({ scaleKey: "leaveRisk", higherIsBetter: false, gapCurrent: -5, gapSignificant: true });
  const color = AnalyticsWriter.teamTypeComparisonGapColor_(row);

  assertAWTTCEquals_(color, Norms.COLORS[Norms.STATUS.EXCELLENT], "риск-метрика, серв. ниже (меньше риска) — зелёный");

}

function testAWTTC_gapColorNullWhenNotSignificant_() {

  const row = awttcRowFixture_({ gapCurrent: 5, gapSignificant: false });
  assertAWTTCEquals_(AnalyticsWriter.teamTypeComparisonGapColor_(row), null, "незначимый разрыв — без подсветки");

}

function testAWTTC_gapColorNullWhenGapIsZero_() {

  const row = awttcRowFixture_({ gapCurrent: 0, gapSignificant: true });
  assertAWTTCEquals_(AnalyticsWriter.teamTypeComparisonGapColor_(row), null, "нулевой разрыв — без подсветки");

}

function testAWTTC_gapColorNullWhenGapMissing_() {

  const row = awttcRowFixture_({ gapCurrent: null, gapSignificant: null });
  assertAWTTCEquals_(AnalyticsWriter.teamTypeComparisonGapColor_(row), null, "разрыва нет — без подсветки");

}
