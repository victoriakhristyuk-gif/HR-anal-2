/**
 * ==========================================================
 * Ручные тесты тональности детектора тем комментариев (ReportBuilder)
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testReportBuilderThemeTone_runAll() печатает
 * PASS/FAIL по каждому кейсу и бросает Error, если хоть один упал.
 *
 * Покрывает баг: негативный маркер, целиком содержащий позитивный как
 * подстроку ("непонятно" содержит "понятно", "не рассказывают" содержит
 * "рассказывают"), раньше давал ложный tone "mixed" вместо "negative".
 * assertEquals_ определен в DepartmentAliasesTest.gs (общий на проект).
 */

function testReportBuilderThemeTone_runAll() {

  const tests = [
    testReportBuilderThemeTone_negationNotCountedAsPositive_,
    testReportBuilderThemeTone_negationRasskazyvaut_,
    testReportBuilderThemeTone_genuineMixedStillMixed_,
    testReportBuilderThemeTone_pureNegativeStillNegative_
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

  console.log("Все тесты тональности детектора тем пройдены.");

}

/**
 * "Бюрократия непонятно замучила" — триггер "бюрократ" + негативный
 * маркер "непонятно". Позитивный маркер "понятно" — подстрока
 * "непонятно" и не должен засчитаться отдельно.
 */
function testReportBuilderThemeTone_negationNotCountedAsPositive_() {

  const matches = ReportBuilder.matchCommentThemes_("Бюрократия совсем непонятно устроена, мешает работать.");
  const bureaucracy = matches.find(m => m.theme === "Бюрократия/процессы");

  assertEquals_(!!bureaucracy, true, "тема «Бюрократия/процессы» найдена");
  assertEquals_(bureaucracy.tone, "negative", "тональность — чисто негативная, а не mixed");

}

/**
 * "Стратегию компании не рассказывают" — негативный маркер "не
 * рассказывают" содержит позитивный маркер "рассказывают" как
 * подстроку и не должен давать ложный позитив.
 */
function testReportBuilderThemeTone_negationRasskazyvaut_() {

  const matches = ReportBuilder.matchCommentThemes_("Стратегию компании нам не рассказывают, куда движемся непонятно.");
  const strategy = matches.find(m => m.theme === "Прозрачность стратегии");

  assertEquals_(!!strategy, true, "тема «Прозрачность стратегии» найдена");
  assertEquals_(strategy.tone, "negative", "тональность — чисто негативная, а не mixed");

}

/**
 * Позитивный маркер, встреченный НЕ как часть негативного маркера,
 * по-прежнему должен давать mixed вместе с реальным негативом.
 */
function testReportBuilderThemeTone_genuineMixedStillMixed_() {

  const matches = ReportBuilder.matchCommentThemes_("Бюрократия иногда мешает, но в целом стало лучше.");
  const bureaucracy = matches.find(m => m.theme === "Бюрократия/процессы");

  assertEquals_(!!bureaucracy, true, "тема «Бюрократия/процессы» найдена");
  assertEquals_(bureaucracy.tone, "mixed", "тональность — mixed при независимых негативе и позитиве");

}

/**
 * Комментарий без каких-либо маркеров тональности (кроме негативного)
 * по-прежнему должен давать negative.
 */
function testReportBuilderThemeTone_pureNegativeStillNegative_() {

  const matches = ReportBuilder.matchCommentThemes_("ДМС очень плохое, список клиник узкий.");
  const dms = matches.find(m => m.theme === "ДМС");

  assertEquals_(!!dms, true, "тема «ДМС» найдена");
  assertEquals_(dms.tone, "negative", "тональность — negative");

}
