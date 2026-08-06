/**
 * ==========================================================
 * Ручные тесты сравнения 2-4 произвольных выборок
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testSampleComparison_runAll().
 *
 * Тестирует композицию FilterEngine.applyFilters + computeReportMetrics_ +
 * Comparison.build + SampleComparisonService.mergeTopAnswers_ — тот же
 * путь, что и SampleComparisonService.compareMany, без
 * loadEnrichedSurveyData_ (та читает реальный лист "Ответы 2026"/"Ответы
 * 2025" и не подходит для fixture-теста, как и в остальных *Test.gs
 * этого проекта — см., например, ReportYearTest.gs).
 */

function testSampleComparison_runAll() {

  const tests = [
    testSampleComparison_usesFilteredGroupSizes_,
    testSampleComparison_averageRatingsAlignAcrossSamples_,
    testSampleComparison_pairsCoverAllCombinations_,
    testSampleComparison_emptyGroupWouldBeRejected_,
    testSampleComparison_mergeTopAnswersUnionsAcrossSamples_,
    testSampleComparison_resolveLabelPrefersCustomName_,
    testSampleComparison_resolveLabelFallsBackToFilters_
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

  console.log("Все тесты SampleComparison пройдены.");

}

function assertSampleComparisonEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertSampleComparisonEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual));
  }
}

/**
 * Fixture: 3 отдела — "Отдел продаж" (5), "Отдел маркетинга" (3),
 * "Отдел эксплуатации сети" (2) — три непересекающихся фильтра по
 * вопросу "Отдел", плюс "Рабочий стол" (rating5) и "Ценишь в компании"
 * (Топ-5, множественный выбор — здесь по одному варианту на строку).
 */
function sampleComparison_fixture_() {

  const headers = ["Отдел", "eNPS", "Рабочий стол", "Ценишь в компании"];

  const rows = [
    ["Отдел продаж", "9", "5", "Дружная команда, комфортная атмосфера"],
    ["Отдел продаж", "9", "4", "Дружная команда, комфортная атмосфера"],
    ["Отдел продаж", "8", "5", "Стабильность"],
    ["Отдел продаж", "6", "3", "Стабильность"],
    ["Отдел продаж", "10", "5", "Оклад, пересмотр зарплаты"],
    ["Отдел маркетинга", "5", "2", "Гибкий формат работы"],
    ["Отдел маркетинга", "6", "3", "Гибкий формат работы"],
    ["Отдел маркетинга", "4", "2", "Стабильность"],
    ["Отдел эксплуатации сети", "9", "5", "Стабильность"],
    ["Отдел эксплуатации сети", "8", "4", "Стабильность"]
  ];

  const filtersA = [{ question: "Отдел", type: "single", values: ["Отдел продаж"] }];
  const filtersB = [{ question: "Отдел", type: "single", values: ["Отдел маркетинга"] }];
  const filtersC = [{ question: "Отдел", type: "single", values: ["Отдел эксплуатации сети"] }];

  return {
    headers: headers,
    rows: rows,
    filtersList: [filtersA, filtersB, filtersC]
  };

}

/**
 * Строит те же промежуточные данные, что и
 * SampleComparisonService.compareMany, без loadEnrichedSurveyData_.
 */
function sampleComparison_build_(fixture) {

  const filteredRows = fixture.filtersList.map(filters =>
    FilterEngine.applyFilters(fixture.rows, fixture.headers, filters, "2026")
  );

  const metrics = filteredRows.map(rows => computeReportMetrics_("2026", rows, fixture.headers, null));

  const pairs = [];
  for (let i = 0; i < filteredRows.length; i++) {
    for (let j = i + 1; j < filteredRows.length; j++) {
      const comparison = Comparison.build(
        { employees: filteredRows[i].length, enps: metrics[i].enps, averageRatings: metrics[i].averageRatings },
        { employees: filteredRows[j].length, enps: metrics[j].enps, averageRatings: metrics[j].averageRatings },
        metrics[i].distributions,
        metrics[j].distributions,
        metrics[i].topAnswerFrequencies,
        metrics[j].topAnswerFrequencies
      );
      pairs.push({ i: i, j: j, comparison: comparison });
    }
  }

  return { filteredRows: filteredRows, metrics: metrics, pairs: pairs };

}

/**
 * 1. Группы считаются по filteredRows[i].length, а не по общему размеру
 * источника (10 строк, 3 группы = 10 строк ровно в этом fixture — все
 * строки распределены, поэтому проверяем именно размеры отдельных групп).
 */
function testSampleComparison_usesFilteredGroupSizes_() {

  const fixture = sampleComparison_fixture_();
  const result = sampleComparison_build_(fixture);

  assertSampleComparisonEquals_(result.filteredRows[0].length, 5, "размер выборки A");
  assertSampleComparisonEquals_(result.filteredRows[1].length, 3, "размер выборки B");
  assertSampleComparisonEquals_(result.filteredRows[2].length, 2, "размер выборки C");

}

/**
 * 2. comparison.averageRatings по каждой паре содержит "Рабочий стол" в
 * той же позиции, что и metrics[i].averageRatings — SampleComparisonBuilder
 * полагается на это при выравнивании колонок по индексу k без повторного
 * поиска по названию вопроса.
 */
function testSampleComparison_averageRatingsAlignAcrossSamples_() {

  const fixture = sampleComparison_fixture_();
  const result = sampleComparison_build_(fixture);

  const desiredIndex = result.metrics[0].averageRatings.findIndex(item => item.question === "Рабочий стол");

  if (desiredIndex === -1) {
    throw new Error("Вопрос \"Рабочий стол\" не найден в metrics[0].averageRatings");
  }

  result.metrics.forEach((m, sampleIndex) => {
    assertSampleComparisonEquals_(
      m.averageRatings[desiredIndex].question, "Рабочий стол",
      "тот же индекс = тот же вопрос для выборки " + sampleIndex
    );
  });

  // A: (5+4+5+3+5)/5 = 4.4
  assertSampleComparisonEquals_(result.metrics[0].averageRatings[desiredIndex].average, 4.4, "среднее по A");

  const pairAB = result.pairs.find(p => p.i === 0 && p.j === 1);
  assertSampleComparisonEquals_(
    pairAB.comparison.averageRatings[desiredIndex].question, "Рабочий стол",
    "тот же индекс в comparison.averageRatings пары A-B"
  );

}

/**
 * 3. При 3 выборках должно получиться ровно 3 пары: A-B, A-C, B-C
 * (не больше — иначе SampleComparisonBuilder нарисует лишние/задвоенные
 * колонки дельт).
 */
function testSampleComparison_pairsCoverAllCombinations_() {

  const fixture = sampleComparison_fixture_();
  const result = sampleComparison_build_(fixture);

  assertSampleComparisonEquals_(result.pairs.length, 3, "3 выборки дают 3 пары");

  const keys = result.pairs.map(p => p.i + "-" + p.j).sort().join(",");
  assertSampleComparisonEquals_(keys, "0-1,0-2,1-2", "пары покрывают все несовпадающие сочетания");

}

/**
 * 4. Пустая группа (фильтр не находит ни одной строки) — то самое
 * условие, которое SampleComparisonService.compareMany отклоняет ДО
 * построения листа. Здесь проверяется сам факт: FilterEngine отдает
 * пустой массив, а не бросает исключение сам по себе — отклонение с
 * понятным сообщением остается ответственностью compareMany.
 */
function testSampleComparison_emptyGroupWouldBeRejected_() {

  const fixture = sampleComparison_fixture_();
  const filtersEmpty = [{ question: "Отдел", type: "single", values: ["Несуществующий отдел"] }];

  const filtered = FilterEngine.applyFilters(fixture.rows, fixture.headers, filtersEmpty, "2026");

  assertSampleComparisonEquals_(filtered.length, 0, "фильтр без совпадений дает пустую выборку");

}

/**
 * 5. mergeTopAnswers_: объединение вариантов "Ценишь в компании" по
 * ВСЕМ выборкам — "Стабильность" встречается в A, B и C, поэтому должна
 * попасть в объединенный список с корректным count/percent по каждой
 * выборке (0, если в конкретной выборке варианта не было вовсе).
 */
function testSampleComparison_mergeTopAnswersUnionsAcrossSamples_() {

  const fixture = sampleComparison_fixture_();
  const result = sampleComparison_build_(fixture);

  const merged = SampleComparisonService.mergeTopAnswers_(result.metrics);
  const entry = merged.find(e => e.question.title === "Ценишь в компании");

  if (!entry) {
    throw new Error("Вопрос \"Ценишь в компании\" не найден в mergeTopAnswers_");
  }

  const stability = entry.items.find(item => item.answer === "Стабильность");

  if (!stability) {
    throw new Error("\"Стабильность\" не попала в объединенный список вариантов");
  }

  // A: 2 из 5 (40%), B: 1 из 3 (33%), C: 2 из 2 (100%)
  assertSampleComparisonEquals_(stability.values[0].count, 2, "count в A");
  assertSampleComparisonEquals_(stability.values[1].count, 1, "count в B");
  assertSampleComparisonEquals_(stability.values[2].count, 2, "count в C");
  assertSampleComparisonEquals_(stability.values[2].percent, 100, "percent в C — все ответившие");

  const paycheck = entry.items.find(item => item.answer === "Оклад, пересмотр зарплаты");

  if (!paycheck) {
    throw new Error("Вариант, встретившийся только в A, должен остаться в объединенном списке");
  }

  assertSampleComparisonEquals_(paycheck.values[1].count, 0, "count в B для варианта, которого там не было");

}

/**
 * 6. resolveLabel_: пользовательское название побеждает, даже если
 * заданы фильтры.
 */
function testSampleComparison_resolveLabelPrefersCustomName_() {

  const fixture = sampleComparison_fixture_();
  const label = SampleComparisonService.resolveLabel_("Мое название", fixture.filtersList[0]);

  assertSampleComparisonEquals_(label, "Мое название", "пользовательское название приоритетнее фильтров");

}

/**
 * 7. resolveLabel_: без пользовательского названия — подпись строится
 * из фильтров через ReportBuilder.generateReportName (то же самое, что
 * используется для автогенерируемых названий обычных отчетов).
 */
function testSampleComparison_resolveLabelFallsBackToFilters_() {

  const fixture = sampleComparison_fixture_();
  const label = SampleComparisonService.resolveLabel_("", fixture.filtersList[0]);
  const expected = ReportBuilder.generateReportName(fixture.filtersList[0]);

  assertSampleComparisonEquals_(label, expected, "без названия подпись строится из фильтров");
  assertSampleComparisonEquals_(label, "Отдел продаж", "конкретное значение для fixture");

}
