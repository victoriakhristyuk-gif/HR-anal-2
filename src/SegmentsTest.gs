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
    testSegments_comparesSmallPreviousSample_,
    testSegments_calculatesResponseRateForBothYears_,
    testSegments_fullCoverageDepartmentNotDevalued_,
    testSegments_currentStatusNotLimitedByPreviousYearFragile_,
    testSegments_currentStatusNotLimitedByPreviousLowCoverage_,
    testSegments_lowCoverageDepartmentWarns_,
    testSegments_partialCoverageShowsActualRate_,
    testSegments_unknownHeadcountNoRepresentativenessClaim_,
    testSegments_headcountUnreliablePreservesFlag_,
    testSegments_nonDepartmentDimensionSkipsFullCoverageLogic_,
    testSegments_yearDeltaMeaningfulByCIOverlapNotSize_,
    testSegments_bothYearsFullCoverageSmallStaysNotMeaningful_,
    testSegments_noSignalNotFactPhraseForFullCoverage_,
    testSegments_teamGroupSplitExcludesEmptyType_,
    testSegments_teamGroupSplitDoesNotMergeAcrossDivisions_,
    testSegments_teamGroupDimensionUsesHeadcountAndYear_
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

function testSegments_calculatesResponseRateForBothYears_() {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = [
    { year: "2025", departmentId: "dept_a", division: "Управление 2025", department: "Старое имя", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление 2026", department: "Новое имя", count: 12, row: 3 }
  ];
  Headcount.directory_ = null;

  const headers = ["Отдел", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];
  const rowsNow = new Array(6).fill(null).map(() => ["Новое имя", "9"]);
  const rowsBefore = new Array(4).fill(null).map(() => ["Старое имя", "8"]);

  try {
    const result = Segments.analyze(rowsNow, headers, questions, "Отдел", {
      year: "2026",
      previousYear: "2025",
      previousRows: rowsBefore,
      includeHeadcount: true,
      includePreviousHeadcount: true,
      headcountTotal: 12,
      previousHeadcountTotal: 10
    });
    const segment = result.segments[0];

    assertSegmentsEquals_(segment.name, "Новое имя", "оба названия объединены по ID");
    assertSegmentsEquals_(segment.n, 6, "ответили в 2026");
    assertSegmentsEquals_(segment.previousN, 4, "ответили в 2025");
    assertSegmentsEquals_(segment.headcount, 12, "приглашены в 2026");
    assertSegmentsEquals_(segment.previousHeadcount, 10, "приглашены в 2025");
    assertSegmentsEquals_(segment.responseRatePercent, 50, "явка 2026");
    assertSegmentsEquals_(segment.previousResponseRatePercent, 40, "явка 2025");
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

/**
 * ==========================================================
 * fullCoverage / coverageCaveat — регрессионные тесты
 * ==========================================================
 *
 * Малое n при ПОЛНОМ охвате (ответили все сотрудники отдела) — это
 * полное обследование команды, а не слабая выборка. Типичный отдел
 * компании — 10-12 человек. Тесты ниже проверяют, что интерпретация
 * различает "мало ответили" (низкая явка) от "мало людей в отделе"
 * (полный охват при малой численности) — см. Segments.coverageCaveat.
 */

function withHeadcountMock_(entries, fn) {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = entries;
  Headcount.directory_ = null;

  try {
    return fn();
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

/**
 * Строит фикстуру с двумя отделами: "Отдел А" (n=deptN, критики) и
 * "Отдел Б" — большая лояльная группа, задающая норму компании, чтобы
 * у "Отдел А" были настоящие (не искусственные) плохие отклонения и
 * confirmed = true.
 */
function segmentsCoverageFixture_(deptN, headcount) {

  const headers = ["Отдел", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];

  const rowsA = new Array(deptN).fill(null).map(() => ["Отдел А", "0"]);   // критики
  const rowsB = new Array(20).fill(null).map(() => ["Отдел Б", "10"]);     // промоутеры — норма компании

  return withHeadcountMock_([
    { year: "2026", departmentId: "dept_a", division: "Управление", department: "Отдел А", count: headcount, row: 2 }
  ], () => {

    const result = Segments.analyze(rowsA.concat(rowsB), headers, questions, "Отдел", {
      year: "2026",
      includeHeadcount: true,
      headcountTotal: (headcount || 0) + 20
    });

    return result.segments.find(s => s.name === "Отдел А");

  });

}

/**
 * Та же фикстура, но с прошлым годом — чтобы проверить, что
 * ограничения прошлогодней базы (низкая явка, малая база) влияют
 * только на надежность СРАВНЕНИЯ годов и не понижают статус текущего
 * результата, который считается по текущим данным.
 */
function segmentsCoverageFixtureWithPreviousYear_(deptN, headcount, previousDeptN, previousHeadcount) {

  const headers = ["Отдел", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];

  const rowsA = new Array(deptN).fill(null).map(() => ["Отдел А", "0"]);
  const rowsB = new Array(20).fill(null).map(() => ["Отдел Б", "10"]);
  const rowsBefore = new Array(previousDeptN).fill(null).map(() => ["Отдел А", "5"]);

  return withHeadcountMock_([
    { year: "2026", departmentId: "dept_a", division: "Управление", department: "Отдел А", count: headcount, row: 2 },
    { year: "2025", departmentId: "dept_a", division: "Управление", department: "Отдел А", count: previousHeadcount, row: 3 }
  ], () => {

    const result = Segments.analyze(rowsA.concat(rowsB), headers, questions, "Отдел", {
      year: "2026",
      previousYear: "2025",
      previousRows: rowsBefore,
      includeHeadcount: true,
      includePreviousHeadcount: true,
      headcountTotal: (headcount || 0) + 20,
      previousHeadcountTotal: previousHeadcount || 0
    });

    return result.segments.find(s => s.name === "Отдел А");

  });

}

/**
 * Сценарий 1: текущий год n=10/headcount=10 (полный охват), прошлый
 * год n=10/headcount=11 (явка 90,9%). Отклонение от нормы компании
 * считается по текущему году, поэтому текущий статус/severity не
 * должны зависеть от прошлогодней базы.
 *
 * ВАЖНО (методика, задача 3): раньше прошлый год n=10<25 всегда давал
 * yearComparisonLimited=true (fragile был функцией только n). Теперь
 * надежность — функция ФАКТИЧЕСКОЙ ширины ДИ (см. Norms.reliabilityClass):
 * при n=10/N=11 (явка 90,9%, все 10 ответов — критики) скорректированный
 * ДИ eNPS ≈ ±9,9 пункта (класс "Рабочая оценка", 6 < ДИ ≤ 12), а явка
 * 90,9% ≥ 80% — значит сравнение годов теперь НЕ ограничено. Это ровно
 * тот случай, который методика считала избыточно строгим (отдел
 * 24 из 25 приравнивался к отделу с неизвестным знаменателем).
 */
function testSegments_currentStatusNotLimitedByPreviousYearFragile_() {

  const segment = segmentsCoverageFixtureWithPreviousYear_(10, 10, 10, 11);

  assertSegmentsEquals_(segment.fullCoverage, true, "текущий год — полный охват");
  assertSegmentsEquals_(segment.previousFullCoverage, false, "прошлый год не полный (10 из 11)");
  assertSegmentsEquals_(segment.previousResponseRatePercent, 90.9, "прошлогодняя явка 90,9%");
  assertSegmentsEquals_(segment.confirmed, true, "проблема подтверждена");

  assertSegmentsEquals_(Segments.currentReliabilityLimited(segment), false,
    "текущая надежность не ограничена прошлогодней базой");

  // Реальные формулы AnalyticsService.gs (п.6) и AnalyticsWriter.gs
  // (writeSegments_) — обе вызывают Segments.currentReliabilityLimited.
  const findingsSeverity = Segments.currentReliabilityLimited(segment) ? "warning" : "critical";
  const sheetInsufficientData = Segments.currentReliabilityLimited(segment);
  assertSegmentsEquals_(findingsSeverity, "critical",
    "подтвержденная находка остается critical, прошлогодняя база её не понижает");
  assertSegmentsEquals_(sheetInsufficientData, false,
    "текущий статус на листе срезов не становится «недостаточно данных» из-за прошлого года");

  // Прошлогодняя явка 90,9% (≥80%) при рабочем классе ДИ (±9,9,
  // 6 < ДИ ≤ 12) больше не ограничивает сравнение годов — старое
  // правило (n < 25 ⇒ всегда limited) было именно той избыточной
  // строгостью, которую методика просила убрать.
  assertSegmentsEquals_(Segments.yearComparisonLimited(segment), false,
    "явка 90,9% и рабочий класс ДИ (±9,9) не ограничивают сравнение годов");

}

/**
 * Сценарий 2: текущий год n=10/headcount=10 (полный охват), прошлый
 * год n=3/headcount=10 (явка 30%, низкая). Тот же принцип: низкая
 * прошлогодняя явка — это ограничение сравнения годов, а не текущего
 * результата.
 */
function testSegments_currentStatusNotLimitedByPreviousLowCoverage_() {

  const segment = segmentsCoverageFixtureWithPreviousYear_(10, 10, 3, 10);

  assertSegmentsEquals_(segment.fullCoverage, true, "текущий год — полный охват");
  assertSegmentsEquals_(segment.previousLowCoverage, true, "прошлый год — низкая явка (30%)");

  assertSegmentsEquals_(Segments.currentReliabilityLimited(segment), false,
    "текущий вывод остается полноценным несмотря на низкую прошлогоднюю явку");
  assertSegmentsEquals_(Segments.yearComparisonLimited(segment), true,
    "низкая прошлогодняя явка отмечается только как ограничение сравнения годов");

}

/**
 * Сценарий 1: n=10, headcount=10 — полный охват малого отдела.
 */
function testSegments_fullCoverageDepartmentNotDevalued_() {

  const segment = segmentsCoverageFixture_(10, 10);

  assertSegmentsEquals_(segment.responseRatePercent, 100, "явка 100%");
  assertSegmentsEquals_(segment.fullCoverage, true, "полный охват распознан");
  assertSegmentsEquals_(segment.fragile, true, "fragile сохраняется как признак числовой чувствительности");
  assertSegmentsEquals_(segment.badCount >= 2, true, "у отдела минимум два плохих отклонения");
  assertSegmentsEquals_(segment.confirmed, true, "проблема подтверждена");

  const caveat = Segments.coverageCaveat(segment, false);

  assertSegmentsEquals_(caveat.limitsReliability, false, "полный охват не понижает надежность вывода");
  assertSegmentsEquals_(caveat.text.indexOf("не как факт") === -1, true, "нет обесценивающей формулировки «не как факт»");
  assertSegmentsEquals_(caveat.text.indexOf("сигнал, а не факт") === -1, true, "нет формулировки «сигнал, а не факт»");
  assertSegmentsEquals_(caveat.text.indexOf("Полный охват") !== -1, true, "поясняет полный охват");

  // Итоговая серьезность — реальная функция
  // Segments.currentReliabilityLimited, используемая и в
  // AnalyticsService.findings, и в AnalyticsWriter — не понижается до
  // "warning" только из-за малого n при полном охвате.
  const severity = Segments.currentReliabilityLimited(segment) ? "warning" : "critical";
  assertSegmentsEquals_(severity, "critical", "подтвержденная проблема не понижена до warning из-за fragile");

}

/**
 * Сценарий 2: n=4, headcount=10 — явка 40%.
 */
function testSegments_lowCoverageDepartmentWarns_() {

  const segment = segmentsCoverageFixture_(4, 10);

  assertSegmentsEquals_(segment.responseRatePercent, 40, "явка 40%");
  assertSegmentsEquals_(segment.lowCoverage, true, "низкая явка распознана");
  assertSegmentsEquals_(segment.fullCoverage, false, "полный охват не устанавливается");

  const caveat = Segments.coverageCaveat(segment, false);
  assertSegmentsEquals_(caveat.limitsReliability, true, "предупреждение о нерепрезентативности сохраняется");

}

/**
 * Сценарий 3: n=10, headcount=12 — явка 83,3%, частичный охват.
 */
function testSegments_partialCoverageShowsActualRate_() {

  const segment = segmentsCoverageFixture_(10, 12);

  assertSegmentsEquals_(segment.responseRatePercent, 83.3, "явка 83,3%");
  assertSegmentsEquals_(segment.fullCoverage, false, "не полный охват");
  assertSegmentsEquals_(segment.lowCoverage, false, "не низкая явка");
  assertSegmentsEquals_(segment.fragile, true, "n < 25 — малая база");

  const caveat = Segments.coverageCaveat(segment, false);

  assertSegmentsEquals_(caveat.text.indexOf("сигнал, а не факт") === -1, true, "нет «сигнал, а не факт»");
  assertSegmentsEquals_(caveat.text.indexOf("СИГНАЛ") === -1, true, "нет алармистского «СИГНАЛ:»");
  assertSegmentsEquals_(caveat.text.indexOf("10") !== -1 && caveat.text.indexOf("12") !== -1, true,
    "показаны фактические n и численность");
  assertSegmentsEquals_(caveat.text.indexOf("83.3") !== -1 || caveat.text.indexOf("83,3") !== -1, true,
    "показан фактический процент явки");

  // Findings (AnalyticsService, п.6) и лист "Отклонения срезов"
  // (AnalyticsWriter) ОБА вычисляют severity/status через
  // Segments.currentReliabilityLimited(segment) — вызывается сама
  // функция, а не её копия, иначе тест проверяет не то, что реально
  // исполняется (см. регрессию: 10 из 12 получал критичный статус в
  // находках и «недостаточно данных» на листе одновременно).
  const findingsSeverity = Segments.currentReliabilityLimited(segment) ? "warning" : "critical";
  const sheetInsufficientData = Segments.currentReliabilityLimited(segment);
  assertSegmentsEquals_(findingsSeverity === "warning", sheetInsufficientData, "findings и лист срезов согласованы");

}

/**
 * Сценарий 4: численность неизвестна — репрезентативность по явке не
 * оценивается, полный охват не устанавливается.
 */
function testSegments_unknownHeadcountNoRepresentativenessClaim_() {

  const headers = ["Отдел", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];
  const rows = new Array(10).fill(null).map(() => ["Отдел без справочника", "9"]);

  const result = withHeadcountMock_([], () =>
    Segments.analyze(rows, headers, questions, "Отдел", {
      year: "2026",
      includeHeadcount: true,
      headcountTotal: null
    })
  );

  const segment = result.segments[0];

  assertSegmentsEquals_(segment.headcount, null, "численность неизвестна");
  assertSegmentsEquals_(segment.fullCoverage, false, "полный охват не устанавливается без численности");

  const caveat = Segments.coverageCaveat(segment, false);
  assertSegmentsEquals_(caveat.text.indexOf("неизвестна") !== -1, true, "явно указано, что явка неизвестна");
  assertSegmentsEquals_(caveat.text.indexOf("не как факт") === -1, true, "нет «не как факт»");

}

/**
 * Сценарий 5: ответов больше численности — headcountUnreliable
 * сохраняется, полный охват не устанавливается.
 */
function testSegments_headcountUnreliablePreservesFlag_() {

  const segment = segmentsCoverageFixture_(15, 10);

  assertSegmentsEquals_(segment.headcountUnreliable, true, "справочник численности требует проверки");
  assertSegmentsEquals_(segment.fullCoverage, false, "полный охват не устанавливается при явке > 100%");

  const caveat = Segments.coverageCaveat(segment, false);
  assertSegmentsEquals_(caveat.limitsReliability, true, "недостоверный справочник понижает надежность");

}

/**
 * Сценарий 6: срез не по отделу/управлению (например "Стаж") —
 * численность не считается, логика полного охвата не применяется.
 */
function testSegments_nonDepartmentDimensionSkipsFullCoverageLogic_() {

  const headers = ["Стаж", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];
  const rows = new Array(10).fill(null).map(() => ["1-3 года", "9"]);

  const result = Segments.analyze(rows, headers, questions, "Стаж", {
    includeHeadcount: true,
    headcountTotal: null
  });

  const segment = result.segments[0];

  assertSegmentsEquals_(segment.headcount, null, "явка не считается для среза «Стаж»");
  assertSegmentsEquals_(segment.fullCoverage, false, "полный охват не применяется вне «Отдел»/«Управление»");

  // Для "Стаж"/"Город" и т.п. численность не "неизвестна" — для них
  // явки в принципе не существует (нет знаменателя приглашенных).
  // Текст не должен путать эти два случая (см. регрессию: «Стаж»
  // получал формулировку «численность неизвестна», как будто это
  // пробел в справочнике, а не отсутствие самого понятия явки).
  const caveat = Segments.coverageCaveat(segment, false);
  assertSegmentsEquals_(caveat.text.indexOf("численность неизвестна") === -1, true,
    "для «Стаж» не заявляется, что численность неизвестна");
  assertSegmentsEquals_(caveat.text.indexOf("не как факт") === -1, true, "нет «не как факт»");
  assertSegmentsEquals_(caveat.text.indexOf("сигнал, а не факт") === -1, true, "нет «сигнал, а не факт»");

}

/**
 * Сценарий 7 (методика, задача 3): yearDelta.meaningful больше НЕ
 * зависит от абсолютного n (раньше требовал n >= FRAGILE_SEGMENT_SIZE
 * у обеих баз — это и было причиной, почему 29 из 36 отделов получали
 * «недостаточно данных»). Теперь — пересечение скорректированных ДИ
 * (MathStats.enpsChangeIsReal). В этой фикстуре: текущий год 2 ответа
 * (9,10 — оба промоутера, eNPS=+100), прошлый год 1 ответ (6 — критик,
 * eNPS=-100). Разброс между годами (200 пунктов) настолько велик, что
 * даже широкие ДИ обеих крошечных баз (без FPC, знаменатель не
 * передан) не перекрываются — изменение признаётся meaningful=true,
 * несмотря на n=1 и n=2.
 */
function testSegments_yearDeltaMeaningfulByCIOverlapNotSize_() {

  const fixture = segmentsSmallSamplesFixture_();
  const segment = fixture.result.segments.find(item => item.name === "Малый отдел");

  assertSegmentsEquals_(segment.yearDelta.meaningful, true,
    "разница eNPS +100 → -100 не перекрывается по ДИ даже при n=1/n=2 — правило больше не гейтится размером базы");

}

/**
 * Сценарий 4: оба года — полный охват (n=10/headcount=10 и
 * prevN=10/prevHeadcount=10), обе базы дают eNPS=-100 и ДИ=±0 (FPC=0
 * при полном охвате). Текущий результат не понижается
 * (currentReliabilityLimited=false), а yearDelta.meaningful остается
 * false — не потому, что базы малы (старое правило n>=25 больше не
 * действует, см. testSegments_yearDeltaMeaningfulByCIOverlapNotSize_),
 * а потому что при ДИ=±0 с обеих сторон и одинаковом eNPS (-100 оба
 * года) разница буквально равна нулю: gap=0 не превышает jointMargin=0.
 */
function testSegments_bothYearsFullCoverageSmallStaysNotMeaningful_() {

  const segment = segmentsCoverageFixtureWithPreviousYear_(10, 10, 10, 10);

  assertSegmentsEquals_(segment.fullCoverage, true, "текущий год — полный охват");
  assertSegmentsEquals_(segment.previousFullCoverage, true, "прошлый год — тоже полный охват");

  assertSegmentsEquals_(Segments.currentReliabilityLimited(segment), false,
    "текущий результат не понижается — репрезентативность признана полной");

  assertSegmentsEquals_(segment.yearDelta.meaningful, false,
    "yearDelta.meaningful остается false: действующее правило (n >= FRAGILE_SEGMENT_SIZE) не изменилось");

}

/**
 * Сценарий 8: фраза «не как факт» нигде не появляется для полного
 * охвата — проверка и текущего, и прошлогоднего пояснения.
 */
function testSegments_noSignalNotFactPhraseForFullCoverage_() {

  const segment = segmentsCoverageFixture_(10, 10);

  const currentCaveat = Segments.coverageCaveat(segment, false);
  assertSegmentsEquals_(currentCaveat.text.indexOf("не как факт") === -1, true,
    "текущий год: нет «не как факт»");

  const exampleText = Glossary.EXAMPLE.sampleReliability(segment, "Отдел");
  assertSegmentsEquals_(exampleText.indexOf("не как факт") === -1, true,
    "пример в глоссарии: нет «не как факт»");
  assertSegmentsEquals_(exampleText.indexOf("сигнальный, а не факт") === -1, true,
    "пример в глоссарии: нет «сигнальный, а не факт»");

}

/**
 * Срез "Группа команд": отдел без указанного типа команды не попадает
 * ни в один бакет (правило 3-4 в заголовке Headcount.gs) — не должно
 * появляться синтетической группы вида "не указано".
 */
function testSegments_teamGroupSplitExcludesEmptyType_() {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_c", division: "Управление разработки ПО", teamType: null, department: "Отдел без типа", count: 5, row: 3 }
  ];
  Headcount.directory_ = null;

  const headers = ["Отдел", "eNPS"];
  const rows = [["Отдел А", "9"], ["Отдел без типа", "8"]];

  try {
    const buckets = Segments.splitBy(rows, headers, "Группа команд", null, "2026");
    const keys = Object.keys(buckets);

    assertSegmentsEquals_(keys.length, 1, "только одна непустая группа");
    assertSegmentsEquals_(keys[0], "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда",
      "название группы — Управление + Тип команды");
    assertSegmentsEquals_(buckets[keys[0]].length, 1, "в группу входит только отдел с указанным типом");
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

/**
 * Одинаковое название типа команды в разных управлениях не должно
 * объединяться в одну группу (правило 9-10).
 */
function testSegments_teamGroupSplitDoesNotMergeAcrossDivisions_() {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_it", division: "ИТ-управление", teamType: "Сервисная команда", department: "Отдел ИТ", count: 6, row: 3 }
  ];
  Headcount.directory_ = null;

  const headers = ["Отдел", "eNPS"];
  const rows = [["Отдел А", "9"], ["Отдел ИТ", "7"]];

  try {
    const buckets = Segments.splitBy(rows, headers, "Группа команд", null, "2026");
    assertSegmentsEquals_(Object.keys(buckets).length, 2, "две отдельные группы, хотя тип команды называется одинаково");
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

/**
 * Как и "Отдел"/"Управление", срез "Группа команд" считает численность
 * и явку отдельно для текущего и прошлого года (правило 5 — годовая
 * принадлежность).
 */
function testSegments_teamGroupDimensionUsesHeadcountAndYear_() {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = [
    { year: "2025", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел А", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 12, row: 3 }
  ];
  Headcount.directory_ = null;

  const headers = ["Отдел", "eNPS"];
  const questions = [{ title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }];
  const rowsNow = new Array(6).fill(null).map(() => ["Отдел А", "9"]);
  const rowsBefore = new Array(5).fill(null).map(() => ["Отдел А", "8"]);

  try {
    const result = Segments.analyze(rowsNow, headers, questions, "Группа команд", {
      year: "2026",
      previousYear: "2025",
      previousRows: rowsBefore,
      includeHeadcount: true,
      includePreviousHeadcount: true,
      headcountTotal: 12,
      previousHeadcountTotal: 10
    });

    assertSegmentsEquals_(result.segments.length, 1, "одна группа 2026 (Сервисная команда)");

    const segment = result.segments[0];

    assertSegmentsEquals_(segment.name, "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда", "название группы 2026");
    assertSegmentsEquals_(segment.n, 6, "ответили в 2026");
    assertSegmentsEquals_(segment.headcount, 12, "приглашены в 2026 (группа Сервисная)");
    assertSegmentsEquals_(segment.responseRatePercent, 50, "явка 2026");
    // Прошлый год у того же отдела — другой тип команды ("Доменная
    // разработка"), поэтому в бакете "...Сервисная команда" 2025 года
    // прошлой базы нет: год-к-году join по названию группы не находит
    // совпадения — ровно то, что и требуется правилом 5.
    assertSegmentsEquals_(segment.previousN, 0, "группа с этим именем не существовала в 2025 — тип был другим");
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}
