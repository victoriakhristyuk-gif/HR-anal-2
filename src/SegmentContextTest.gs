/**
 * ==========================================================
 * Ручные тесты join'а срезового отчета с расширенным контуром
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testSegmentContext_runAll().
 *
 * AnalyticsService.buildCached_ подменяется фиктивным результатом на
 * время теста (тот же прием, что и подмена Headcount.rowsCache_ в
 * SegmentsTest.gs) — тест проверяет только логику join'а по имени
 * бакета, а не сам company-wide расчет (он покрыт SegmentsTest.gs).
 */

function testSegmentContext_runAll() {

  const tests = [
    testSegmentContext_matchesSingleValueFilter_,
    testSegmentContext_skipsMultiValueFilter_,
    testSegmentContext_emptyWhenNoDimensionFilter_,
    testSegmentContext_matchesTeamGroupFilter_
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

  console.log("Все тесты SegmentContext пройдены.");

}

function assertSegmentContextEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertSegmentContextEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual));
  }
}

function segmentContextFixtureAnalytics_() {

  return {
    segments: [
      {
        dimension: "Стаж",
        segments: [
          { dimension: "Стаж", name: "1-3 года", n: 40, confirmed: true, fragile: false,
            deviations: [{ label: "eNPS", diff: -20, bad: true }], yearDelta: null },
          { dimension: "Стаж", name: "Более 5 лет", n: 15, confirmed: false, fragile: false,
            deviations: [], yearDelta: null }
        ]
      }
    ]
  };

}

function withStubbedAnalyticsCache_(fixtureOrFn, run) {

  const original = AnalyticsService.buildCached_;

  AnalyticsService.buildCached_ = typeof fixtureOrFn === "function"
    ? fixtureOrFn
    : () => fixtureOrFn;

  try {
    run();
  } finally {
    AnalyticsService.buildCached_ = original;
  }

}

/**
 * Фильтр с ровно одним значением по измерению, которое считает
 * расширенный контур, — должен найти соответствующий сегмент как есть
 * (deviations/confirmed не копируются и не пересчитываются).
 */
function testSegmentContext_matchesSingleValueFilter_() {

  withStubbedAnalyticsCache_(segmentContextFixtureAnalytics_(), () => {

    const result = SegmentContext.forFilters("2026", [
      { question: "Стаж", values: ["1-3 года"] }
    ]);

    assertSegmentContextEquals_(result.length, 1, "найден один сегмент");
    assertSegmentContextEquals_(result[0].name, "1-3 года", "совпадение по имени бакета");
    assertSegmentContextEquals_(result[0].confirmed, true, "статус confirmed взят как есть");

  });

}

/**
 * Фильтр с несколькими значениями не соответствует ровно одному бакету
 * расширенного контура — по замыслу v1 такой срез не обогащается.
 */
function testSegmentContext_skipsMultiValueFilter_() {

  withStubbedAnalyticsCache_(segmentContextFixtureAnalytics_(), () => {

    const result = SegmentContext.forFilters("2026", [
      { question: "Стаж", values: ["1-3 года", "Более 5 лет"] }
    ]);

    assertSegmentContextEquals_(result.length, 0, "многозначный фильтр не обогащается");

  });

}

/**
 * Фильтр не по одному из измерений расширенного контура (например,
 * оператор по рейтинговому вопросу) — join не должен даже обращаться
 * к company-wide аналитике.
 */
function testSegmentContext_emptyWhenNoDimensionFilter_() {

  withStubbedAnalyticsCache_(() => {
    throw new Error("buildCached_ не должен вызываться без фильтра по измерению");
  }, () => {

    const result = SegmentContext.forFilters("2026", [
      { question: "ЗП", min: 1, max: 3 }
    ]);

    assertSegmentContextEquals_(result.length, 0, "пустой результат без обращения к аналитике");

  });

}

/**
 * "Группа команд" — производный фильтр (как "Управление"), должен
 * матчиться SegmentContext так же, как остальные измерения (см.
 * SegmentContext.DIMENSIONS).
 */
function testSegmentContext_matchesTeamGroupFilter_() {

  const fixture = {
    segments: [
      {
        dimension: "Группа команд",
        segments: [
          { dimension: "Группа команд", name: "Управление разработки ПО → Сервисная команда", n: 20, confirmed: true, fragile: false,
            deviations: [{ label: "eNPS", diff: -18, bad: true }], yearDelta: null }
        ]
      }
    ]
  };

  withStubbedAnalyticsCache_(fixture, () => {

    const result = SegmentContext.forFilters("2026", [
      { question: "Группа команд", values: ["Управление разработки ПО → Сервисная команда"] }
    ]);

    assertSegmentContextEquals_(result.length, 1, "найден сегмент группы команд");
    assertSegmentContextEquals_(result[0].confirmed, true, "статус confirmed взят как есть");

  });

}
