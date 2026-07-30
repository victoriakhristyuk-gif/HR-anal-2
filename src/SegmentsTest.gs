/**
 * ==========================================================
 * Ручные тесты полноты срезов
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testSegments_runAll().
 *
 * Проверяет, что малые и новые отделы не скрываются, а сравнение с
 * прошлым годом строится при любой непустой базе.
 */

function testSegments_runAll() {

  const tests = [
    testSegments_keepsEveryNonEmptyDepartment_,
    testSegments_comparesSmallPreviousSample_
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

  console.log("Все тесты Segments пройдены.");

}

function assertSegmentsEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertSegmentsEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual));
  }
}

function segmentsSmallSamplesFixture_() {

  const headers = ["Отдел", "eNPS"];
  const questions = [{
    title: "eNPS",
    type: "enps",
    group: "Лояльность",
    subgroup: "eNPS"
  }];

  const rowsNow = [
    ["Новый отдел из одного ответа", "9"],
    ["Малый отдел", "9"],
    ["Малый отдел", "10"]
  ];

  const rowsBefore = [
    ["Малый отдел", "6"]
  ];

  return {
    result: Segments.analyze(rowsNow, headers, questions, "Отдел", {
      previousRows: rowsBefore
    })
  };

}

/**
 * Отделы с n=1 и n=2 должны оба присутствовать в результате.
 */
function testSegments_keepsEveryNonEmptyDepartment_() {

  const fixture = segmentsSmallSamplesFixture_();
  const names = fixture.result.segments.map(segment => segment.name);

  assertSegmentsEquals_(fixture.result.segments.length, 2, "показаны оба малых отдела");
  assertSegmentsEquals_(names.indexOf("Новый отдел из одного ответа") !== -1, true, "показан отдел с n=1");
  assertSegmentsEquals_(names.indexOf("Малый отдел") !== -1, true, "показан отдел с n=2");

  fixture.result.segments.forEach(segment => {
    assertSegmentsEquals_(segment.fragile, true, segment.name + " помечен как малая база");
  });

  const newDepartment = fixture.result.segments.find(
    segment => segment.name === "Новый отдел из одного ответа"
  );
  assertSegmentsEquals_(newDepartment.previousN, 0, "для нового отдела показана нулевая прошлая база");

}

/**
 * Единственный прошлогодний ответ достаточен для расчета описательной
 * динамики; надежность читатель оценивает по n и ДИ.
 */
function testSegments_comparesSmallPreviousSample_() {

  const fixture = segmentsSmallSamplesFixture_();
  const segment = fixture.result.segments.find(item => item.name === "Малый отдел");

  assertSegmentsEquals_(segment.yearDelta !== null, true, "динамика малой выборки рассчитана");
  assertSegmentsEquals_(segment.yearDelta.previousN, 1, "сохранен размер прошлогодней базы");
  assertSegmentsEquals_(segment.previousFragile, true, "прошлогодняя база помечена как малая");
  assertSegmentsEquals_(segment.yearDelta.previous, -100, "рассчитан прошлогодний eNPS");
  assertSegmentsEquals_(segment.yearDelta.delta, 200, "рассчитана дельта eNPS");

}
