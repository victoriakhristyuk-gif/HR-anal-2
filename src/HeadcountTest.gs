/**
 * Ручные тесты многолетнего справочника: testHeadcount_runAll().
 * Реальные листы Google Sheets не создаются и не изменяются.
 */

function testHeadcount_runAll() {

  const tests = [
    testHeadcount_parsesEditableRows_,
    testHeadcount_allowsMissingIdUntilLater_,
    testHeadcount_repairsIdValidationOnExistingSheet_,
    testHeadcount_rejectsMissingHeaders_,
    testHeadcount_skipsInvalidRowsAsWarnings_,
    testHeadcount_usesSeparateYearTotals_,
    testHeadcount_linksRenamedDepartmentById_,
    testHeadcount_usesHistoricalDivision_,
    testHeadcount_filtersDivisionByHistoricalYear_,
    testHeadcount_filtersInvitedPopulation_,
    testHeadcount_reportRateUsesMatchingYear_,
    testHeadcount_rejectsUnsupportedDenominator_,
    testHeadcount_invalidSheetDoesNotBlockAnalytics_,
    testHeadcount_flagsDivisionConflictAsWarning_,
    testHeadcount_flagsNameIdConflictAsWarning_,
    testHeadcount_teamTypeOptionalNoWarning_,
    testHeadcount_emptyTeamTypeHasNoGroup_,
    testHeadcount_emptyTeamTypeStaysInOtherDimensions_,
    testHeadcount_teamTypeDiffersByYear_,
    testHeadcount_teamGroupCompositeKeyByDivision_,
    testHeadcount_teamGroupFollowsRenamedDepartment_,
    testHeadcount_listTeamGroupsOnlyNonEmpty_,
    testHeadcount_teamGroupHeadcountSums_,
    testHeadcount_flagsTeamTypeConflictAsWarning_,
    testHeadcount_teamTypeNearDuplicatesAreNotConflict_,
    testHeadcount_teamTypeRealConflictDetectedDespiteFormatting_,
    testHeadcount_teamGroupFilterSelectsCorrectRows_,
    testHeadcount_teamGroupInvitedPopulationIntersectsAnd_,
    testHeadcount_ensureTeamTypeColumn_insertsRightAfterDivision_,
    testHeadcount_ensureTeamTypeColumn_setsHeaderAndNote_,
    testHeadcount_ensureTeamTypeColumn_clearsInheritedValidation_,
    testHeadcount_ensureTeamTypeColumn_staysTextAndAllowsEmpty_,
    testHeadcount_ensureTeamTypeColumn_doesNotOverwriteOtherColumns_,
    testHeadcount_ensureTeamTypeColumn_skipsInsertWhenColumnExists_,
    testHeadcount_ensureTeamTypeColumn_rerunIsSafe_,
    testHeadcount_ensureTeamTypeColumn_doesNotRebuildUnexpectedSheet_
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

  console.log("Все тесты Headcount пройдены.");

}

function assertHeadcountEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertHeadcountEquals") +
      ": ожидалось " + JSON.stringify(expected) +
      ", получено " + JSON.stringify(actual));
  }
}

function assertHeadcountThrows_(fn, expectedText, message) {

  let error = null;
  try { fn(); } catch (caught) { error = caught; }

  if (!error) throw new Error((message || "assertHeadcountThrows") + ": ожидалась ошибка");
  if (String(error.message).indexOf(expectedText) === -1) {
    throw new Error((message || "assertHeadcountThrows") +
      ": текст ошибки не содержит " + JSON.stringify(expectedText) +
      ", получено " + JSON.stringify(error.message));
  }

}

function headcountHeaders_() {
  return ["Год", "ID отдела", "Управление", "Тип команды", "Отдел", "Численность"];
}

function headcountMultiYearRows_() {
  return [
    { year: "2025", departmentId: "dept_a", division: "Старое управление", department: "Старое имя отдела", count: 10, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Новое управление", department: "Новое имя отдела", count: 12, row: 3 },
    { year: "2025", departmentId: "dept_b", division: "Старое управление", department: "Отдел Б", count: 5, row: 4 },
    { year: "2026", departmentId: "dept_b", division: "Новое управление", department: "Отдел Б", count: 8, row: 5 }
  ];
}

function testHeadcount_parsesEditableRows_() {

  const rows = Headcount.parse_(headcountHeaders_(), [
    [2025, "dept_a", "Управление А", "", "Отдел А", 12],
    ["2026", "dept_b", "", "Сервисная команда", "Отдел Б", "8"],
    ["", "", "", "", "", ""]
  ]).rows;

  assertHeadcountEquals_(rows.length, 2, "пустая строка пропущена");
  assertHeadcountEquals_(rows[0].year, "2025", "год нормализован");
  assertHeadcountEquals_(rows[1].division, null, "пустое управление допустимо");
  assertHeadcountEquals_(rows[1].teamType, "Сервисная команда", "тип команды сохранен");
  assertHeadcountEquals_(rows[0].teamType, null, "пустой тип команды допустим");
  assertHeadcountEquals_(rows[1].count, 8, "численность сохранена числом");

}

function testHeadcount_allowsMissingIdUntilLater_() {

  const rows = Headcount.parse_(headcountHeaders_(), [
    [2026, "", "Управление А", "", "Отдел без заполненного ID", 12]
  ]).rows;

  assertHeadcountEquals_(rows.length, 1, "строка без ID доступна аналитике");
  assertHeadcountEquals_(!!rows[0].departmentId, true, "создан временный ID из названия");
  assertHeadcountEquals_(rows[0].generatedId, true, "временный ID помечен");

  Headcount.rowsCache_ = rows;
  Headcount.directory_ = null;
  assertHeadcountEquals_(Headcount.total("2026"), 12, "численность работает с временным ID");
  assertHeadcountEquals_(
    Headcount.divisionOf("2026", "Отдел без заполненного ID"),
    "Управление А",
    "управление работает с временным ID"
  );

}

function testHeadcount_repairsIdValidationOnExistingSheet_() {

  const calls = [];
  const headers = headcountHeaders_();
  const sheet = {
    getLastColumn() { return headers.length; },
    getMaxRows() { return 20; },
    insertColumnAfter() { throw new Error("колонка ID уже существует"); },
    getRange(row, column, numRows, numColumns) {
      if (row === 1) {
        return { getValues() { return [headers]; } };
      }
      return {
        setNumberFormat(format) {
          calls.push({ action: "format", column: column, value: format });
          return this;
        },
        setDataValidation() {
          calls.push({ action: "validation", column: column });
          return this;
        },
        clearDataValidations() {
          calls.push({ action: "clear", column: column });
          return this;
        }
      };
    }
  };

  Headcount.ensureDepartmentIdColumn_(sheet);

  assertHeadcountEquals_(
    calls.some(call => call.action === "clear" && call.column === 2),
    true,
    "проверка года снята с ID"
  );
  assertHeadcountEquals_(
    calls.some(call => call.action === "format" && call.column === 2 && call.value === "@"),
    true,
    "ID переведен в текстовый формат"
  );
  assertHeadcountEquals_(
    calls.some(call => call.action === "validation" && call.column === 1),
    true,
    "проверка года осталась в колонке года"
  );
  assertHeadcountEquals_(
    calls.some(call => call.action === "validation" && call.column === 6),
    true,
    "проверка численности осталась в колонке численности"
  );

}

function testHeadcount_rejectsMissingHeaders_() {
  assertHeadcountThrows_(
    () => Headcount.parse_(["Год", "Отдел"], []),
    "ID отдела",
    "обязательная колонка ID проверяется"
  );
}

function testHeadcount_skipsInvalidRowsAsWarnings_() {

  const result = Headcount.parse_(headcountHeaders_(), [
    ["следующий", "", "Управление А", "", "Отдел А", 0],
    [2026, "", "Управление Б", "", "Отдел без численности", ""]
  ]);

  assertHeadcountEquals_(result.rows.length, 1, "строка с некорректным годом пропущена, не валит остальные");
  assertHeadcountEquals_(result.rows[0].count, null, "численность опциональна");
  assertHeadcountEquals_(
    result.warnings.some(w => w.indexOf("год должен быть целым числом") !== -1),
    true,
    "некорректный год отмечен предупреждением"
  );

}

function testHeadcount_usesSeparateYearTotals_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();

  assertHeadcountEquals_(Headcount.total("2025"), 15, "итог 2025");
  assertHeadcountEquals_(Headcount.total("2026"), 20, "итог 2026");
  assertHeadcountEquals_(Headcount.total("2024"), null, "отсутствующий год не подменяется нулем");

}

function testHeadcount_linksRenamedDepartmentById_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();

  const oldName = Headcount.forDepartment("2025", "Старое имя отдела");
  const currentName = Headcount.forDepartment("2026", "Новое имя отдела");
  const oldThroughCurrentName = Headcount.forDepartment("2025", "Новое имя отдела");

  assertHeadcountEquals_(oldName.count, 10, "найдено историческое название");
  assertHeadcountEquals_(currentName.count, 12, "найдено текущее название");
  assertHeadcountEquals_(oldThroughCurrentName.count, 10, "текущее имя связано с прошлым годом через ID");
  assertHeadcountEquals_(Headcount.resolveDepartment("Старое имя отдела").name, "Новое имя отдела", "для отчета выбрано последнее название");

}

function testHeadcount_usesHistoricalDivision_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();

  assertHeadcountEquals_(Headcount.divisionOf("2025", "Новое имя отдела"), "Старое управление", "управление 2025");
  assertHeadcountEquals_(Headcount.divisionOf("2026", "Старое имя отдела"), "Новое управление", "управление 2026");

}

function testHeadcount_filtersDivisionByHistoricalYear_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();
  const headers = ["Отдел", "eNPS"];
  const rows = [["Старое имя отдела", "9"], ["Отдел Б", "8"]];

  const oldDivision = FilterEngine.applyFilters(rows, headers, [
    { question: "Управление", values: ["Старое управление"] }
  ], "2025");
  const newDivision = FilterEngine.applyFilters(rows, headers, [
    { question: "Управление", values: ["Новое управление"] }
  ], "2026");

  assertHeadcountEquals_(oldDivision.length, 2, "для 2025 применено историческое управление");
  assertHeadcountEquals_(newDivision.length, 2, "для 2026 применено новое управление");

}

function testHeadcount_filtersInvitedPopulation_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();

  const byDepartment = Headcount.invitedForFilters("2025", [
    { question: "Отдел", values: ["Новое имя отдела"] }
  ]);
  const byDivision = Headcount.invitedForFilters("2026", [
    { question: "Управление", values: ["Новое управление"] }
  ]);

  assertHeadcountEquals_(byDepartment.count, 10, "переименованный отдел выбран по ID");
  assertHeadcountEquals_(byDivision.count, 20, "численность управления сложена");

}

function testHeadcount_reportRateUsesMatchingYear_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();
  const sample2025 = { rows: new Array(6).fill([]) };
  const sample2026 = { rows: new Array(10).fill([]) };
  const result2025 = calculateResponseRateForYear_("2025", sample2025, []);
  const result2026 = calculateResponseRateForYear_("2026", sample2026, []);

  assertHeadcountEquals_(result2025.headcount, 15, "знаменатель отчета 2025");
  assertHeadcountEquals_(result2025.responseRatePercent, 40, "явка отчета 2025");
  assertHeadcountEquals_(result2026.headcount, 20, "знаменатель отчета 2026");
  assertHeadcountEquals_(result2026.responseRatePercent, 50, "явка отчета 2026");

}

function testHeadcount_rejectsUnsupportedDenominator_() {

  Headcount.rowsCache_ = headcountMultiYearRows_();
  const result = Headcount.invitedForFilters("2026", [
    { question: "Город", values: ["Москва"] }
  ]);

  assertHeadcountEquals_(result.supported, false, "неизвестный знаменатель помечен");
  assertHeadcountEquals_(result.count, null, "ложный процент не вычисляется");

}

function testHeadcount_invalidSheetDoesNotBlockAnalytics_() {

  const originalLoadRows = Headcount.loadRows_;
  Headcount.resetCache_();
  Headcount.loadRows_ = function () {
    throw new Error("частично заполненная численность");
  };

  try {
    const resolved = Headcount.resolveDepartment("Обычный отдел");
    const invited = Headcount.invitedForFilters("2026", []);

    assertHeadcountEquals_(resolved.name, "Обычный отдел", "название доступно без справочника");
    assertHeadcountEquals_(Headcount.availableYears().length, 0, "битая численность не считается заполненной");
    assertHeadcountEquals_(invited.count, null, "процент не получает ложный знаменатель");
    assertHeadcountEquals_(invited.supported, true, "сам тип фильтров остается поддержанным");
  } finally {
    Headcount.loadRows_ = originalLoadRows;
    Headcount.resetCache_();
  }

}

function testHeadcount_flagsDivisionConflictAsWarning_() {

  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление А", department: "Отдел А", count: 1, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление Б", department: "Отдел А старое", count: 2, row: 3 }
  ];
  Headcount.warningsCache_ = [];

  const directory = Headcount.buildDirectory_();

  assertHeadcountEquals_(
    directory.warnings.some(w => w.indexOf("уже указан в управлении") !== -1),
    true,
    "конфликт управлений не блокирует справочник, а становится предупреждением"
  );
  assertHeadcountEquals_(
    directory.entriesByYear["2026"]["dept_a"].division,
    "Управление А",
    "при конфликте побеждает первая встреченная строка"
  );

}

function testHeadcount_flagsNameIdConflictAsWarning_() {

  Headcount.rowsCache_ = [
    { year: "2025", departmentId: "dept_a", division: null, department: "Одинаковое имя", count: 1, row: 2 },
    { year: "2026", departmentId: "dept_b", division: null, department: "Одинаковое имя", count: 2, row: 3 }
  ];
  Headcount.warningsCache_ = [];

  const directory = Headcount.buildDirectory_();

  assertHeadcountEquals_(
    directory.warnings.some(w => w.indexOf("уже связано с ID") !== -1),
    true,
    "конфликт имени/ID не блокирует справочник, а становится предупреждением"
  );
  assertHeadcountEquals_(
    directory.nameToId[Headcount.normalizeText_("Одинаковое имя")],
    "dept_a",
    "при конфликте побеждает первый встреченный ID"
  );

}

/**
 * Фикстура для тестов "Тип команды" (см. HR-требование): dept_a и
 * dept_b — Управление разработки ПО (сервисная/доменная), dept_c —
 * то же управление, но БЕЗ типа команды, dept_it — ИТ-управление с
 * ОДИНАКОВЫМ названием типа "Сервисная команда", что и у dept_a — для
 * проверки, что составной ключ "Управление + Тип команды" их не
 * объединяет. dept_a за 2025 год назывался иначе и имел другой тип —
 * для проверки годовой принадлежности и связывания через стабильный ID.
 */
function headcountTeamTypeRows_() {
  return [
    { year: "2025", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел А (старое имя)", count: 9, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 10, row: 3 },
    { year: "2026", departmentId: "dept_b", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел Б", count: 8, row: 4 },
    { year: "2026", departmentId: "dept_b2", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел Б2", count: 4, row: 5 },
    { year: "2026", departmentId: "dept_c", division: "Управление разработки ПО", teamType: null, department: "Отдел В", count: 5, row: 6 },
    { year: "2026", departmentId: "dept_it", division: "ИТ-управление", teamType: "Сервисная команда", department: "Отдел ИТ", count: 6, row: 7 }
  ];
}

function testHeadcount_teamTypeOptionalNoWarning_() {

  const result = Headcount.parse_(headcountHeaders_(), [
    [2026, "dept_x", "Управление разработки ПО", "", "Отдел без типа", 5]
  ]);

  assertHeadcountEquals_(result.rows.length, 1, "строка с пустым типом команды не пропущена");
  assertHeadcountEquals_(result.rows[0].teamType, null, "пустой тип команды сохранен как null");
  assertHeadcountEquals_(
    result.warnings.some(w => w.indexOf("тип команды") !== -1),
    false,
    "пустой тип команды не создает предупреждение"
  );

}

function testHeadcount_emptyTeamTypeHasNoGroup_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  assertHeadcountEquals_(Headcount.teamTypeOf("2026", "Отдел В"), null, "тип команды не указан");
  assertHeadcountEquals_(Headcount.teamGroupOf("2026", "Отдел В"), null, "отдел без типа не входит ни в одну группу");

}

function testHeadcount_emptyTeamTypeStaysInOtherDimensions_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  const entry = Headcount.forDepartment("2026", "Отдел В");

  assertHeadcountEquals_(entry.count, 5, "отдел без типа команды остается в справочнике отдела");
  assertHeadcountEquals_(Headcount.divisionOf("2026", "Отдел В"), "Управление разработки ПО", "остается в управлении");
  assertHeadcountEquals_(
    Headcount.forDivision("2026", "Управление разработки ПО").count,
    10 + 8 + 4 + 5,
    "остается в сумме численности управления (компания/управление не теряют отдел без типа)"
  );

}

function testHeadcount_teamTypeDiffersByYear_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  assertHeadcountEquals_(Headcount.teamTypeOf("2025", "Отдел А"), "Доменная разработка", "тип 2025");
  assertHeadcountEquals_(Headcount.teamTypeOf("2026", "Отдел А"), "Сервисная команда", "тип 2026 — не унаследован от 2025");
  assertHeadcountEquals_(
    Headcount.teamGroupOf("2025", "Отдел А"),
    "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Доменная разработка",
    "группа 2025 отражает тип 2025 года"
  );
  assertHeadcountEquals_(
    Headcount.teamGroupOf("2026", "Отдел А"),
    "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда",
    "группа 2026 отражает тип 2026 года"
  );

}

function testHeadcount_teamGroupCompositeKeyByDivision_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  const groups = Headcount.listTeamGroups("2026");

  assertHeadcountEquals_(
    groups.indexOf("Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда") !== -1,
    true,
    "группа ПО+Сервисная присутствует"
  );
  assertHeadcountEquals_(
    groups.indexOf("ИТ-управление" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда") !== -1,
    true,
    "группа ИТ+Сервисная присутствует как отдельная группа"
  );
  assertHeadcountEquals_(
    Headcount.forTeamGroup("2026", "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда").count,
    10,
    "численность группы ПО+Сервисная не включает ИТ+Сервисная, хотя название типа совпадает"
  );

}

function testHeadcount_teamGroupFollowsRenamedDepartment_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  // Текущее название "Отдел А" передано для прошлого года — должно
  // разрешиться через стабильный ID dept_a к записи 2025 года.
  assertHeadcountEquals_(
    Headcount.teamGroupOf("2025", "Отдел А"),
    "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Доменная разработка",
    "группа найдена по переименованному отделу через стабильный ID"
  );

}

function testHeadcount_listTeamGroupsOnlyNonEmpty_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  const groups = Headcount.listTeamGroups("2026");

  assertHeadcountEquals_(groups.length, 3, "ровно 3 непустые группы за 2026 (без синтетической группы для dept_c)");

}

function testHeadcount_teamGroupHeadcountSums_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  assertHeadcountEquals_(
    Headcount.forTeamGroup("2026", "Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Доменная разработка").count,
    8 + 4,
    "численность группы равна сумме входящих отделов (dept_b + dept_b2)"
  );

}

function testHeadcount_flagsTeamTypeConflictAsWarning_() {

  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 1, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Доменная разработка", department: "Отдел А альт", count: 2, row: 3 }
  ];
  Headcount.warningsCache_ = [];

  const directory = Headcount.buildDirectory_();

  assertHeadcountEquals_(
    directory.warnings.some(w => w.indexOf("уже указан с типом команды") !== -1),
    true,
    "конфликт типов команды не блокирует справочник, а становится предупреждением"
  );
  assertHeadcountEquals_(
    directory.entriesByYear["2026"]["dept_a"].teamType,
    "Сервисная команда",
    "при конфликте побеждает первый встреченный тип команды"
  );

}

/**
 * "Сервисная команда" и " сервисная   команда" (регистр, лишние
 * пробелы) — один и тот же тип при сопоставлении (normalizeText_), не
 * конфликт, и не создают предупреждение.
 */
function testHeadcount_teamTypeNearDuplicatesAreNotConflict_() {

  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная команда", department: "Отдел А", count: 1, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: " сервисная   команда", department: "Отдел А альт", count: 2, row: 3 }
  ];
  Headcount.warningsCache_ = [];

  const directory = Headcount.buildDirectory_();

  assertHeadcountEquals_(
    directory.warnings.some(w => w.indexOf("уже указан с типом команды") !== -1),
    false,
    "разное написание одного типа команды не считается конфликтом"
  );
  assertHeadcountEquals_(
    directory.entriesByYear["2026"]["dept_a"].teamType,
    "Сервисная команда",
    "отображаемое название не переписывается — остается первое введенное"
  );
  assertHeadcountEquals_(
    directory.entriesByYear["2026"]["dept_a"].count,
    3,
    "численность обеих строк сложена, как при обычном совпадении (не конфликт)"
  );

}

/**
 * Настоящий конфликт (два РАЗНЫХ непустых типа) по-прежнему
 * обнаруживается даже при разном регистре/пробелах в написании —
 * нормализация используется только для решения "совпадает или нет",
 * а не для того, чтобы скрыть реальное расхождение.
 */
function testHeadcount_teamTypeRealConflictDetectedDespiteFormatting_() {

  Headcount.rowsCache_ = [
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "Сервисная  команда", department: "Отдел А", count: 1, row: 2 },
    { year: "2026", departmentId: "dept_a", division: "Управление разработки ПО", teamType: "ДОМЕННАЯ разработка", department: "Отдел А альт", count: 2, row: 3 }
  ];
  Headcount.warningsCache_ = [];

  const directory = Headcount.buildDirectory_();

  assertHeadcountEquals_(
    directory.warnings.some(w => w.indexOf("уже указан с типом команды") !== -1),
    true,
    "разные типы команды остаются конфликтом независимо от форматирования"
  );
  assertHeadcountEquals_(
    directory.entriesByYear["2026"]["dept_a"].teamType,
    "Сервисная  команда",
    "при настоящем конфликте побеждает первый встреченный тип, как и раньше"
  );

}

function testHeadcount_teamGroupFilterSelectsCorrectRows_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();
  const headers = ["Отдел", "eNPS"];
  const rows = [
    ["Отдел А", "9"],   // ПО + Сервисная
    ["Отдел Б", "8"],   // ПО + Доменная
    ["Отдел В", "7"],   // без типа — никогда не совпадает
    ["Отдел ИТ", "6"]   // ИТ + Сервисная (то же название типа, другое управление)
  ];

  const selected = FilterEngine.applyFilters(rows, headers, [
    { question: "Группа команд", values: ["Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда"] }
  ], "2026");

  assertHeadcountEquals_(selected.length, 1, "выбран только отдел ПО+Сервисная");
  assertHeadcountEquals_(selected[0][0], "Отдел А", "выбрана правильная строка");

}

function testHeadcount_teamGroupInvitedPopulationIntersectsAnd_() {

  Headcount.rowsCache_ = headcountTeamTypeRows_();

  const byGroup = Headcount.invitedForFilters("2026", [
    { question: "Группа команд", values: ["Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Доменная разработка"] }
  ]);
  const byDivisionAndGroup = Headcount.invitedForFilters("2026", [
    { question: "Управление", values: ["ИТ-управление"] },
    { question: "Группа команд", values: ["Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда"] }
  ]);
  const emptyTypeExcluded = Headcount.invitedForFilters("2026", [
    { question: "Группа команд", values: ["Управление разработки ПО" + Headcount.TEAM_GROUP_SEPARATOR + "Сервисная команда"] }
  ]);

  assertHeadcountEquals_(byGroup.count, 12, "приглашенные группы ПО+Доменная = сумма dept_b + dept_b2");
  assertHeadcountEquals_(
    byDivisionAndGroup.count,
    null,
    "Управление=ИТ И Группа=ПО+Сервисная пересекаются через И и не дают ни одного отдела"
  );
  assertHeadcountEquals_(emptyTypeExcluded.count, 10, "dept_c без типа команды не входит в сумму группы");

}

/**
 * ==========================================================
 * Mock-лист для тестов Headcount.ensureTeamTypeColumn_
 * ==========================================================
 *
 * Легковесная in-memory реализация тех методов Range/Sheet, которые
 * реально вызывает ensureTeamTypeColumn_/applyInputValidations_:
 * getRange/getValues/setValues/setValue/setNote/setNumberFormat/
 * setDataValidation/clearDataValidations/insertColumnAfter/
 * getLastColumn/getMaxRows. Реальный Google Sheet не создается и не
 * изменяется (см. заголовок файла).
 */
function headcountMockSheet_(headerRow, dataRows) {

  const grid = {};
  const notes = {};
  const calls = [];
  let maxCol = headerRow.length;
  const maxRows = dataRows.length + 1;

  const setCell = (r, c, v) => { grid[r] = grid[r] || {}; grid[r][c] = v; };
  const getCell = (r, c) => (grid[r] && grid[r][c] !== undefined) ? grid[r][c] : "";

  headerRow.forEach((v, i) => setCell(1, i + 1, v));
  dataRows.forEach((row, ri) => row.forEach((v, ci) => setCell(ri + 2, ci + 1, v)));

  function makeRange(row, col, numRows, numCols) {

    numRows = numRows || 1;
    numCols = numCols || 1;

    const range = {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(getCell(row + r, col + c));
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        values.forEach((line, r) => line.forEach((v, c) => setCell(row + r, col + c, v)));
        return range;
      },
      setValue(v) { setCell(row, col, v); return range; },
      setNote(text) { notes[col] = text; return range; },
      setBackground() { return range; },
      setFontColor() { return range; },
      setFontWeight() { return range; },
      setHorizontalAlignment() { return range; },
      setNumberFormat(fmt) {
        calls.push({ action: "format", row: row, column: col, numRows: numRows, value: fmt });
        return range;
      },
      setDataValidation(v) {
        calls.push({ action: "validation", row: row, column: col, numRows: numRows, value: v });
        return range;
      },
      clearDataValidations() {
        calls.push({ action: "clear", row: row, column: col, numRows: numRows });
        return range;
      }
    };

    return range;

  }

  return {
    getLastColumn() { return maxCol; },
    getMaxRows() { return maxRows; },
    getLastRow() { return maxRows; },
    getRange(row, col, numRows, numCols) { return makeRange(row, col, numRows, numCols); },
    insertColumnAfter(afterCol) {
      Object.keys(grid).forEach(r => {
        const line = grid[r];
        const newLine = {};
        Object.keys(line).forEach(cKey => {
          const c = Number(cKey);
          newLine[c > afterCol ? c + 1 : c] = line[c];
        });
        grid[r] = newLine;
      });
      maxCol++;
    },
    setColumnWidth() { return this; },
    _headers() {
      const h = [];
      for (let c = 1; c <= maxCol; c++) h.push(getCell(1, c));
      return h;
    },
    _row(r) {
      const line = [];
      for (let c = 1; c <= maxCol; c++) line.push(getCell(r, c));
      return line;
    },
    _note(col) { return notes[col]; },
    _calls: calls
  };

}

function headcountMigrationHeaders_() {
  return ["Год", "ID отдела", "Управление", "Отдел", "Численность"];
}

function headcountMigrationDataRows_() {
  return [
    [2026, "dept_a", "Управление разработки ПО", "Отдел А", 12],
    [2026, "dept_b", "ИТ-управление", "Отдел Б", 8]
  ];
}

/** 1. При отсутствии заголовка колонка вставляется сразу после "Управление". */
function testHeadcount_ensureTeamTypeColumn_insertsRightAfterDivision_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(
    sheet._headers().join("|"),
    ["Год", "ID отдела", "Управление", "Тип команды", "Отдел", "Численность"].join("|"),
    "новая колонка вставлена сразу после \"Управление\", перед \"Отдел\""
  );

}

/** 2. Заголовок и примечание устанавливаются. */
function testHeadcount_ensureTeamTypeColumn_setsHeaderAndNote_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(sheet._headers()[3], "Тип команды", "заголовок новой колонки установлен");
  assertHeadcountEquals_(typeof sheet._note(4), "string", "примечание установлено");
  assertHeadcountEquals_(sheet._note(4).length > 0, true, "примечание не пустое");

}

/** 3. Унаследованная проверка данных очищается. */
function testHeadcount_ensureTeamTypeColumn_clearsInheritedValidation_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(
    sheet._calls.some(c => c.action === "clear" && c.column === 4),
    true,
    "проверка данных новой колонки (столбец 4) явно очищена"
  );

}

/** 4. Колонка остаётся текстовой и допускает пустые значения. */
function testHeadcount_ensureTeamTypeColumn_staysTextAndAllowsEmpty_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(
    sheet._calls.some(c => c.action === "format" && c.column === 4 && c.value === "@"),
    true,
    "новая колонка переведена в обычный текстовый формат"
  );
  assertHeadcountEquals_(
    sheet._calls.some(c => c.action === "validation" && c.column === 4),
    false,
    "новой колонке не назначен обязательный список значений (нет вызова setDataValidation)"
  );
  // Ячейки данных остаются пустыми — insertColumnAfter не заполняет
  // новую колонку никакими значениями по умолчанию.
  assertHeadcountEquals_(sheet._row(2)[3], "", "пустое значение допустимо и остается пустым для существующей строки");

}

/** 5. Данные остальных колонок не перезаписываются. */
function testHeadcount_ensureTeamTypeColumn_doesNotOverwriteOtherColumns_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);

  // Год | ID отдела | Управление | Тип команды(новая, пустая) | Отдел | Численность
  assertHeadcountEquals_(sheet._row(2).join("|"), [2026, "dept_a", "Управление разработки ПО", "", "Отдел А", 12].join("|"),
    "существующие значения строки 2 сохранены на своих (сдвинутых) местах");
  assertHeadcountEquals_(sheet._row(3).join("|"), [2026, "dept_b", "ИТ-управление", "", "Отдел Б", 8].join("|"),
    "существующие значения строки 3 сохранены на своих (сдвинутых) местах");

}

/** 6. При существующем "Тип команды" новая колонка не вставляется. */
function testHeadcount_ensureTeamTypeColumn_skipsInsertWhenColumnExists_() {

  const headers = ["Год", "ID отдела", "Управление", "Тип команды", "Отдел", "Численность"];
  const sheet = headcountMockSheet_(headers, [[2026, "dept_a", "Управление разработки ПО", "Сервисная команда", "Отдел А", 12]]);

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(sheet.getLastColumn(), 6, "число колонок не изменилось — вторая колонка не вставлена");
  assertHeadcountEquals_(sheet._row(2)[3], "Сервисная команда", "существующее значение типа команды не тронуто");

}

/** 7. Повторный запуск безопасен — не вставляет вторую колонку. */
function testHeadcount_ensureTeamTypeColumn_rerunIsSafe_() {

  const sheet = headcountMockSheet_(headcountMigrationHeaders_(), headcountMigrationDataRows_());

  Headcount.ensureTeamTypeColumn_(sheet);
  const afterFirstRun = sheet._headers().join("|");
  const columnsAfterFirstRun = sheet.getLastColumn();

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(sheet.getLastColumn(), columnsAfterFirstRun, "повторный запуск не добавляет еще одну колонку");
  assertHeadcountEquals_(sheet._headers().join("|"), afterFirstRun, "заголовки не изменились между запусками");

}

/** 8. Непохожий на ожидаемый лист (нет "Управление") — миграция не перестраивает лист. */
function testHeadcount_ensureTeamTypeColumn_doesNotRebuildUnexpectedSheet_() {

  const headers = ["Год", "Отдел", "Численность"];
  const sheet = headcountMockSheet_(headers, [[2026, "Отдел А", 12]]);

  Headcount.ensureTeamTypeColumn_(sheet);

  assertHeadcountEquals_(sheet.getLastColumn(), 3, "число колонок не изменилось — структура листа не похожа на ожидаемую");
  assertHeadcountEquals_(sheet._headers().join("|"), headers.join("|"), "заголовки листа не тронуты");
  assertHeadcountEquals_(sheet._calls.length, 0, "никаких проверок/форматирования не назначено непохожему листу");

}
