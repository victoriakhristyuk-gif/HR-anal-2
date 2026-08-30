/**
 * ==========================================================
 * Ручные тесты: фильтры "перформанс" и блокировка сравнения с 2025
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testPerformanceFilters_runAll().
 */

function testPerformanceFilters_runAll() {

  const tests = [
    testPerformanceFilters_availableOnlyFor2026_,
    testPerformanceFilters_unavailableFor2025_,
    testPerformanceFilters_unavailableForBoth_,
    testPerformanceFilters_blocksCompareWith2025_,
    testPerformanceFilters_blocksCohortOnly_,
    testPerformanceFilters_regularCompareWith2025StillWorks_,
    testPerformanceFilters_noPerformanceFilterDoesNotBlock_
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

  console.log("Все тесты PerformanceFilters пройдены.");

}

function assertPerfFilterEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertPerfFilterEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertPerfFilterTrue_(value, message) {
  if (!value) throw new Error(message || "ожидалось true");
}

// ==========================================================
// Гейтинг доступности фильтров по источнику
// ==========================================================

function testPerformanceFilters_availableOnlyFor2026_() {

  const titles = Filters.getFilterableQuestions("2026").map(q => q.title);
  const performanceTitles = Questions.getPerformanceOnlyTitles();

  performanceTitles.forEach(title => {
    assertPerfFilterTrue_(titles.indexOf(title) !== -1, "\"" + title + "\" должен быть доступен для 2026");
  });

}

function testPerformanceFilters_unavailableFor2025_() {

  const questions2025 = Filters.getFilterableQuestions("2025");
  const performanceTitles = Questions.getPerformanceOnlyTitles();

  questions2025.forEach(question => {
    performanceTitles.forEach(title => {
      assertPerfFilterTrue_(question.title !== title, "\"" + title + "\" не должен быть доступен для 2025");
    });
  });

}

function testPerformanceFilters_unavailableForBoth_() {

  const questionsBoth = Filters.getFilterableQuestions("both");
  const performanceTitles = Questions.getPerformanceOnlyTitles();

  questionsBoth.forEach(question => {
    performanceTitles.forEach(title => {
      assertPerfFilterTrue_(question.title !== title, "\"" + title + "\" не должен быть доступен для both");
    });
  });

}

// ==========================================================
// Блокировка "Сравнить с 2025" / когорты при новых фильтрах
// ==========================================================

function performanceFilterFixture_() {
  return [{ question: "Грейд", values: ["middle"], type: "single" }];
}

function testPerformanceFilters_blocksCompareWith2025_() {

  let threw = false;
  let message = "";

  try {
    buildReport("2026", performanceFilterFixture_(), true, "", false);
  } catch (error) {
    threw = true;
    message = error.message;
  }

  assertPerfFilterTrue_(threw, "сравнение с 2025 с фильтром \"Грейд\" должно быть заблокировано");
  assertPerfFilterTrue_(message.indexOf("Грейд") !== -1, "сообщение должно упоминать фильтр");
  assertPerfFilterTrue_(message.indexOf("2025") !== -1, "сообщение должно объяснять причину (нет данных 2025)");

}

function testPerformanceFilters_blocksCohortOnly_() {

  let threw = false;

  try {
    buildReport("2026", performanceFilterFixture_(), false, "", true);
  } catch (error) {
    threw = true;
  }

  assertPerfFilterTrue_(threw, "когортный режим с фильтром \"Грейд\" должен быть заблокирован ДО обращения к листам");

}

/**
 * Обычное сравнение 2026 с 2025 БЕЗ новых фильтров не должно
 * задеваться новой проверкой — guard должен пропустить его дальше по
 * коду (до места, требующего реальный SpreadsheetApp, которое здесь не
 * достижимо без листов — поэтому проверяем только то, что ошибка
 * "недоступно для фильтров..." не выброшена раньше времени).
 */
function testPerformanceFilters_regularCompareWith2025StillWorks_() {

  let blockedByGuard = false;

  try {
    buildReport("2026", [{ question: "Отдел", values: ["Отдел разработки сайтов"], type: "single" }], true, "", false);
  } catch (error) {
    blockedByGuard = error.message.indexOf("недоступно для фильтров") !== -1;
  }

  assertPerfFilterTrue_(!blockedByGuard, "обычный фильтр + сравнение с 2025 не должны попадать под guard");

}

function testPerformanceFilters_noPerformanceFilterDoesNotBlock_() {

  assertPerfFilterEquals_(hasPerformanceOnlyFilter_([]), false, "пустой список фильтров — false");
  assertPerfFilterEquals_(
    hasPerformanceOnlyFilter_([{ question: "Отдел", values: ["x"] }]), false,
    "обычный фильтр — false"
  );
  assertPerfFilterEquals_(
    hasPerformanceOnlyFilter_([{ question: "Роль в отделе", values: ["Руководитель отдела"] }]), true,
    "фильтр \"Роль в отделе\" — true"
  );

}
