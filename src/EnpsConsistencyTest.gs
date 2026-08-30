/**
 * ==========================================================
 * Ручные тесты согласованности eNPS (HR-002/003)
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testEnpsConsistency_runAll() печатает
 * PASS/FAIL по каждому кейсу и бросает Error, если хоть один упал.
 *
 * Проверяет акцептанс-критерий HR-002: один и тот же fixture дает
 * идентичные promoters/neutrals/detractors/total и eNPS (после
 * округления) и в Statistics.calculateENPS (основной отчет/сводная),
 * и в расчете, эквивалентном Segments.metricsFor/Cohort.enpsChange
 * (расширенная аналитика) — оба теперь используют один и тот же
 * Scoring.enpsCategory.
 */

function testEnpsConsistency_runAll() {

  const tests = [
    testEnpsConsistency_matchesAcrossCircuits_,
    testEnpsConsistency_emptyCellExcluded_,
    testEnpsConsistency_boundaryValues_
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

  console.log("Все тесты EnpsConsistency пройдены.");

}

/**
 * Расчет, эквивалентный расширенной аналитике (Segments.metricsFor /
 * Cohort.enpsChange): Scoring.vector + Scoring.enpsCategory +
 * MathStats.enpsConfidence.
 */
function enpsConsistency_advancedCircuit_(rows, headers) {

  const enpsQuestion = Questions.getAll().find(q => q.type === "enps");
  const vector = Scoring.vector(rows, headers, enpsQuestion);
  const valid = vector.filter(v => v !== null);

  const promoters = valid.filter(v => Scoring.enpsCategory(v) === "promoters").length;
  const neutrals = valid.filter(v => Scoring.enpsCategory(v) === "neutrals").length;
  const detractors = valid.filter(v => Scoring.enpsCategory(v) === "detractors").length;

  const ci = MathStats.enpsConfidence(promoters, detractors, valid.length);

  return {
    promoters: promoters,
    neutrals: neutrals,
    detractors: detractors,
    total: valid.length,
    enps: ci.enps
  };

}

/**
 * Fixture: 10 валидных ответов (по одному на каждую точку шкалы
 * 1..10 из карты вопросов) + одна пустая ячейка + один
 * "затрудняюсь ответить" (не точка шкалы — должен быть исключен из
 * знаменателя обоими контурами).
 */
function enpsConsistency_fixture_() {

  const headers = ["Отдел", "eNPS"];

  const rows = [
    ["Отдел продаж", "1"],
    ["Отдел продаж", "2"],
    ["Отдел продаж", "3"],
    ["Отдел продаж", "4"],
    ["Отдел продаж", "5"],
    ["Отдел продаж", "6"],
    ["Отдел продаж", "7"],
    ["Отдел продаж", "8"],
    ["Отдел продаж", "9"],
    ["Отдел продаж", "10"],
    ["Отдел продаж", ""],
    ["Отдел продаж", "затрудняюсь ответить"]
  ];

  return { headers: headers, rows: rows };

}

/**
 * 1. Один fixture — идентичные promoters/neutrals/detractors/total
 * в обоих контурах, eNPS совпадает после округления до целого.
 */
function testEnpsConsistency_matchesAcrossCircuits_() {

  const fixture = enpsConsistency_fixture_();

  const main = Statistics.calculateENPS(fixture.rows, fixture.headers);
  const advanced = enpsConsistency_advancedCircuit_(fixture.rows, fixture.headers);

  assertEquals_(main.promoters, advanced.promoters, "promoters");
  assertEquals_(main.neutrals, advanced.neutrals, "neutrals");
  assertEquals_(main.detractors, advanced.detractors, "detractors");
  assertEquals_(main.total, advanced.total, "total");
  assertEquals_(main.enps, Math.round(advanced.enps), "enps (округленный)");

  // Значения 1..6 — критики (6 шт.), 7-8 — нейтралы (2 шт.), 9-10 — промоутеры (2 шт.)
  assertEquals_(main.detractors, 6, "критики (0-6)");
  assertEquals_(main.neutrals, 2, "нейтралы (7-8)");
  assertEquals_(main.promoters, 2, "промоутеры (9-10)");
  assertEquals_(main.total, 10, "знаменатель без пустой ячейки и «затрудняюсь ответить»");

}

/**
 * 2. Баг до фикса: Number("") === 0, пустая ячейка eNPS молча
 * считалась критиком в Statistics.calculateENPS. После фикса она
 * исключена из знаменателя, как и в расширенной аналитике.
 */
function testEnpsConsistency_emptyCellExcluded_() {

  const headers = ["Отдел", "eNPS"];
  const rows = [
    ["Отдел продаж", "9"],
    ["Отдел продаж", ""]
  ];

  const main = Statistics.calculateENPS(rows, headers);

  assertEquals_(main.total, 1, "пустая ячейка не входит в знаменатель");
  assertEquals_(main.detractors, 0, "пустая ячейка не засчитана критиком");
  assertEquals_(main.promoters, 1, "единственный валидный ответ — промоутер");

}

/**
 * 3. Граничные значения категорий: 6 — критик, 7 — нейтрал (нижняя
 * граница), 8 — нейтрал (верхняя граница), 9 — промоутер (нижняя
 * граница).
 */
function testEnpsConsistency_boundaryValues_() {

  assertEquals_(Scoring.enpsCategory(6), "detractors", "6 — критик");
  assertEquals_(Scoring.enpsCategory(7), "neutrals", "7 — нейтрал");
  assertEquals_(Scoring.enpsCategory(8), "neutrals", "8 — нейтрал");
  assertEquals_(Scoring.enpsCategory(9), "promoters", "9 — промоутер");
  assertEquals_(Scoring.enpsCategory(null), null, "null остается null");

}
