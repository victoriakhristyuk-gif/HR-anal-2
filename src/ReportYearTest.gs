/**
 * ==========================================================
 * Ручные тесты периода основного отчета (PROMPT-061)
 * ==========================================================
 *
 * Запускать из редактора Apps Script: testReportYear_runAll().
 * Проверяет подписи самостоятельного отчета за 2025 и подготовку
 * распределения отделов без изменения исходных строк.
 */

function testReportYear_runAll() {

  const tests = [
    testReportYear_standalone2025Periods_,
    testReportYear_comparisonPeriods_,
    testReportYear_rendersStandalone2025Headers_,
    testReportYear_canonicalizesStandalone2025Department_,
    testReportYear_keepsOtherQuestionsUntouched_
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

  console.log("Все тесты ReportYear пройдены.");

}

function assertReportYearEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || "assertReportYearEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual)
    );
  }
}

/**
 * Самостоятельный отчет за 2025 обязан использовать 2025 как текущий
 * видимый период и не показывать прошлый период.
 */
function testReportYear_standalone2025Periods_() {

  const periods = ReportBuilder.getReportPeriods_({
    source: "2025",
    currentYear: "2025",
    previousYear: null,
    comparison: null
  });

  assertReportYearEquals_(periods.currentYear, "2025", "текущий год");
  assertReportYearEquals_(periods.previousYear, null, "прошлый год");

}

/**
 * При сравнении текущим остается 2026, прошлым — 2025.
 */
function testReportYear_comparisonPeriods_() {

  const periods = ReportBuilder.getReportPeriods_({
    source: "2026",
    currentYear: "2026",
    previousYear: "2025",
    comparison: {}
  });

  assertReportYearEquals_(periods.currentYear, "2026", "текущий год сравнения");
  assertReportYearEquals_(periods.previousYear, "2025", "прошлый год сравнения");

}

/**
 * Оба вида таблиц, в которых раньше было жестко написано "2026",
 * получают подпись текущего периода из reportData.
 */
function testReportYear_rendersStandalone2025Headers_() {

  const values = {};
  const sheet = {
    getRange(row, column) {
      return {
        setValue(value) {
          values[row + ":" + column] = value;
          return this;
        },
        setFontWeight() { return this; },
        setHorizontalAlignment() { return this; }
      };
    }
  };

  const originalFormatHeader = Formatter.formatReportTableHeader;
  const originalProgressBar = Formatter.setBlockProgressBar;
  const originalZebraStripe = Formatter.applyZebraStripe;

  Formatter.formatReportTableHeader = function () {};
  Formatter.setBlockProgressBar = function () {};
  Formatter.applyZebraStripe = function () {};

  try {

    ReportBuilder.renderCompactAnswerList_(
      { sheet: sheet, row: 1 },
      [{ answer: "да", count2026: 1, percent2026: 100 }],
      false,
      "2025",
      null,
      answer => answer
    );

    ReportBuilder.renderAnswerTable_(
      { sheet: sheet, row: 10 },
      [{ answer: "вариант", count2026: 1, percent2026: 100 }],
      false,
      true,
      "2025",
      null
    );

  } finally {
    Formatter.formatReportTableHeader = originalFormatHeader;
    Formatter.setBlockProgressBar = originalProgressBar;
    Formatter.applyZebraStripe = originalZebraStripe;
  }

  assertReportYearEquals_(values["1:2"], "2025", "заголовок компактного списка");
  assertReportYearEquals_(values["10:2"], "2025, кол-во", "заголовок количества");
  assertReportYearEquals_(values["10:3"], "2025, %", "заголовок процента");

}

/**
 * Старое название отдела 2025 преобразуется только в копии строк,
 * используемой для распределения. Сырые строки остаются неизменными.
 */
function testReportYear_canonicalizesStandalone2025Department_() {

  const originalRows = Headcount.rowsCache_;
  const originalDirectory = Headcount.directory_;
  Headcount.rowsCache_ = [
    { year: "2025", departmentId: "dept_network_technologies", division: "ИТ", department: "Отдел сетевого администрирования", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_network_technologies", division: "ИТ", department: "Отдел сетевых технологий", count: 12, row: 3 }
  ];
  Headcount.directory_ = null;

  const headers = ["Отдел", "eNPS"];
  const rows = [["Отдел сетевого администрирования", "9"]];
  const question = { title: "Отдел" };

  let distributionRows;

  try {
    distributionRows = getReportDistributionRows_(
      "2025", question, rows, headers
    );
  } finally {
    Headcount.rowsCache_ = originalRows;
    Headcount.directory_ = originalDirectory;
  }

  assertReportYearEquals_(
    distributionRows[0][0],
    "Отдел сетевых технологий",
    "название отдела в распределении"
  );
  assertReportYearEquals_(
    rows[0][0],
    "Отдел сетевого администрирования",
    "исходная строка не изменена"
  );
  assertReportYearEquals_(
    distributionRows === rows,
    false,
    "для отдела создана отдельная копия массива"
  );

}

/**
 * Для остальных вопросов строки передаются без преобразования.
 */
function testReportYear_keepsOtherQuestionsUntouched_() {

  const headers = ["Отдел", "eNPS"];
  const rows = [["Отдел сетевого администрирования", "9"]];
  const question = { title: "eNPS" };

  const distributionRows = getReportDistributionRows_(
    "2025", question, rows, headers
  );

  assertReportYearEquals_(
    distributionRows === rows,
    true,
    "нерелевантный вопрос использует исходные строки"
  );

}
