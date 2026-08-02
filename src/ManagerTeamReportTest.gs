/**
 * ==========================================================
 * Ручные тесты отчета "Руководитель и команда"
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testManagerTeamReport_runAll().
 *
 * ManagerTeamReport.build — чистая функция над уже прочитанными
 * headers/rows источника "Ответы 2026" и разобранным справочником
 * "перформанс" (форма PerformanceDirectory.parse_/load — {departments: {...}}),
 * никаких обращений к SpreadsheetApp — тестируется на литеральных
 * фикстурах.
 */

function testManagerTeamReport_runAll() {

  const tests = [
    testManagerTeamReport_departmentWithoutManagerIsSkipped_,
    testManagerTeamReport_departmentWithExactlyOneManagerIsAnalyzed_,
    testManagerTeamReport_departmentWithMultipleManagersIsError_,
    testManagerTeamReport_teamMembersMissingFromDirectoryStillCountInTeam_,
    testManagerTeamReport_splitsManagerFromTeam_,
    testManagerTeamReport_managerDidNotAnswer_,
    testManagerTeamReport_teamSizeN0_,
    testManagerTeamReport_teamSizeN1_,
    testManagerTeamReport_teamSizeN2_,
    testManagerTeamReport_teamSizeN3_,
    testManagerTeamReport_teamSizeN4_,
    testManagerTeamReport_teamSizeN5_,
    testManagerTeamReport_managerSingleResultHasNoSignificanceFields_,
    testManagerTeamReport_managerSingleResultExcludedFromSegmentsPipeline_,
    testManagerTeamReport_prepareDoesNotThrowOnMissingOrMultipleManagers_,
    testManagerTeamReport_prepareSucceedsWithExactlyOneManager_,
    testManagerTeamReport_writeUsesBatchSetBackgrounds_,
    testManagerTeamReport_sameAnswersInterpretedAsMatch_,
    testManagerTeamReport_managerMuchHigherIsBlindSpot_,
    testManagerTeamReport_managerMuchLowerIsMoreCritical_,
    testManagerTeamReport_bothLowIsSharedConcern_,
    testManagerTeamReport_smallTeamIsInsufficientData_,
    testManagerTeamReport_diffFormulaUnchanged_,
    testManagerTeamReport_answerLabelPicksNearestMapCategory_,
    testManagerTeamReport_answerLabelForRating5UsesRoundedScore_,
    testManagerTeamReport_burnoutValidAnswerShowsTextLevelAndComparison_,
    testManagerTeamReport_burnoutUncertainAnswerIsNotTreatedAsSkipped_,
    testManagerTeamReport_burnoutEmptyCellIsSkippedQuestion_,
    testManagerTeamReport_burnoutUnrecognizedTextIsFlagged_,
    testManagerTeamReport_burnoutFixDoesNotAffectOtherQuestions_,
    testManagerTeamReport_notUsedAnswerGetsOwnStatus_
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

  console.log("Все тесты ManagerTeamReport пройдены.");

}

function assertMTREquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertMTREquals") +
      ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

function assertMTRTrue_(value, message) {
  if (!value) throw new Error(message || "ожидалось true");
}

// ==========================================================
// Фикстуры
// ==========================================================

const MTR_HEADERS_ = ["Фамилия Имя", "Отдел", "ЗП", "eNPS"];

function mtrQuestionCatalogueHasZpAndEnps_() {
  // ЗП (rating5) и eNPS входят в Questions.catalogue с report:true —
  // фикстура использует реальные названия вопросов, чтобы
  // Questions.getAll()/Scoring.vector нашли нужные колонки без подмены
  // каталога.
  return true;
}

function mtrRow_(name, department, zp, enps) {
  return [name, department, zp, enps];
}

/**
 * Отдел с руководителем и командой из 5 человек (>= MIN_TEAM_SIZE),
 * все респонденты — сами ответы 2026, без обращения к справочнику.
 */
function mtrRowsFullTeam_(department) {
  department = department || "Отдел разработки сайтов";
  return [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "4", "8"),
    mtrRow_("Сотрудник 2", department, "4", "8"),
    mtrRow_("Сотрудник 3", department, "3", "7"),
    mtrRow_("Сотрудник 4", department, "3", "7"),
    mtrRow_("Сотрудник 5", department, "5", "9")
  ];
}

/**
 * Литеральный справочник в форме PerformanceDirectory.parse_/load —
 * {departments: {normalizedDept: {department, managers: [{name, row}]}}}.
 * build() консультируется только с этой структурой (не с byKey) —
 * отдельная строка сотрудника в справочнике для команды не нужна.
 */
function mtrDirectory_(departmentToManagerNames) {

  const departments = {};

  Object.keys(departmentToManagerNames).forEach(department => {
    const key = PerformanceDirectory.normalizeText_(department);
    departments[key] = {
      department: department,
      managers: departmentToManagerNames[department].map((name, i) => ({ name: name, row: i + 2 }))
    };
  });

  return { departments: departments };

}

// ==========================================================
// Новые правила по количеству отмеченных руководителей в отделе
// ==========================================================

/**
 * Ни одного отмеченного руководителя в справочнике "перформанс" —
 * отдел молча пропускается (это не ошибка).
 */
function testManagerTeamReport_departmentWithoutManagerIsSkipped_() {

  const rows = mtrRowsFullTeam_("Отдел без руководителя");
  const directory = mtrDirectory_({ "Отдел без руководителя": [] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);

  assertMTREquals_(results.length, 0, "отдел без отмеченного руководителя не попадает в результат");

}

/**
 * Ровно один отмеченный руководитель — отдел анализируется, команда —
 * все респонденты отдела кроме руководителя.
 */
function testManagerTeamReport_departmentWithExactlyOneManagerIsAnalyzed_() {

  const rows = mtrRowsFullTeam_("Отдел с одним руководителем");
  const directory = mtrDirectory_({ "Отдел с одним руководителем": ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);

  assertMTREquals_(results.length, 1, "один отдел в результате");
  assertMTREquals_(results[0].error, undefined, "нет ошибки — ровно один руководитель");
  assertMTREquals_(results[0].managerAnswered, true, "руководитель ответил");
  assertMTREquals_(results[0].teamSize, 5, "команда — все респонденты кроме руководителя");

}

/**
 * Несколько отмеченных руководителей в одном отделе — отдел попадает в
 * отчет как ошибка со списком отдела и отмеченных руководителей, без
 * количественного анализа.
 */
function testManagerTeamReport_departmentWithMultipleManagersIsError_() {

  const rows = mtrRowsFullTeam_("Отдел с двумя руководителями");
  const directory = mtrDirectory_({
    "Отдел с двумя руководителями": ["Руководитель Один", "Руководитель Два"]
  });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);

  assertMTREquals_(results.length, 1, "отдел присутствует в результате как ошибка");
  assertMTREquals_(results[0].department, "Отдел с двумя руководителями", "отдел назван верно");
  assertMTREquals_(results[0].error, ManagerTeamReport.STATUS.MULTIPLE_MANAGERS, "статус ошибки — несколько руководителей");
  assertMTREquals_(results[0].managerNames.length, 2, "перечислены оба отмеченных руководителя");
  assertMTRTrue_(results[0].managerNames.indexOf("Руководитель Один") !== -1, "назван первый руководитель");
  assertMTRTrue_(results[0].managerNames.indexOf("Руководитель Два") !== -1, "назван второй руководитель");
  assertMTREquals_(results[0].questions, undefined, "по отделу-ошибке анализ не считается");

}

/**
 * Сотрудники команды, отсутствующие в справочнике "перформанс"
 * (директория содержит запись только для руководителя), все равно
 * полностью учитываются как команда — отдельная строка в справочнике
 * для этого не требуется и не блокирует отчет.
 */
function testManagerTeamReport_teamMembersMissingFromDirectoryStillCountInTeam_() {

  const department = "Отдел с отсутствующими в справочнике";
  const rows = mtrRowsFullTeam_(department);

  // В directory нет ни одной записи byKey вообще — только пометка
  // руководителя отдела, что и требуется build() для идентификации.
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);

  assertMTREquals_(results.length, 1, "отдел анализируется");
  assertMTREquals_(results[0].teamSize, 5, "все 5 сотрудников команды учтены, хотя их нет в справочнике");

  const zpRow = results[0].questions.find(q => q.question === "ЗП");
  assertMTREquals_(zpRow.teamN, 5, "n сотрудников по вопросу не уменьшилось из-за отсутствия в справочнике");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.OK, "команда полная — статус \"достаточно данных\"");

}

function testManagerTeamReport_splitsManagerFromTeam_() {

  const rows = mtrRowsFullTeam_();
  const directory = mtrDirectory_({ "Отдел разработки сайтов": ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);

  assertMTREquals_(results.length, 1, "один отдел в результате");

  const department = results[0];

  assertMTREquals_(department.department, "Отдел разработки сайтов", "название отдела сохранено");
  assertMTREquals_(department.managerAnswered, true, "руководитель ответил");
  assertMTREquals_(department.teamSize, 5, "размер команды — 5 сотрудников");

  const zpRow = department.questions.find(q => q.question === "ЗП");

  assertMTRTrue_(zpRow.managerLevel !== null, "уровень руководителя по ЗП рассчитан");
  assertMTRTrue_(zpRow.teamLevel !== null, "команда >= 5 — средний уровень рассчитан");
  assertMTREquals_(zpRow.teamN, 5, "n сотрудников = 5");
  assertMTRTrue_(zpRow.diff !== null, "разница рассчитана");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.OK, "статус \"достаточно данных\"");

}

/**
 * Отдел, где отмеченный руководитель не участвовал в опросе — его ФИО
 * не встречается среди респондентов "Ответы 2026" этого отдела.
 * Сохраняется статус "руководитель не ответил", команда при этом
 * считается по всем респондентам отдела (никого не исключать не из
 * кого).
 */
function testManagerTeamReport_managerDidNotAnswer_() {

  const rows = mtrRowsFullTeam_().filter(row => row[0] !== "Руководитель Один");
  const directory = mtrDirectory_({ "Отдел разработки сайтов": ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const department = results[0];

  assertMTREquals_(department.managerAnswered, false, "руководитель не ответил");
  assertMTREquals_(department.teamSize, 5, "команда — все оставшиеся респонденты отдела");

  department.questions.forEach(q => {
    assertMTREquals_(q.status, ManagerTeamReport.STATUS.MANAGER_DID_NOT_ANSWER,
      "статус \"руководитель не ответил\" для вопроса " + q.question);
    assertMTREquals_(q.managerLevel, null, "оценка руководителя пуста");
  });

}

/**
 * Команда отвечает ("ЗП" заполнена у всех троих), но именно на этот
 * вопрос никто из команды не ответил (n=0 для вопроса "ЗП", хотя
 * teamSize отдела — 3) — n считается отдельно по каждому вопросу, а не
 * равен размеру команды отдела. Средняя/разница не считаются (нечего
 * усреднять), статус "нет ответов команды".
 */
function testManagerTeamReport_teamSizeN0_() {

  const department = "Отдел n=0";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "", "8"),
    mtrRow_("Сотрудник 2", department, "", "8"),
    mtrRow_("Сотрудник 3", department, "", "8")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const dept = results[0];

  assertMTREquals_(dept.teamSize, 3, "в команде отдела 3 человека");

  const zpRow = dept.questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 0, "никто из команды не ответил именно на «ЗП»");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.NO_TEAM_ANSWERS, "статус — нет ответов команды");
  assertMTREquals_(zpRow.teamLevel, null, "средняя не считается — нечего усреднять");
  assertMTREquals_(zpRow.diff, null, "разница не считается");
  assertMTREquals_(zpRow.teamText, null, "текстовая интерпретация команды отсутствует");
  assertMTRTrue_(zpRow.managerLevel !== null, "оценка руководителя при этом доступна");

}

/**
 * n=1 — маленькая команда больше не исключается: средняя и разница
 * считаются, но статус явно предупреждает "очень мало данных" (и,
 * содержательно, средняя команды здесь буквально равна ответу этого
 * одного сотрудника — отсюда требование об ограниченном доступе к
 * листу, см. write()).
 */
function testManagerTeamReport_teamSizeN1_() {

  const department = "Отдел n=1";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "3", "7")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 1, "команда — 1 ответивший");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.VERY_LOW_TEAM, "статус — очень мало данных");
  assertMTREquals_(zpRow.teamLevel, MathStats.round(Norms.normalizeLevel(3, 1, 5), 1),
    "средняя команды равна ответу единственного сотрудника");
  assertMTRTrue_(zpRow.diff !== null, "разница считается даже при n=1");
  assertMTRTrue_(zpRow.teamText !== null, "текстовая интерпретация команды доступна");

}

function testManagerTeamReport_teamSizeN2_() {

  const department = "Отдел n=2";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "3", "7"),
    mtrRow_("Сотрудник 2", department, "4", "8")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 2, "команда — 2 ответивших");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.VERY_LOW_TEAM, "n=2 — верхняя граница «очень мало данных»");
  assertMTRTrue_(zpRow.teamLevel !== null, "средняя считается");
  assertMTRTrue_(zpRow.diff !== null, "разница считается");

}

function testManagerTeamReport_teamSizeN3_() {

  const department = "Отдел n=3";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "3", "7"),
    mtrRow_("Сотрудник 2", department, "4", "8"),
    mtrRow_("Сотрудник 3", department, "4", "8")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 3, "команда — 3 ответивших");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.LOW_TEAM, "n=3 — нижняя граница «мало данных»");
  assertMTRTrue_(zpRow.teamLevel !== null, "средняя считается");
  assertMTRTrue_(zpRow.diff !== null, "разница считается");

}

function testManagerTeamReport_teamSizeN4_() {

  const department = "Отдел n=4";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "3", "7"),
    mtrRow_("Сотрудник 2", department, "4", "8"),
    mtrRow_("Сотрудник 3", department, "4", "8"),
    mtrRow_("Сотрудник 4", department, "3", "7")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 4, "команда — 4 ответивших");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.LOW_TEAM, "n=4 — верхняя граница «мало данных»");
  assertMTRTrue_(zpRow.teamLevel !== null, "средняя считается");
  assertMTRTrue_(zpRow.diff !== null, "разница считается");

}

function testManagerTeamReport_teamSizeN5_() {

  assertMTREquals_(ManagerTeamReport.MIN_TEAM_SIZE, 5, "порог полной надежности заявлен методикой задачи как 5");

  const rows = mtrRowsFullTeam_(); // ровно 5 сотрудников команды
  const directory = mtrDirectory_({ "Отдел разработки сайтов": ["Руководитель Один"] });
  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.teamN, 5, "команда — 5 ответивших");
  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.OK, "n=5 — уже достаточно данных");

}

/**
 * Результат одного руководителя (n=1) — конкретный человек, не
 * статистическая группа: у него нет ни доверительного интервала, ни
 * значимости, ни отклонений/подтверждений (Segments.analyze этого
 * модуля вообще не касается — см. следующий тест).
 */
function testManagerTeamReport_managerSingleResultHasNoSignificanceFields_() {

  const directory = mtrDirectory_({ "Отдел разработки сайтов": ["Руководитель Один"] });
  const results = ManagerTeamReport.build(MTR_HEADERS_, mtrRowsFullTeam_(), directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  const forbiddenKeys = ["significant", "z", "t", "margin", "confirmed", "deviations", "fragile"];

  forbiddenKeys.forEach(key => {
    assertMTREquals_(zpRow.hasOwnProperty(key), false,
      "результат руководителя не должен содержать статистическое поле \"" + key + "\"");
  });

}

/**
 * ManagerTeamReport — самостоятельный модуль: он не вызывает
 * Segments.analyze и не участвует в AnalyticsService.findings(), а
 * значит результат одного руководителя (n=1) физически не может
 * попасть в автоматические проблемные выводы, даже при экстремальных
 * оценках.
 */
function testManagerTeamReport_managerSingleResultExcludedFromSegmentsPipeline_() {

  const rows = [
    mtrRow_("Руководитель Один", "Отдел с плохим руководителем", "1", "0"), // экстремально низкие оценки
    mtrRow_("Сотрудник 1", "Отдел с плохим руководителем", "5", "10"),
    mtrRow_("Сотрудник 2", "Отдел с плохим руководителем", "5", "10"),
    mtrRow_("Сотрудник 3", "Отдел с плохим руководителем", "5", "10"),
    mtrRow_("Сотрудник 4", "Отдел с плохим руководителем", "5", "10"),
    mtrRow_("Сотрудник 5", "Отдел с плохим руководителем", "5", "10")
  ];
  const directory = mtrDirectory_({ "Отдел с плохим руководителем": ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  // Разница огромная (руководитель 0, команда 100 по уровню 0-100),
  // но это не "confirmed"-срез — таких полей в структуре нет вообще
  // (см. предыдущий тест), а сам ManagerTeamReport никогда не
  // передает свои данные в Segments.analyze/AnalyticsService.findings.
  assertMTRTrue_(Math.abs(zpRow.diff) > 50, "разница действительно большая (для проверки, что это не тривиальный случай)");
  assertMTREquals_(zpRow.hasOwnProperty("confirmed"), false, "нет поля confirmed — не проходит через Segments.analyze");

}

// ==========================================================
// prepare_ — сборка справочника "перформанс" + "Ответы 2026" без
// блокировки отчета целиком
// ==========================================================
//
// В отличие от прежней prepareStrict_, prepare_ больше не бросает
// исключение из-за отделов без руководителя/с несколькими
// руководителями (это разбирается для каждого отдела отдельно внутри
// build) и не требует успешного join с "перформанс" для каждого
// сотрудника. Тесты подменяют PerformanceDirectory.load и глобальную
// loadSurveyData (тот же прием, что и в PerformanceDirectoryTest.gs),
// чтобы не требовать реального SpreadsheetApp.

const MTR_STRICT_PERF_HEADERS_ = ["Фамилия Имя", "Город", "Отдел", "Соответствие ожиданиям", "Грейд", "Руководитель отдела"];
const MTR_STRICT_SURVEY_HEADERS_ = ["Фамилия Имя", "Отдел", "ЗП", "eNPS"];

function mtrStrictSurveyRows_() {
  return [
    ["Руководитель Один", "Отдел разработки сайтов", "5", "10"],
    ["Сотрудник 1", "Отдел разработки сайтов", "4", "8"],
    ["Сотрудник 2", "Отдел разработки сайтов", "4", "8"],
    ["Сотрудник 3", "Отдел разработки сайтов", "3", "7"],
    ["Сотрудник 4", "Отдел разработки сайтов", "3", "7"],
    ["Сотрудник 5", "Отдел разработки сайтов", "5", "9"]
  ];
}

function withMockedManagerTeamDeps_(perfRows, surveyHeaders, surveyRows, fn) {

  const originalDirectoryLoad = PerformanceDirectory.load;
  const originalLoadSurveyData = loadSurveyData;

  PerformanceDirectory.load = function () {
    return PerformanceDirectory.parse_(MTR_STRICT_PERF_HEADERS_, perfRows);
  };

  loadSurveyData = function () {
    return { source: "2026", rows: surveyRows.length, columns: surveyHeaders.length, headers: surveyHeaders, data: surveyRows };
  };

  try {
    fn();
  } finally {
    PerformanceDirectory.load = originalDirectoryLoad;
    loadSurveyData = originalLoadSurveyData;
  }

}

/**
 * Справочник с отделом без руководителя, отделом с несколькими
 * руководителями и сотрудником, не найденным в справочнике вовсе —
 * prepare_() не бросает исключение ни по одной из этих причин, а
 * build() над её результатом корректно пропускает/помечает ошибкой
 * нужные отделы и все равно считает отсутствующего в справочнике
 * сотрудника как часть команды.
 */
function testManagerTeamReport_prepareDoesNotThrowOnMissingOrMultipleManagers_() {

  const perfRows = [
    ["Руководитель Один", "", "Отдел А", "Соответствует", "middle", false], // "Отдел А" — руководитель не указан
    ["Руководитель Б1", "", "Отдел Б", "Соответствует", "middle", true],
    ["Руководитель Б2", "", "Отдел Б", "Соответствует", "middle", true] // "Отдел Б" — несколько руководителей
  ];

  const surveyHeaders = MTR_STRICT_SURVEY_HEADERS_;
  const surveyRows = [
    ["Руководитель Один", "Отдел А", "5", "10"],
    ["Руководитель Б1", "Отдел Б", "5", "10"],
    ["Руководитель Б2", "Отдел Б", "4", "9"],
    ["Сотрудник не из справочника", "Отдел Б", "4", "8"]
  ];

  withMockedManagerTeamDeps_(perfRows, surveyHeaders, surveyRows, () => {

    let threw = false;

    let prepared;
    try {
      prepared = ManagerTeamReport.prepare_();
    } catch (error) {
      threw = true;
    }

    assertMTRTrue_(!threw, "prepare_ не бросает исключение из-за отделов без/с несколькими руководителями");

    const results = ManagerTeamReport.build(prepared.headers, prepared.data, prepared.directory);

    assertMTREquals_(results.length, 1, "\"Отдел А\" пропущен (нет руководителя), \"Отдел Б\" — ошибка");
    assertMTREquals_(results[0].department, "Отдел Б", "в результате остался только \"Отдел Б\"");
    assertMTREquals_(results[0].error, ManagerTeamReport.STATUS.MULTIPLE_MANAGERS, "\"Отдел Б\" — ошибка несколько руководителей");

  });

}

function testManagerTeamReport_prepareSucceedsWithExactlyOneManager_() {

  const perfRows = [
    ["Руководитель Один", "", "Отдел разработки сайтов", "Соответствует", "lead", true],
    ["Сотрудник 1", "", "Отдел разработки сайтов", "Соответствует", "middle", false],
    ["Сотрудник 2", "", "Отдел разработки сайтов", "Соответствует", "middle", false],
    ["Сотрудник 3", "", "Отдел разработки сайтов", "Соответствует", "middle", false],
    ["Сотрудник 4", "", "Отдел разработки сайтов", "Соответствует", "middle", false],
    ["Сотрудник 5", "", "Отдел разработки сайтов", "Соответствует", "middle", false]
  ];

  withMockedManagerTeamDeps_(perfRows, MTR_STRICT_SURVEY_HEADERS_, mtrStrictSurveyRows_(), () => {

    const prepared = ManagerTeamReport.prepare_();
    const results = ManagerTeamReport.build(prepared.headers, prepared.data, prepared.directory);

    assertMTREquals_(results.length, 1, "один отдел в результате");
    assertMTREquals_(results[0].error, undefined, "без ошибки — ровно один руководитель");
    assertMTREquals_(results[0].managerAnswered, true, "руководитель ответил");
    assertMTREquals_(results[0].teamSize, 5, "команда — 5 сотрудников");

  });

}

// ==========================================================
// write() — пакетное форматирование статусов
// ==========================================================

/**
 * Раскраска колонки "Статус надёжности" должна выполняться одним
 * вызовом setBackgrounds() на весь диапазон, а не getRange().
 * setBackground() построчно в цикле.
 */
function testManagerTeamReport_writeUsesBatchSetBackgrounds_() {

  const perfRows = [
    ["Руководитель Один", "", "Отдел разработки сайтов", "Соответствует", "lead", true],
    ["Сотрудник 1", "", "Отдел разработки сайтов", "Соответствует", "middle", false],
    ["Сотрудник 2", "", "Отдел разработки сайтов", "Соответствует", "middle", false]
  ];

  const surveyRows = [
    ["Руководитель Один", "Отдел разработки сайтов", "5", "10"],
    ["Сотрудник 1", "Отдел разработки сайтов", "4", "8"],
    ["Сотрудник 2", "Отдел разработки сайтов", "4", "8"]
  ];

  const originalSheetFn = AnalyticsWriter.sheet_;
  const originalWriteSheetIntro = Formatter.writeSheetIntro;
  const originalDump = AnalyticsWriter.dump_;

  const calls = { setBackground: 0, setBackgrounds: 0, backgroundsArg: null };

  // fakeRange поддерживает fluent-цепочки, которые write() вызывает для
  // заголовка блока-обзора (setValue/setFontWeight/setFontSize/
  // mergeAcross) и самого блока (setValues) — тест интересуется только
  // тем, что раскраска статуса идет одним setBackgrounds(), а не
  // построчным setBackground().
  const fakeRange = {
    setBackground() { calls.setBackground++; return fakeRange; },
    setBackgrounds(values) { calls.setBackgrounds++; calls.backgroundsArg = values; return fakeRange; },
    setValue() { return fakeRange; },
    setValues() { return fakeRange; },
    setFontWeight() { return fakeRange; },
    setFontSize() { return fakeRange; },
    setFontColor() { return fakeRange; },
    setVerticalAlignment() { return fakeRange; },
    setWrap() { return fakeRange; },
    mergeAcross() { return fakeRange; }
  };

  const fakeSheet = {
    getRange() { return fakeRange; },
    setHiddenGridlines() {},
    hideColumns() {},
    setColumnWidth() {},
    setRowHeight() {},
    setFrozenRows() {}
  };

  AnalyticsWriter.sheet_ = function () { return fakeSheet; };
  Formatter.writeSheetIntro = function () { return 1; };
  AnalyticsWriter.dump_ = function (sheet, header, rows) { return rows.length; };

  try {

    withMockedManagerTeamDeps_(perfRows, MTR_STRICT_SURVEY_HEADERS_, surveyRows, () => {
      ManagerTeamReport.write();
    });

    assertMTREquals_(calls.setBackground, 0, "построчный setBackground() не используется");
    assertMTREquals_(calls.setBackgrounds, 1, "setBackgrounds() вызван ровно один раз (пакетно)");
    assertMTRTrue_(Array.isArray(calls.backgroundsArg), "аргумент setBackgrounds — массив цветов");

  } finally {
    AnalyticsWriter.sheet_ = originalSheetFn;
    Formatter.writeSheetIntro = originalWriteSheetIntro;
    AnalyticsWriter.dump_ = originalDump;
  }

}

// ==========================================================
// Текстовая интерпретация ("Полностью согласен (100)" вместо
// голого "100") и колонка "Интерпретация"/поле "Приоритет" — новая
// читаемость поверх уже существующего Уровня 0-100 и разницы
// (Оценка руководителя - Средняя оценка команды). Расчет самого
// уровня и разницы не меняется — см. testManagerTeamReport_
// diffFormulaUnchanged_ и splitsManagerFromTeam_ выше.
// ==========================================================

/**
 * Руководитель и команда отвечают одинаково ("ЗП" = 5 у всех) —
 * разница 0, вывод "Восприятие совпадает".
 */
function testManagerTeamReport_sameAnswersInterpretedAsMatch_() {

  const department = "Отдел одинаковых ответов";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "5", "10"),
    mtrRow_("Сотрудник 2", department, "5", "10"),
    mtrRow_("Сотрудник 3", department, "5", "10"),
    mtrRow_("Сотрудник 4", department, "5", "10"),
    mtrRow_("Сотрудник 5", department, "5", "10")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.diff, 0, "разница нулевая — ответы совпадают");
  assertMTREquals_(zpRow.interpretation, ManagerTeamReport.INTERPRETATION.MATCH, "вывод — восприятие совпадает");
  assertMTREquals_(zpRow.priority, ManagerTeamReport.PRIORITY.LOW, "приоритет низкий — расхождения нет");

}

/**
 * Руководитель оценивает намного выше команды (команда < 60,
 * разница > 20) — "Возможная слепая зона руководителя", приоритет
 * "Высокий".
 */
function testManagerTeamReport_managerMuchHigherIsBlindSpot_() {

  const department = "Отдел слепой зоны";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"), // уровень 100
    mtrRow_("Сотрудник 1", department, "2", "5"),
    mtrRow_("Сотрудник 2", department, "3", "5"),
    mtrRow_("Сотрудник 3", department, "3", "5"),
    mtrRow_("Сотрудник 4", department, "3", "5"),
    mtrRow_("Сотрудник 5", department, "2", "5") // команда: среднее 2.6 -> уровень 40
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.managerLevel, 100, "уровень руководителя 100");
  assertMTREquals_(zpRow.teamLevel, 40, "уровень команды 40");
  assertMTRTrue_(zpRow.teamLevel < 60 && zpRow.diff > 20, "условие слепой зоны выполнено");
  assertMTREquals_(zpRow.interpretation, ManagerTeamReport.INTERPRETATION.BLIND_SPOT, "вывод — возможная слепая зона");
  assertMTREquals_(zpRow.priority, ManagerTeamReport.PRIORITY.HIGH, "приоритет высокий");

}

/**
 * Руководитель оценивает намного ниже команды (разница < -20) —
 * "Руководитель оценивает ситуацию критичнее команды".
 */
function testManagerTeamReport_managerMuchLowerIsMoreCritical_() {

  const department = "Отдел критичного руководителя";
  const rows = [
    mtrRow_("Руководитель Один", department, "2", "3"), // уровень 25
    mtrRow_("Сотрудник 1", department, "5", "9"),
    mtrRow_("Сотрудник 2", department, "5", "9"),
    mtrRow_("Сотрудник 3", department, "4", "9"),
    mtrRow_("Сотрудник 4", department, "5", "9"),
    mtrRow_("Сотрудник 5", department, "4", "9") // команда: среднее 4.6 -> уровень 90
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.managerLevel, 25, "уровень руководителя 25");
  assertMTREquals_(zpRow.teamLevel, 90, "уровень команды 90");
  assertMTRTrue_(zpRow.diff < -20, "разница меньше -20");
  assertMTREquals_(zpRow.interpretation, ManagerTeamReport.INTERPRETATION.MANAGER_MORE_CRITICAL,
    "вывод — руководитель оценивает критичнее команды");
  assertMTREquals_(zpRow.priority, ManagerTeamReport.PRIORITY.LOW,
    "приоритет низкий — правило приоритета реагирует только на diff > 20");

}

/**
 * Обе стороны оценивают низко (руководитель < 60, команда < 60,
 * разница < 20) — "Общая зона внимания".
 */
function testManagerTeamReport_bothLowIsSharedConcern_() {

  const department = "Отдел общей проблемы";
  const rows = [
    mtrRow_("Руководитель Один", department, "2", "3"), // уровень 25
    mtrRow_("Сотрудник 1", department, "3", "4"),
    mtrRow_("Сотрудник 2", department, "3", "4"),
    mtrRow_("Сотрудник 3", department, "2", "4"),
    mtrRow_("Сотрудник 4", department, "3", "4"),
    mtrRow_("Сотрудник 5", department, "2", "4") // команда: среднее 2.6 -> уровень 40
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.managerLevel, 25, "уровень руководителя 25");
  assertMTREquals_(zpRow.teamLevel, 40, "уровень команды 40");
  assertMTRTrue_(zpRow.managerLevel < 60 && zpRow.teamLevel < 60, "обе стороны ниже 60");
  assertMTRTrue_(Math.abs(zpRow.diff) > 10 && zpRow.diff < 20, "разница не тривиальна, но меньше 20");
  assertMTREquals_(zpRow.interpretation, ManagerTeamReport.INTERPRETATION.SHARED_CONCERN, "вывод — общая зона внимания");
  assertMTREquals_(zpRow.priority, ManagerTeamReport.PRIORITY.LOW, "приоритет низкий — diff не превышает 20");

}

/**
 * Маленькая команда (n=2, меньше MIN_TEAM_SIZE) больше не исключается
 * из сравнения — средняя, разница и текстовая интерпретация команды
 * считаются и показываются, — но в колонку "Интерпретация"/приоритет
 * это не попадает как уверенный автоматический вывод: там сохраняется
 * консервативное "Недостаточно данных" ровно потому, что статус
 * надежности ниже STATUS.OK (см. interpretationFor_/priorityFor_).
 */
function testManagerTeamReport_smallTeamIsInsufficientData_() {

  const department = "Малый отдел интерпретации";
  const rows = [
    mtrRow_("Руководитель Один", department, "5", "10"),
    mtrRow_("Сотрудник 1", department, "4", "8"),
    mtrRow_("Сотрудник 2", department, "4", "8")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.VERY_LOW_TEAM, "статус — очень мало данных (n=2)");
  assertMTRTrue_(zpRow.teamLevel !== null, "средняя команды теперь показывается даже при маленькой команде");
  assertMTRTrue_(zpRow.diff !== null, "разница считается даже при маленькой команде");
  assertMTREquals_(zpRow.interpretation, ManagerTeamReport.INTERPRETATION.INSUFFICIENT,
    "автоматический вывод остается консервативным — маленькая команда не дает уверенного вывода");
  assertMTREquals_(zpRow.priority, ManagerTeamReport.PRIORITY.LOW, "приоритет низкий при недостатке данных");
  assertMTRTrue_(zpRow.managerText !== null, "ответ руководителя переводится в текст — он ответил");
  assertMTRTrue_(zpRow.teamText !== null, "текстовая интерпретация команды теперь тоже показывается");

}

/**
 * Формула разницы (Оценка руководителя - Средняя оценка команды) на
 * шкале 0-100 не менялась этой доработкой — новые текстовые поля
 * добавлены поверх уже посчитанных managerLevel/teamLevel/diff.
 */
function testManagerTeamReport_diffFormulaUnchanged_() {

  const department = "Отдел проверки формулы";
  const rows = mtrRowsFullTeam_(department);
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.diff, MathStats.round(zpRow.managerLevel - zpRow.teamLevel, 1),
    "разница по-прежнему считается как managerLevel - teamLevel");

}

// ==========================================================
// answerLabel_ — текстовая интерпретация числового ответа
// ==========================================================

/**
 * Для вопросов с текстовой шкалой (карта Scoring.MAPS) дробное
 * среднее команды переводится в ближайший по числовому коду вариант
 * ответа, а не остается голым числом.
 */
function testManagerTeamReport_answerLabelPicksNearestMapCategory_() {

  const question = Questions.getAll().find(q => q.title === "ОС от руководителя");
  assertMTRTrue_(!!question, "вопрос «ОС от руководителя» есть в каталоге (scale4, шкала да/скорее да/скорее нет/нет)");

  // Карта: да=4, скорее да=3, скорее нет=2, нет=1 — 3.4 ближе всего к 3 ("скорее да").
  const label = ManagerTeamReport.answerLabel_(question, 3.4);

  assertMTREquals_(label, "Скорее да", "ближайшая категория для 3.4 — «скорее да»");

}

/**
 * Для числовых шкал без текстовых вариантов (rating5) ответ
 * округляется до ближайшего балла шкалы и подписывается количеством
 * делений шкалы.
 */
function testManagerTeamReport_answerLabelForRating5UsesRoundedScore_() {

  const question = Questions.getAll().find(q => q.title === "ЗП");
  assertMTRTrue_(!!question, "вопрос «ЗП» есть в каталоге (rating5)");

  const label = ManagerTeamReport.answerLabel_(question, 4.6);

  assertMTREquals_(label, "5 из 5", "4.6 округляется до ближайшего балла шкалы 1-5");

}

// ==========================================================
// "Выгорание" — "затрудняюсь ответить" не должен читаться как пропуск
// вопроса. Scoring.NOT_A_SCALE_POINT намеренно превращает этот ответ
// (и реально пустую ячейку, и любой нераспознанный текст) в null —
// ManagerTeamReport обязан различать эти три сырые ситуации сам, не
// трогая Scoring (см. managerRawAnswer_/managerAnswerCaseFor_ в
// ManagerTeamReport.gs).
// ==========================================================

const MTR_BURNOUT_HEADERS_ = ["Фамилия Имя", "Отдел", "Выгорание"];

function mtrBurnoutRow_(name, department, answer) {
  return [name, department, answer];
}

/**
 * Команда из 5 человек с обычными валидными ответами — используется во
 * всех тестах ниже, меняется только ответ руководителя. Смесь дает
 * teamLevel=60 (map: 4,4,2,2,5 → среднее 3.4 → (3.4-1)/4*100=60),
 * общий для всех тестов ниже ориентир "команда точно ответила и
 * посчиталась, вопрос только в руководителе".
 */
function mtrBurnoutTeamRows_(department) {
  return [
    mtrBurnoutRow_("Сотрудник 1", department, "чувствовал редко"),
    mtrBurnoutRow_("Сотрудник 2", department, "чувствовал редко"),
    mtrBurnoutRow_("Сотрудник 3", department, "чувствовал регулярно"),
    mtrBurnoutRow_("Сотрудник 4", department, "чувствовал регулярно"),
    mtrBurnoutRow_("Сотрудник 5", department, "совсем не чувствовал")
  ];
}

/**
 * Руководитель выбрал обычный вариант шкалы ("совсем не чувствовал") —
 * поведение не должно было измениться: текст, уровень 0-100 и сравнение
 * с командой считаются как раньше.
 */
function testManagerTeamReport_burnoutValidAnswerShowsTextLevelAndComparison_() {

  const department = "Отдел выгорания: валидный ответ";
  const rows = [mtrBurnoutRow_("Руководитель Один", department, "совсем не чувствовал")]
    .concat(mtrBurnoutTeamRows_(department));
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_BURNOUT_HEADERS_, rows, directory);
  const row = results[0].questions.find(q => q.question === "Выгорание");

  assertMTREquals_(row.status, ManagerTeamReport.STATUS.OK, "команда из 5 — статус «достаточно данных»");
  assertMTREquals_(row.managerText, "Совсем не чувствовал", "текст ответа руководителя показан как обычно");
  assertMTREquals_(row.managerLevel, 100, "«совсем не чувствовал» = 5 по карте burnout → уровень 100");
  assertMTREquals_(row.teamLevel, 60, "средняя команды считается как раньше");
  assertMTREquals_(row.diff, 40, "разница считается как раньше (100 - 60)");

}

/**
 * Руководитель осознанно выбрал «Затрудняюсь ответить» — это НЕ пропуск
 * вопроса. Текст должен отображаться, статус — отдельный
 * MANAGER_UNCERTAIN, числовая оценка и разница не считаются, команда
 * при этом продолжает считаться как обычно (расчет команды не менялся).
 */
function testManagerTeamReport_burnoutUncertainAnswerIsNotTreatedAsSkipped_() {

  const department = "Отдел выгорания: затрудняюсь ответить";
  const rows = [mtrBurnoutRow_("Руководитель Один", department, "Затрудняюсь ответить")]
    .concat(mtrBurnoutTeamRows_(department));
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_BURNOUT_HEADERS_, rows, directory);
  const row = results[0].questions.find(q => q.question === "Выгорание");

  assertMTREquals_(row.status, ManagerTeamReport.STATUS.MANAGER_UNCERTAIN,
    "отдельный статус, а не «руководитель не ответил на этот вопрос»");
  assertMTRTrue_(row.status !== ManagerTeamReport.STATUS.MANAGER_SKIPPED_QUESTION,
    "точно не статус пропущенного вопроса");
  assertMTREquals_(row.managerText, "Затрудняюсь ответить", "текст ответа показан вместо пустой ячейки");
  assertMTREquals_(row.managerLevel, null, "числовая оценка 0-100 не считается");
  assertMTREquals_(row.diff, null, "разница с командой не считается");
  assertMTREquals_(row.teamLevel, 60, "команда посчиталась как обычно — расчет команды не менялся");
  assertMTREquals_(row.interpretation, ManagerTeamReport.INTERPRETATION.INSUFFICIENT,
    "не попадает в автоматический вывод");
  assertMTREquals_(row.priority, ManagerTeamReport.PRIORITY.LOW, "не попадает в приоритет");

}

/**
 * Ячейка реально пустая — поведение не меняется: статус «руководитель
 * не ответил на этот вопрос», оценка и разница пустые.
 */
function testManagerTeamReport_burnoutEmptyCellIsSkippedQuestion_() {

  const department = "Отдел выгорания: пустая ячейка";
  const rows = [mtrBurnoutRow_("Руководитель Один", department, "")]
    .concat(mtrBurnoutTeamRows_(department));
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_BURNOUT_HEADERS_, rows, directory);
  const row = results[0].questions.find(q => q.question === "Выгорание");

  assertMTREquals_(row.status, ManagerTeamReport.STATUS.MANAGER_SKIPPED_QUESTION,
    "пустая ячейка — по-прежнему «руководитель не ответил на этот вопрос»");
  assertMTREquals_(row.managerText, null, "текст не показывается для реально пустой ячейки");
  assertMTREquals_(row.managerLevel, null, "оценка пуста");
  assertMTREquals_(row.diff, null, "разница пуста");

}

/**
 * В ячейке непустой текст, которого нет ни в карте вариантов, ни в
 * списке "не точка шкалы" (например, опечатка) — отдельный статус
 * «нераспознанный вариант ответа», НЕ «пропущен вопрос». В диагностике
 * показывается исходный текст ячейки, чтобы можно было найти и
 * поправить опечатку в справочнике вариантов.
 */
function testManagerTeamReport_burnoutUnrecognizedTextIsFlagged_() {

  const department = "Отдел выгорания: неизвестный текст";
  const rows = [mtrBurnoutRow_("Руководитель Один", department, "иногда бывает")]
    .concat(mtrBurnoutTeamRows_(department));
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_BURNOUT_HEADERS_, rows, directory);
  const row = results[0].questions.find(q => q.question === "Выгорание");

  assertMTREquals_(row.status, ManagerTeamReport.STATUS.MANAGER_UNRECOGNIZED,
    "статус — нераспознанный вариант ответа");
  assertMTRTrue_(row.status !== ManagerTeamReport.STATUS.MANAGER_SKIPPED_QUESTION,
    "не называется пропущенным ответом");
  assertMTREquals_(row.managerText, "иногда бывает", "исходный текст ячейки показан как есть — для правки справочника");
  assertMTREquals_(row.managerLevel, null, "числовая оценка не считается");
  assertMTREquals_(row.diff, null, "разница не считается");

}

/**
 * Исправление читается только в логике отображения ответа руководителя
 * — расчеты команды и других вопросов (здесь "ЗП") в том же отделе не
 * изменились.
 */
function testManagerTeamReport_burnoutFixDoesNotAffectOtherQuestions_() {

  const department = "Отдел выгорания: регрессия по другим вопросам";
  const rows = mtrRowsFullTeam_(department); // штатная фикстура с "ЗП"/"eNPS", без "Выгорание" вовсе
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_HEADERS_, rows, directory);
  const zpRow = results[0].questions.find(q => q.question === "ЗП");

  assertMTREquals_(zpRow.status, ManagerTeamReport.STATUS.OK, "статус «ЗП» не изменился");
  assertMTREquals_(zpRow.managerLevel, 100, "оценка руководителя по «ЗП» не изменилась");
  assertMTRTrue_(zpRow.teamLevel !== null, "средняя команды по «ЗП» по-прежнему считается");
  assertMTRTrue_(zpRow.diff !== null, "разница по «ЗП» по-прежнему считается");

  // "Выгорание" в этой фикстуре не заполнено вовсе (колонки нет в
  // headers) — это ровно случай "ячейка недоступна", т.е. по-прежнему
  // должен читаться как пропуск вопроса, а не как что-то новое.
  const burnoutRow = results[0].questions.find(q => q.question === "Выгорание");
  assertMTREquals_(burnoutRow.status, ManagerTeamReport.STATUS.MANAGER_SKIPPED_QUESTION,
    "вопрос без колонки в источнике — по-прежнему пропуск, регрессии нет");

}

// ==========================================================
// "Не пользовался" (rating5-вопросы про офис/льготы, например
// "Рабочий стол") — тот же побочный случай, что и "затрудняюсь
// ответить": Scoring дает managerValue===null (см. NOT_A_SCALE_POINT),
// раньше это ошибочно классифицировалось как MANAGER_UNRECOGNIZED.
// Нужен отдельный статус, а не "нераспознанный"/"пропущенный".
// ==========================================================

const MTR_NOT_USED_HEADERS_ = ["Фамилия Имя", "Отдел", "Рабочий стол"];

function mtrNotUsedRow_(name, department, answer) {
  return [name, department, answer];
}

/**
 * Руководитель осознанно выбрал «Не пользовался» — показывается
 * исходный текст, статус отдельный (MANAGER_NOT_USED), числовая оценка
 * и разница не считаются, строка не попадает в автоматическую
 * интерпретацию/приоритет, команда считается как обычно (расчет
 * команды не менялся). Поведение "затрудняюсь ответить" и реально
 * неизвестного текста не затронуто — это отдельные case'ы.
 */
function testManagerTeamReport_notUsedAnswerGetsOwnStatus_() {

  const department = "Отдел: не пользовался";
  const rows = [
    mtrNotUsedRow_("Руководитель Один", department, "Не пользовался"),
    mtrNotUsedRow_("Сотрудник 1", department, "4"),
    mtrNotUsedRow_("Сотрудник 2", department, "4"),
    mtrNotUsedRow_("Сотрудник 3", department, "3"),
    mtrNotUsedRow_("Сотрудник 4", department, "3"),
    mtrNotUsedRow_("Сотрудник 5", department, "5")
  ];
  const directory = mtrDirectory_({ [department]: ["Руководитель Один"] });

  const results = ManagerTeamReport.build(MTR_NOT_USED_HEADERS_, rows, directory);
  const row = results[0].questions.find(q => q.question === "Рабочий стол");

  assertMTREquals_(row.status, ManagerTeamReport.STATUS.MANAGER_NOT_USED,
    "отдельный статус «руководитель не пользовался»");
  assertMTRTrue_(row.status !== ManagerTeamReport.STATUS.MANAGER_UNRECOGNIZED,
    "не называется нераспознанным вариантом");
  assertMTRTrue_(row.status !== ManagerTeamReport.STATUS.MANAGER_SKIPPED_QUESTION,
    "не называется пропущенным вопросом");
  assertMTREquals_(row.managerText, "Не пользовался", "исходный текст ответа показан");
  assertMTREquals_(row.managerLevel, null, "числовая оценка 0-100 не считается");
  assertMTREquals_(row.diff, null, "разница с командой не считается");
  assertMTRTrue_(row.teamLevel !== null, "команда посчиталась как обычно — расчет команды не менялся");
  assertMTREquals_(row.interpretation, ManagerTeamReport.INTERPRETATION.INSUFFICIENT,
    "не попадает в автоматическую интерпретацию");
  assertMTREquals_(row.priority, ManagerTeamReport.PRIORITY.LOW, "не попадает в приоритет");

}
