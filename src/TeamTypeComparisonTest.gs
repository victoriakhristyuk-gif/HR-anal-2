/**
 * ==========================================================
 * Ручные тесты: TeamTypeComparison (лист "Сервисные vs доменные")
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testTeamTypeComparison_runAll().
 * Чистый модуль — реальный лист/SpreadsheetApp не используется.
 */

function testTeamTypeComparison_runAll() {

  const tests = [
    testTeamTypeComparison_splitsRowsByGroupWithinDivision_,
    testTeamTypeComparison_excludesOtherDivisionServiceTeam_,
    testTeamTypeComparison_excludesDepartmentsWithoutTeamType_,
    testTeamTypeComparison_missingMetricStaysNullNotZero_,
    testTeamTypeComparison_ratingUsesWelchTest_,
    testTeamTypeComparison_shareUsesZTest_,
    testTeamTypeComparison_enpsUsesConfidenceIntervalComparison_,
    testTeamTypeComparison_noPreviousYearYieldsNullDeltaAndComment_,
    testTeamTypeComparison_passportCountsMatchGroups_,
    testTeamTypeComparison_higherIsBetterTrueForPositiveMetrics_,
    testTeamTypeComparison_higherIsBetterFalseForRiskMetrics_,
    testTeamTypeComparison_zeroGapCommentSaysNoDifference_,
    testTeamTypeComparison_significantGapCommentIsNeutralDirection_,
    testTeamTypeComparison_nonSignificantGapCommentIsNeutralDirection_,
    testTeamTypeComparison_riskMetricCommentUsesRiskWording_
  ];

  const failures = [];

  tests.forEach(test => {
    try {
      test();
      console.log("PASS: " + test.name);
    } catch (error) {
      failures.push(test.name + ": " + error.message);
      console.error("FAIL: " + test.name + " — " + error.message);
    } finally {
      Headcount.resetCache_();
    }
  });

  if (failures.length) {
    throw new Error(failures.length + " тест(ов) упало:\n" + failures.join("\n"));
  }

  console.log("Все тесты TeamTypeComparison пройдены.");

}

function assertTTCEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertTTCEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertTTCTrue_(value, message) {
  if (!value) throw new Error(message || "ожидалось true");
}

const TTC_HEADERS_ = ["Отдел", "ЗП", "Задачи", "Выгорание", "eNPS"];

function ttcRow_(department, salary, tasks, burnout, enps) {
  return [department, salary, tasks, burnout, enps];
}

function ttcQuestions_() {
  return [
    { title: "ЗП", type: "rating5", group: "Вознаграждение", subgroup: "Компенсация" },
    { title: "Задачи", type: "scale4", group: "Работа", subgroup: "Работа" },
    { title: "Выгорание", type: "scale5", group: "Риски", subgroup: "Благополучие" },
    { title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS" }
  ];
}

/**
 * Справочник численности: dept_service/dept_domain — внутри Управления
 * разработки ПО; dept_it_service — сервисная команда ДРУГОГО управления
 * (ИТ-управление), с тем же названием типа команды; dept_no_type — то
 * же управление, но без указанного типа команды.
 */
function ttcHeadcountRows_() {
  return [
    { year: "2026", departmentId: "dept_service", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел сервис", count: 20, row: 2 },
    { year: "2026", departmentId: "dept_domain", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел домен", count: 20, row: 3 },
    { year: "2026", departmentId: "dept_it_service", division: "ИТ-управление", teamType: "Сервисная команда", department: "Отдел ИТ сервис", count: 15, row: 4 },
    { year: "2026", departmentId: "dept_no_type", division: "Управление разработки ПО", teamType: null, department: "Отдел без типа", count: 8, row: 5 },
    { year: "2025", departmentId: "dept_service", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел сервис", count: 18, row: 6 },
    { year: "2025", departmentId: "dept_domain", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел домен", count: 18, row: 7 }
  ];
}

function withTTCHeadcount_(fn) {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = ttcHeadcountRows_();
  Headcount.directory_ = null;

  try {
    return fn();
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

function testTeamTypeComparison_splitsRowsByGroupWithinDivision_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел домен", "4", "да", "чувствовал редко", "8")
    ];

    const rowsA = TeamTypeComparison.rowsForGroup_(rows2026, TTC_HEADERS_, "2026", TeamTypeComparison.GROUP_A_LABEL);
    const rowsB = TeamTypeComparison.rowsForGroup_(rows2026, TTC_HEADERS_, "2026", TeamTypeComparison.GROUP_B_LABEL);

    assertTTCEquals_(rowsA.length, 1, "сервисная группа — 1 строка");
    assertTTCEquals_(rowsA[0][0], "Отдел сервис", "правильная строка в сервисной группе");
    assertTTCEquals_(rowsB.length, 1, "доменная группа — 1 строка");

  });

}

/**
 * Сервисная команда ИТ-управления (то же название типа) не должна
 * попадать в сравнение "Сервисные vs доменные" Управления разработки ПО.
 */
function testTeamTypeComparison_excludesOtherDivisionServiceTeam_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел ИТ сервис", "3", "нет", "чувствовал постоянно и чувствую сейчас", "1")
    ];

    const rowsA = TeamTypeComparison.rowsForGroup_(rows2026, TTC_HEADERS_, "2026", TeamTypeComparison.GROUP_A_LABEL);

    assertTTCEquals_(rowsA.length, 1, "сервисная команда ИТ-управления не входит в группу ПО");
    assertTTCEquals_(rowsA[0][0], "Отдел сервис", "осталась только сервисная команда Управления разработки ПО");

  });

}

function testTeamTypeComparison_excludesDepartmentsWithoutTeamType_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел без типа", "4", "да", "чувствовал редко", "7")
    ];

    const rowsA = TeamTypeComparison.rowsForGroup_(rows2026, TTC_HEADERS_, "2026", TeamTypeComparison.GROUP_A_LABEL);
    const rowsB = TeamTypeComparison.rowsForGroup_(rows2026, TTC_HEADERS_, "2026", TeamTypeComparison.GROUP_B_LABEL);

    assertTTCEquals_(rowsA.length, 1, "отдел без типа не входит в сервисную группу");
    assertTTCEquals_(rowsB.length, 0, "отдел без типа не входит и в доменную группу");

  });

}

/**
 * Если у одной из групп нет ответов на вопрос — значение null, а не 0,
 * и значимость гэпа тоже null (сравнение невозможно), а не false.
 */
function testTeamTypeComparison_missingMetricStaysNullNotZero_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9")
      // "Отдел домен" вообще не ответил — доменной группы 2026 в данных нет.
    ];

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const salaryRow = comparison.rows.find(r => r.question === "ЗП");

    assertTTCTrue_(!!salaryRow.a.current, "у сервисной группы значение есть");
    assertTTCEquals_(salaryRow.b.current, null, "у доменной группы значения нет — null, не 0");
    assertTTCEquals_(salaryRow.gapCurrent, null, "разрыв не считается, если данных одной стороны нет");
    assertTTCEquals_(salaryRow.gapSignificant, null, "значимость гэпа — null (не false), сравнивать не с чем");

  });

}

/**
 * rating5 ("ЗП") сравнивается t-критерием Уэлча — существенная разница
 * средних при достаточном n дает significant=true.
 */
function testTeamTypeComparison_ratingUsesWelchTest_() {

  withTTCHeadcount_(() => {

    // Одно отличающееся значение с каждой стороны — ненулевая дисперсия
    // внутри группы (Welch делит на дисперсию; полностью одинаковые
    // значения дали бы se=0 и неопределенный t, см. MathStats.welchTestFromStats).
    const rowsA2026 = new Array(29).fill(null).map(() => ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"))
      .concat([ttcRow_("Отдел сервис", "4", "да", "совсем не чувствовал", "9")]);
    const rowsB2026 = new Array(29).fill(null).map(() => ttcRow_("Отдел домен", "1", "да", "совсем не чувствовал", "9"))
      .concat([ttcRow_("Отдел домен", "2", "да", "совсем не чувствовал", "9")]);
    const rows2026 = rowsA2026.concat(rowsB2026);

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const salaryRow = comparison.rows.find(r => r.question === "ЗП");

    assertTTCEquals_(salaryRow.a.current.value, 4.97, "средняя сервисной группы");
    assertTTCEquals_(salaryRow.b.current.value, 1.03, "средняя доменной группы");
    assertTTCEquals_(salaryRow.gapCurrent, 3.94, "разрыв 2026 = разница округленных средних");
    assertTTCEquals_(salaryRow.gapSignificant, true, "большая устойчивая разница средних значима (Welch)");

  });

}

/**
 * scale4 ("Задачи") сравнивается z-критерием долей позитива.
 */
function testTeamTypeComparison_shareUsesZTest_() {

  withTTCHeadcount_(() => {

    const rowsA2026 = new Array(30).fill(null).map(() => ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"));
    const rowsB2026 = new Array(30).fill(null).map(() => ttcRow_("Отдел домен", "5", "нет", "совсем не чувствовал", "9"));
    const rows2026 = rowsA2026.concat(rowsB2026);

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const tasksRow = comparison.rows.find(r => r.question === "Задачи");

    assertTTCEquals_(tasksRow.a.current.value, 100, "100% позитива у сервисной группы");
    assertTTCEquals_(tasksRow.b.current.value, 0, "0% позитива у доменной группы");
    assertTTCEquals_(tasksRow.gapSignificant, true, "полностью разошедшиеся доли значимы (z-критерий)");

  });

}

/**
 * eNPS сравнивается через доверительные интервалы (enpsChangeIsReal),
 * не через z/t-критерий долей/средних.
 */
function testTeamTypeComparison_enpsUsesConfidenceIntervalComparison_() {

  withTTCHeadcount_(() => {

    const rowsA2026 = new Array(30).fill(null).map(() => ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "10"));
    const rowsB2026 = new Array(30).fill(null).map(() => ttcRow_("Отдел домен", "5", "да", "совсем не чувствовал", "1"));
    const rows2026 = rowsA2026.concat(rowsB2026);

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const enpsRow = comparison.rows.find(r => r.question === "eNPS");

    assertTTCEquals_(enpsRow.a.current.value, 100, "eNPS сервисной группы — все промоутеры");
    assertTTCEquals_(enpsRow.b.current.value, -100, "eNPS доменной группы — все критики");
    assertTTCEquals_(enpsRow.gapSignificant, true, "непересекающиеся ДИ eNPS — значимый разрыв");

  });

}

/**
 * Если данных 2025 нет вообще (rows2025 === null) — годовая динамика
 * обеих групп остается null, а не 0/false, и комментарий это называет
 * явно ("данных 2025 нет").
 */
function testTeamTypeComparison_noPreviousYearYieldsNullDeltaAndComment_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел домен", "4", "да", "чувствовал редко", "8")
    ];

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const salaryRow = comparison.rows.find(r => r.question === "ЗП");

    assertTTCEquals_(salaryRow.a.previous, null, "нет прошлогодних данных сервисной группы");
    assertTTCEquals_(salaryRow.a.delta, null, "дельта не считается без прошлого года");
    assertTTCEquals_(salaryRow.a.significant, null, "значимость динамики — null, сравнивать не с чем");
    assertTTCTrue_(salaryRow.comment.indexOf("данных 2025 нет") !== -1, "комментарий явно называет отсутствие данных 2025");

  });

}

function testTeamTypeComparison_passportCountsMatchGroups_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел сервис", "4", "да", "чувствовал редко", "8"),
      ttcRow_("Отдел домен", "3", "нет", "чувствовал регулярно", "5")
    ];
    const rows2025 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9")
    ];

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, rows2025, TTC_HEADERS_, ttcQuestions_());

    assertTTCEquals_(comparison.passport.a.n2026, 2, "n сервисной группы 2026");
    assertTTCEquals_(comparison.passport.a.n2025, 1, "n сервисной группы 2025");
    assertTTCEquals_(comparison.passport.a.invited2026, 20, "приглашено сервисной группы 2026 (по Headcount)");
    assertTTCEquals_(comparison.passport.a.invited2025, 18, "приглашено сервисной группы 2025 (по Headcount)");
    assertTTCEquals_(comparison.passport.b.n2026, 1, "n доменной группы 2026");
    assertTTCEquals_(comparison.division, "Управление разработки ПО", "паспорт — Управление разработки ПО");

  });

}

/**
 * Строка сравнения в форме compareQuestion_ — для точечных тестов
 * comment_/направления, без пересчёта реальной статистики.
 */
function ttcCommentRowFixture_(overrides) {
  const base = {
    question: "ЗП", group: "Вознаграждение", subgroup: "Компенсация", unit: "балла",
    scaleKey: "rating5", higherIsBetter: true, hasPrevious: false,
    a: { current: { value: 5, n: 30 }, previous: null, delta: null, significant: null },
    b: { current: { value: 3, n: 30 }, previous: null, delta: null, significant: null },
    gapCurrent: 2, gapSignificant: true
  };
  return Object.assign({}, base, overrides || {});
}

/**
 * Позитивные метрики (eNPS, rating5, обычные scale4) — higherIsBetter
 * должно быть true: рост значения — это улучшение (см. Norms.THRESHOLDS).
 */
function testTeamTypeComparison_higherIsBetterTrueForPositiveMetrics_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "совсем не чувствовал", "9"),
      ttcRow_("Отдел домен", "4", "да", "чувствовал редко", "8")
    ];

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());

    ["ЗП", "Задачи", "eNPS"].forEach(title => {
      const row = comparison.rows.find(r => r.question === title);
      assertTTCEquals_(row.higherIsBetter, true, title + ": higherIsBetter=true (позитивная метрика)");
    });

  });

}

/**
 * Риск-метрики (выгорание, смена работы) — higherIsBetter должно быть
 * false: рост доли риска — это ухудшение, а не улучшение.
 */
function testTeamTypeComparison_higherIsBetterFalseForRiskMetrics_() {

  withTTCHeadcount_(() => {

    const rows2026 = [
      ttcRow_("Отдел сервис", "5", "да", "чувствовал постоянно и чувствую сейчас", "9"),
      ttcRow_("Отдел домен", "4", "да", "чувствовал регулярно", "8")
    ];

    const comparison = TeamTypeComparison.build(rows2026, TTC_HEADERS_, null, null, ttcQuestions_());
    const row = comparison.rows.find(r => r.question === "Выгорание");

    assertTTCEquals_(row.scaleKey, "burnoutRisk", "распознана риск-метрика");
    assertTTCEquals_(row.higherIsBetter, false, "выгорание: higherIsBetter=false (риск-метрика)");

  });

}

/**
 * Значения групп равны — комментарий должен прямо говорить об
 * отсутствии различия, а не "разница есть в цифрах, но не подтверждена".
 */
function testTeamTypeComparison_zeroGapCommentSaysNoDifference_() {

  const row = ttcCommentRowFixture_({
    a: { current: { value: 4, n: 30 }, previous: null, delta: null, significant: null },
    b: { current: { value: 4, n: 30 }, previous: null, delta: null, significant: null },
    gapCurrent: 0, gapSignificant: false
  });

  const comment = TeamTypeComparison.comment_(row);

  assertTTCTrue_(comment.indexOf("Различий между группами в 2026 нет") !== -1,
    "комментарий явно говорит об отсутствии различия: " + comment);
  assertTTCEquals_(comment.indexOf("есть в цифрах"), -1, "старая формулировка про \"разница есть в цифрах\" не используется при равенстве");

}

/**
 * Значимый разрыв позитивной метрики — комментарий нейтрален
 * ("Сервисные команды выше/ниже доменной разработки"), без "лучше"/
 * "хуже": оценку несёт только цвет ячейки (AnalyticsWriter), не текст.
 */
function testTeamTypeComparison_significantGapCommentIsNeutralDirection_() {

  const rowHigher = ttcCommentRowFixture_({ gapCurrent: 2, gapSignificant: true });
  const commentHigher = TeamTypeComparison.comment_(rowHigher);

  assertTTCTrue_(commentHigher.indexOf("Сервисные команды выше доменной разработки") !== -1,
    "разрыв положительный — \"выше\": " + commentHigher);
  assertTTCEquals_(/лучше|хуже/i.test(commentHigher), false, "комментарий не называет разницу \"лучше\"/\"хуже\"");

  const rowLower = ttcCommentRowFixture_({ gapCurrent: -2, gapSignificant: true });
  const commentLower = TeamTypeComparison.comment_(rowLower);

  assertTTCTrue_(commentLower.indexOf("Сервисные команды ниже доменной разработки") !== -1,
    "разрыв отрицательный — \"ниже\", не автоматически \"плохо\": " + commentLower);
  assertTTCEquals_(/лучше|хуже/i.test(commentLower), false, "комментарий не называет разницу \"лучше\"/\"хуже\"");

}

/**
 * Незначимый разрыв — та же нейтральная формулировка направления, с
 * явной пометкой, что статистика не подтвердила разницу.
 */
function testTeamTypeComparison_nonSignificantGapCommentIsNeutralDirection_() {

  const row = ttcCommentRowFixture_({ gapCurrent: 1, gapSignificant: false });
  const comment = TeamTypeComparison.comment_(row);

  assertTTCTrue_(comment.indexOf("Сервисные команды выше доменной разработки") !== -1, "направление указано: " + comment);
  assertTTCTrue_(comment.indexOf("статистически не подтверждено") !== -1, "явно указано, что не подтверждено: " + comment);

}

/**
 * Риск-метрика со значимым разрывом — формулировка "уровень риска
 * выше/ниже", а не "Сервисные команды выше/ниже".
 */
function testTeamTypeComparison_riskMetricCommentUsesRiskWording_() {

  const rowHigherRisk = ttcCommentRowFixture_({
    question: "Выгорание", scaleKey: "burnoutRisk", higherIsBetter: false,
    gapCurrent: 5, gapSignificant: true
  });
  const commentHigherRisk = TeamTypeComparison.comment_(rowHigherRisk);

  assertTTCTrue_(commentHigherRisk.indexOf("Уровень риска выше") !== -1,
    "риск-метрика использует формулировку про уровень риска: " + commentHigherRisk);
  assertTTCEquals_(commentHigherRisk.indexOf("Сервисные команды выше"), -1,
    "риск-метрика не использует формулировку обычной метрики");

  const rowLowerRisk = ttcCommentRowFixture_({
    question: "Смена работы", scaleKey: "leaveRisk", higherIsBetter: false,
    gapCurrent: -5, gapSignificant: true
  });
  const commentLowerRisk = TeamTypeComparison.comment_(rowLowerRisk);

  assertTTCTrue_(commentLowerRisk.indexOf("Уровень риска ниже") !== -1,
    "риск-метрика, отрицательный разрыв: " + commentLowerRisk);

}
