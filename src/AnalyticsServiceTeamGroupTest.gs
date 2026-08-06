/**
 * ==========================================================
 * Ручные тесты: срез "Группа команд" в AnalyticsService.build
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testAnalyticsServiceTeamGroup_runAll().
 * loadEnrichedSurveyData_ подменяется фикстурой (тот же прием, что и в
 * AnalyticsServicePerformanceTest.gs) — реальный SpreadsheetApp не нужен.
 */

function testAnalyticsServiceTeamGroup_runAll() {

  const tests = [
    testAnalyticsServiceTeamGroup_dimensionPresent_,
    testAnalyticsServiceTeamGroup_departmentWithoutTypeStaysInDepartmentDimension_,
    testAnalyticsServiceTeamGroup_headcountComesFromTeamGroup_
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

  console.log("Все тесты AnalyticsServiceTeamGroup пройдены.");

}

function assertASTGEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertASTGEquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

const ASTG_HEADERS_ = ["Фамилия Имя", "Отдел", "Формат работы", "Стаж", "Город", "eNPS"];

function astgRow_(name, department, enps) {
  return [name, department, "полностью из офиса", "от 1 года до 3х лет", "Москва", enps];
}

function astgHeadcountRows_() {
  return [
    { year: "2026", departmentId: "dept_service", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел сервис", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_no_type", division: "Управление разработки ПО", teamType: null, department: "Отдел без типа", count: 6, row: 3 }
  ];
}

function withASTGFixture_(fn) {

  const originalLoad = loadEnrichedSurveyData_;
  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;

  Headcount.rowsCache_ = astgHeadcountRows_();
  Headcount.directory_ = null;

  const rows2026 = [
    astgRow_("A", "Отдел сервис", "9"),
    astgRow_("B", "Отдел сервис", "8"),
    astgRow_("C", "Отдел без типа", "7")
  ];

  loadEnrichedSurveyData_ = function (source) {
    if (source === "2026") {
      return { source: "Ответы 2026", rows: rows2026.length, columns: ASTG_HEADERS_.length, headers: ASTG_HEADERS_, data: rows2026 };
    }
    throw new Error("Лист \"Ответы 2025\" не найден");
  };

  try {
    fn();
  } finally {
    loadEnrichedSurveyData_ = originalLoad;
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

}

function testAnalyticsServiceTeamGroup_dimensionPresent_() {

  withASTGFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);
    const dimensionTitles = analytics.segments.map(s => s.dimension);

    assertASTGEquals_(dimensionTitles.indexOf("Группа команд") !== -1, true, "срез \"Группа команд\" присутствует");

  });

}

function testAnalyticsServiceTeamGroup_departmentWithoutTypeStaysInDepartmentDimension_() {

  withASTGFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);

    const teamGroupDimension = analytics.segments.find(s => s.dimension === "Группа команд");
    const departmentDimension = analytics.segments.find(s => s.dimension === "Отдел");

    const teamGroupNames = teamGroupDimension.segments.map(s => s.name);
    const departmentNames = departmentDimension.segments.map(s => s.name);

    assertASTGEquals_(teamGroupNames.indexOf("Отдел без типа") !== -1, false,
      "отдел без типа команды не входит ни в одну группу команд");
    assertASTGEquals_(departmentNames.indexOf("Отдел без типа") !== -1, true,
      "тот же отдел остается в срезе \"Отдел\"");

  });

}

function testAnalyticsServiceTeamGroup_headcountComesFromTeamGroup_() {

  withASTGFixture_(() => {

    const analytics = AnalyticsService.build("2026", "2025", []);
    const teamGroupDimension = analytics.segments.find(s => s.dimension === "Группа команд");
    const segment = teamGroupDimension.segments.find(
      s => s.name === "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда"
    );

    assertASTGEquals_(!!segment, true, "группа найдена");
    assertASTGEquals_(segment.n, 2, "ответили двое");
    assertASTGEquals_(segment.headcount, 10, "численность группы взята из Headcount.forTeamGroup");
    assertASTGEquals_(segment.responseRatePercent, 20, "явка группы");

  });

}
