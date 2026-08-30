/**
 * ==========================================================
 * Ручные тесты перекалибровки надёжности (методика, фаза 1)
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testReliabilityRecalibration_runAll().
 *
 * Проверяет ФУНДАМЕНТ методики (MathStats.finitePopulationCorrection/
 * enpsConfidence/proportionConfidence) независимо от реальных данных
 * листов "Ответы 2025"/"Ответы 2026" — эти тесты работают на явно
 * заданных n/N и не требуют доступа к таблице.
 *
 * ЧЕГО ЭТИ ТЕСТЫ НЕ ДЕЛАЮТ. Полное совпадение ДИ листа "Отклонения
 * срезов" с эталонной таблицей методики (норма ±2,9 при 418/549,
 * УРПО ±3,2, тестирование ПО ±8,3 и т.д.) зависит от РЕАЛЬНЫХ чисел
 * промоутеров/критиков по каждой группе, которых нет в этом
 * окружении — эту сверку нужно сделать вручную по построенному листу
 * (см. testReliability_fpcMatchesReferenceTable_ ниже: проверяет
 * только ту часть эталона, которая НЕ зависит от распределения
 * промоутеров/критиков — саму поправку FPC(n, N) — и её должно
 * хватить, чтобы убедиться, что множитель к ДИ верный).
 */

function testReliabilityRecalibration_runAll() {

  const tests = [
    testReliability_fpcMatchesReferenceTable_,
    testReliability_fpcRulesForUnknownAndDegenerateN_,
    testReliability_fpcNotAppliedWhenAnswersExceedHeadcount_,
    testReliability_fullCoverageGivesZeroMarginAcrossMetrics_,
    testReliability_ciZeroIffFullCoverage_,
    testReliability_laplaceAvoidsDegenerateVarianceForEnps_,
    testReliability_laplaceAvoidsDegenerateVarianceForProportion_,
    testReliability_pointEstimateUnaffectedByPopulationSize_,
    testReliability_zTestProportionsAcceptsPerSideN_,
    testReliability_welchTestAcceptsPerSideN_,
    testReliability_deviationCarriesStatisticalSignificance_,
    testReliability_classByEnpsMarginWidth_
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

  console.log("Все тесты ReliabilityRecalibration пройдены.");

}

function assertReliabilityEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertReliabilityEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertReliabilityClose_(actual, expected, tolerance, message) {
  if (actual === null || actual === undefined || isNaN(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error((message || "assertReliabilityClose") +
      ": ожидалось ~" + expected + " (±" + tolerance + "), получено " + actual);
  }
}

function assertReliabilityTrue_(condition, message) {
  if (!condition) throw new Error(message || "assertReliabilityTrue");
}

/**
 * FPC(n, N) = sqrt((N-n)/(N-1)) — эталонная таблица методики (задача 1,
 * актуализированная версия). Значения зависят ТОЛЬКО от n и N, поэтому
 * проверяются точно, без обращения к реальным данным опроса.
 *
 *   Группа                              n    N    FPC
 *   Норма компании                      418  549  0,4889
 *   Управление разработки ПО (УРПО)     289  356  0,4344
 *   Отдел тестирования ПО               33   40   0,4237
 *   Отдел разработки водительских серв. 24   25   0,2041
 *   Отдел локализации и перевода        19   21   0,3162
 *   Отдел разработки гео сервисов       16   21   0,5
 *   Отдел разработки техдокументации    10   10   0
 *   Отдел бизнес-анализа                9    9    0
 *   Отдел эксплуатации сети             6    6    0
 */
function testReliability_fpcMatchesReferenceTable_() {

  const table = [
    { label: "Норма компании", n: 418, N: 549, fpc: 0.4889 },
    { label: "УРПО", n: 289, N: 356, fpc: 0.4344 },
    { label: "Отдел тестирования ПО", n: 33, N: 40, fpc: 0.4237 },
    { label: "Отдел разработки водительских сервисов", n: 24, N: 25, fpc: 0.2041 },
    { label: "Отдел локализации и перевода", n: 19, N: 21, fpc: 0.3162 },
    { label: "Отдел разработки гео сервисов", n: 16, N: 21, fpc: 0.5 },
    { label: "Отдел разработки технической документации", n: 10, N: 10, fpc: 0 },
    { label: "Отдел бизнес-анализа", n: 9, N: 9, fpc: 0 },
    { label: "Отдел эксплуатации сети", n: 6, N: 6, fpc: 0 }
  ];

  table.forEach(row => {
    const fpc = MathStats.finitePopulationCorrection(row.n, row.N);
    assertReliabilityClose_(fpc, row.fpc, 0.0005, row.label + ": FPC(" + row.n + "," + row.N + ")");
  });

}

/**
 * Правила FPC при N неизвестен/≤1 (без поправки, FPC=1).
 */
function testReliability_fpcRulesForUnknownAndDegenerateN_() {

  assertReliabilityEquals_(MathStats.finitePopulationCorrection(10, null), 1, "N=null → без поправки");
  assertReliabilityEquals_(MathStats.finitePopulationCorrection(10, undefined), 1, "N не передан → без поправки");
  assertReliabilityEquals_(MathStats.finitePopulationCorrection(1, 1), 1, "N=1 → без поправки (вырожденный случай)");
  assertReliabilityEquals_(MathStats.finitePopulationCorrection(0, 0), 1, "N=0 → без поправки");

}

/**
 * n > N — ошибка в справочнике численности (задача 4 методики,
 * НЕ правится кодом). FPC=1 (без поправки), не NaN и не отрицательный
 * корень. Строки из задачи 4: за 2026 — Отдел сетевых технологий
 * (14 при штате 1), Отдел разработки инфраструктурных сервисов
 * (5 при 3), Отдел серверных решений и СХД (30 при 29); за 2025 —
 * Отдел сетевых технологий (18 при 16), Отдел обслуживания платежных
 * систем (13 при 12). Эти строки правятся в справочнике вручную — не
 * в этом тесте, не в коде (см. testReliability_ciZeroIffFullCoverage_,
 * где они явно исключены из свойства "ДИ=0 ⟺ явка 100%").
 */
function testReliability_fpcNotAppliedWhenAnswersExceedHeadcount_() {

  const brokenRows = [
    { label: "Отдел сетевых технологий 2026", n: 14, N: 1 },
    { label: "Отдел разработки инфраструктурных сервисов 2026", n: 5, N: 3 },
    { label: "Отдел серверных решений и СХД 2026", n: 30, N: 29 },
    { label: "Отдел сетевых технологий 2025", n: 18, N: 16 },
    { label: "Отдел обслуживания платежных систем 2025", n: 13, N: 12 }
  ];

  brokenRows.forEach(row => {
    const fpc = MathStats.finitePopulationCorrection(row.n, row.N);
    assertReliabilityEquals_(fpc, 1, row.label + ": n>N → без поправки, не NaN и не 0");
  });

}

/**
 * Полный охват (n=N) даёт ДИ=0 для ВСЕХ метрик, использующих FPC —
 * eNPS, доля (критики/выгорание/уход) и среднее (rating5), не только
 * eNPS (задача 1: поправка применяется ко всем интервалам, где
 * знаменатель известен).
 */
function testReliability_fullCoverageGivesZeroMarginAcrossMetrics_() {

  const n = 10;
  const N = 10;

  const enpsCi = MathStats.enpsConfidence(6, 2, n, N);
  assertReliabilityEquals_(enpsCi.margin, 0, "eNPS: полный охват → ДИ=0");

  const propCi = MathStats.proportionConfidence(3, n, N);
  assertReliabilityEquals_(propCi.margin, 0, "доля: полный охват → ДИ=0");

  const meanCi = MathStats.meanConfidence(4.2, 0.8, n, N);
  assertReliabilityEquals_(meanCi.margin, 0, "среднее: полный охват → ДИ=0");

}

/**
 * Свойство "ДИ = 0 ⟺ явка 100%" — задача 4 методики (актуализированная
 * версия): проверяется на батарее n/N ПАР, за явным исключением строк,
 * где n > N (ошибка в справочнике численности, см.
 * testReliability_fpcNotAppliedWhenAnswersExceedHeadcount_ — там же
 * список). Условие теста НЕ переписывается под эти строки — они просто
 * не входят в проверяемый набор, как и просили.
 */
function testReliability_ciZeroIffFullCoverage_() {

  // n>N — ЯВНО ИСКЛЮЧЕНЫ (см. docstring выше), не проверяются здесь.
  const excludedAsBrokenHeadcount = [
    { n: 14, N: 1 }, { n: 5, N: 3 }, { n: 30, N: 29 }, { n: 18, N: 16 }, { n: 13, N: 12 }
  ];

  // n=1/N=1 НАРОЧНО не входит в батарею: правило "N ≤ 1 → без поправки"
  // (см. MathStats.finitePopulationCorrection) проверяется раньше
  // правила "n === N → 0" и имеет приоритет — при N=1 поправка не
  // применяется, даже если n тоже равен 1 (вырожденная популяция из
  // одного человека — не тот случай, для которого вводился FPC).
  // Отдельно проверено в testReliability_fpcRulesForUnknownAndDegenerateN_.
  const pairs = [
    { n: 418, N: 549 }, { n: 289, N: 356 }, { n: 33, N: 40 }, { n: 24, N: 25 },
    { n: 19, N: 21 }, { n: 16, N: 21 }, { n: 10, N: 10 }, { n: 9, N: 9 }, { n: 6, N: 6 },
    { n: 0, N: 5 }, { n: 5, N: 5 }
  ];

  pairs.forEach(pair => {

    // n=0 не даёт ДИ вообще (enpsConfidence возвращает margin=null),
    // это не то же самое, что "ДИ=0" — исключается отдельной проверкой.
    if (pair.n === 0) {
      const ci = MathStats.enpsConfidence(0, 0, pair.n, pair.N);
      assertReliabilityEquals_(ci.margin, null, "n=0: ДИ не считается (null), не 0");
      return;
    }

    const promoters = Math.ceil(pair.n / 2);
    const detractors = pair.n - promoters;
    const ci = MathStats.enpsConfidence(promoters, detractors, pair.n, pair.N);
    const fullCoverage = pair.n === pair.N;

    if (fullCoverage) {
      assertReliabilityEquals_(ci.margin, 0, "n=" + pair.n + "/N=" + pair.N + ": явка 100% ⇒ ДИ=0");
    } else {
      assertReliabilityTrue_(ci.margin > 0, "n=" + pair.n + "/N=" + pair.N + ": явка < 100% ⇒ ДИ>0 (не 0)");
    }

  });

  // Сами n>N строки: подтверждаем, что тест их сознательно не видит —
  // FPC для них не 0 (см. предыдущий тест), поэтому включать их в
  // цикл выше сломало бы свойство ⟺ вырожденным образом, если бы n=N
  // случайно совпало с "исправленным" N после правки справочника.
  assertReliabilityEquals_(excludedAsBrokenHeadcount.length, 5, "5 строк исключены явным списком, не условием теста");

}

/**
 * Сглаживание Лапласа (задача 2): все 4 ответившихся — промоутеры
 * (вырожденный случай, Var=0 БЕЗ сглаживания) — с FPC(4,16)≈0,894
 * (неполный охват) ДИ должен быть > 0, а не 0.
 * Реальный пример из методики: Отдел внедрения и обслуживания учетных
 * систем — 4 из 16, явка 25%, все промоутеры.
 */
function testReliability_laplaceAvoidsDegenerateVarianceForEnps_() {

  const ci = MathStats.enpsConfidence(4, 0, 4, 16);

  assertReliabilityEquals_(ci.enps, 100, "точечная оценка не меняется сглаживанием — все 4 промоутеры");
  assertReliabilityTrue_(ci.margin > 0, "ДИ > 0 несмотря на вырожденную (все-промоутеры) выборку");
  assertReliabilityTrue_(ci.margin < 100, "ДИ разумной ширины, не выходит за пределы шкалы eNPS");

}

/**
 * То же для доли (proportionConfidence) — вырожденный случай "все
 * ответившие в одной категории" (0% или 100%) не должен давать ДИ=0
 * при неполном охвате.
 */
function testReliability_laplaceAvoidsDegenerateVarianceForProportion_() {

  const allBad = MathStats.proportionConfidence(4, 4, 16);
  assertReliabilityEquals_(allBad.value, 100, "точечная доля не меняется сглаживанием");
  assertReliabilityTrue_(allBad.margin > 0, "ДИ > 0 при неполном охвате, даже если все 4 — «плохие»");

  const allGood = MathStats.proportionConfidence(0, 4, 16);
  assertReliabilityEquals_(allGood.value, 0, "точечная доля 0% не меняется сглаживанием");
  assertReliabilityTrue_(allGood.margin > 0, "ДИ > 0 при неполном охвате, даже если все 4 — «хорошие»");

}

/**
 * Точечная оценка (eNPS/доля) не зависит от populationSize — поправка
 * (FPC) касается только ширины интервала, не самого значения (задача 1:
 * "Точечная оценка eNPS считается по сырым долям и не меняется").
 */
function testReliability_pointEstimateUnaffectedByPopulationSize_() {

  const withoutN = MathStats.enpsConfidence(24, 3, 30);
  const withN = MathStats.enpsConfidence(24, 3, 30, 45);

  assertReliabilityEquals_(withoutN.enps, withN.enps, "точечный eNPS одинаков с FPC и без");
  assertReliabilityTrue_(withN.margin < withoutN.margin, "ДИ уже при известном (и не равном n) штате");

  const propWithoutN = MathStats.proportionConfidence(7, 30);
  const propWithN = MathStats.proportionConfidence(7, 30, 45);
  assertReliabilityEquals_(propWithoutN.value, propWithN.value, "точечная доля одинакова с FPC и без");

}

/**
 * zTestProportions — новая сигнатура (x1,n1,x2,n2,N1,N2), unpooled
 * SE_diff = sqrt(se1²+se2²) по задаче: "у каждого года своя N". Смоук-
 * тест: функция не падает, возвращает z, и результат при известных
 * (разных) N отличается от результата без них — поправка реально
 * входит в тест значимости, а не только в отображаемый ДИ.
 */
function testReliability_zTestProportionsAcceptsPerSideN_() {

  const withoutN = MathStats.zTestProportions(30, 289, 25, 300);
  const withN = MathStats.zTestProportions(30, 289, 25, 300, 356, 400);

  assertReliabilityTrue_(withoutN.z !== null, "z считается без N (обратная совместимость)");
  assertReliabilityTrue_(withN.z !== null, "z считается c N1/N2");
  assertReliabilityTrue_(Math.abs(withN.z) > Math.abs(withoutN.z),
    "с известным (не равным n) штатом |z| растёт — FPC сужает SE, увеличивает |z|");

}

/**
 * welchTest/welchTestFromStats — та же идея для средних: FPC на
 * каждую сторону, поправка входит в t, а не только в отображаемый ДИ
 * среднего.
 */
function testReliability_welchTestAcceptsPerSideN_() {

  const a = { mean: 4.5, variance: 0.6, n: 33 };
  const b = { mean: 4.1, variance: 0.7, n: 40 };

  const withoutN = MathStats.welchTestFromStats(a, b);
  const withN = MathStats.welchTestFromStats(a, b, 40, 45);

  assertReliabilityTrue_(withoutN.t !== null, "t считается без N");
  assertReliabilityTrue_(withN.t !== null, "t считается c N1/N2");
  assertReliabilityTrue_(Math.abs(withN.t) > Math.abs(withoutN.t),
    "с известным штатом |t| растёт — та же логика, что у zTestProportions");

}

/**
 * Norms.deviation — новое поле statisticallySignificant (задача 3):
 * пересечение скорректированных ДИ, отдельно от управленческого
 * порога (DEVIATION). Проверяем оба сценария: непересекающиеся ДИ
 * (значимо) и пересекающиеся, но с разницей выше управленческого
 * порога (не значимо статистически, хотя и превышает 15 пунктов).
 */
function testReliability_deviationCarriesStatisticalSignificance_() {

  const clearlyDifferent = Norms.deviation(80, 40, "enps", "eNPS", 5, 5);
  assertReliabilityTrue_(clearlyDifferent !== null, "разница 40 п. превышает управленческий порог (15)");
  assertReliabilityEquals_(clearlyDifferent.statisticallySignificant, true,
    "ДИ ±5 и ±5 при разнице 40 не пересекаются — статистически значимо");

  const overlapping = Norms.deviation(80, 60, "enps", "eNPS", 30, 30);
  assertReliabilityTrue_(overlapping !== null, "разница 20 п. превышает управленческий порог (15)");
  assertReliabilityEquals_(overlapping.statisticallySignificant, false,
    "ДИ ±30 и ±30 при разнице 20 пересекаются — управленческий порог превышен, но статистически неразличимо");

  const noMargins = Norms.deviation(80, 40, "enps", "eNPS");
  assertReliabilityEquals_(noMargins.statisticallySignificant, null,
    "без переданных margin — null (неизвестно), не false");

}

/**
 * Norms.reliabilityClass — 5 классов по ширине ДИ eNPS (задача 3):
 * границы 6/12/20, полный охват — отдельный класс независимо от ДИ.
 */
function testReliability_classByEnpsMarginWidth_() {

  assertReliabilityEquals_(Norms.reliabilityClass(0, true), Norms.RELIABILITY_CLASS.FULL_COVERAGE,
    "полный охват — свой класс, даже если ДИ=0 не передать как «точный»");
  assertReliabilityEquals_(Norms.reliabilityClass(5, false), Norms.RELIABILITY_CLASS.PRECISE, "ДИ=5 ≤ 6 → точная");
  assertReliabilityEquals_(Norms.reliabilityClass(6, false), Norms.RELIABILITY_CLASS.PRECISE, "ДИ=6 — граница включена в точную");
  assertReliabilityEquals_(Norms.reliabilityClass(6.1, false), Norms.RELIABILITY_CLASS.WORKING, "ДИ=6,1 → рабочая");
  assertReliabilityEquals_(Norms.reliabilityClass(12, false), Norms.RELIABILITY_CLASS.WORKING, "ДИ=12 — граница включена в рабочую");
  assertReliabilityEquals_(Norms.reliabilityClass(12.1, false), Norms.RELIABILITY_CLASS.ROUGH, "ДИ=12,1 → грубая");
  assertReliabilityEquals_(Norms.reliabilityClass(20, false), Norms.RELIABILITY_CLASS.ROUGH, "ДИ=20 — граница включена в грубую");
  assertReliabilityEquals_(Norms.reliabilityClass(20.1, false), Norms.RELIABILITY_CLASS.INDICATIVE, "ДИ=20,1 → ориентировочная");
  assertReliabilityEquals_(Norms.reliabilityClass(null, false), null, "ДИ не посчитан → класса нет");

}
