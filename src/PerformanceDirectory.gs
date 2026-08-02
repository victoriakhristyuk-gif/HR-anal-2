/**
 * ==========================================================
 * Справочник "перформанс" — обогащение "Ответы 2026"
 * ==========================================================
 *
 * Отдельный лист Google Sheets "перформанс" (Фамилия Имя, Город, Отдел,
 * Соответствие ожиданиям, Грейд, Руководитель отдела — checkbox).
 * Присоединяется ТОЛЬКО к источнику "Ответы 2026", только в памяти, по
 * нормализованному ФИО (см. normalizeName_). Лист "Ответы 2025" и вся
 * связанная с ним логика не затрагиваются вообще.
 *
 * Чтение/валидация листа (SpreadsheetApp) отделены от чистой логики
 * (parse_/enrich_), которая работает над уже прочитанными массивами —
 * так же, как DataLoader.gs отделен от Scoring/Segments/Cohort. Это
 * позволяет тестировать parse_/enrich_ без реальной таблицы (см.
 * PerformanceDirectoryTest.gs).
 */

const PerformanceDirectory = {

  SHEET_NAME: "перформанс",

  COLUMNS: {
    NAME: "Фамилия Имя",
    CITY: "Город",
    DEPARTMENT: "Отдел",
    EXPECTATIONS: "Соответствие ожиданиям",
    GRADE: "Грейд",
    IS_MANAGER: "Руководитель отдела"
  },

  ROLE: {
    MANAGER: "Руководитель отдела",
    EMPLOYEE: "Сотрудник отдела"
  },

  cache_: null,

  /**
   * Прочитать и провалидировать лист "перформанс". Результат
   * кэшируется в пределах одного запуска скрипта (см. surveySheetCache_
   * в DataLoader.gs — тот же принцип).
   *
   * @returns {{byKey: Object, size: Number}}
   */
  load() {

    if (this.cache_) return this.cache_;

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);

    if (!sheet) {
      throw new Error(
        'Лист "' + this.SHEET_NAME + '" не найден. Добавьте лист со столбцами: ' +
        'Фамилия Имя, Город, Отдел, Соответствие ожиданиям, Грейд, Руководитель отдела (чекбокс).'
      );
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastColumn === 0 || lastRow === 0) {
      throw new Error('Лист "' + this.SHEET_NAME + '" пуст.');
    }

    const headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const dataRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];

    this.cache_ = this.parse_(headerRow, dataRows);

    return this.cache_;

  },

  /**
   * Чистая валидация и разбор уже прочитанных строк листа "перформанс".
   * Никаких обращений к SpreadsheetApp — тестируется на литеральных
   * массивах (см. PerformanceDirectoryTest.gs).
   *
   * @param {Array<String>} headerRow
   * @param {Array<Array>} dataRows
   * @returns {{byKey: Object, size: Number}}
   */
  parse_(headerRow, dataRows) {

    const columnIndex = {};
    const missingHeaders = [];

    Object.keys(this.COLUMNS).forEach(key => {

      const title = this.COLUMNS[key];
      const index = headerRow.findIndex(h => this.normalizeText_(h) === this.normalizeText_(title));

      if (index === -1) {
        missingHeaders.push(title);
      } else {
        columnIndex[key] = index;
      }

    });

    // Отсутствие столбцов делает лист структурно непригодным для
    // разбора — это не то же самое, что ошибка в отдельных строках
    // (см. issues ниже), и не может быть "собрано в диагностику":
    // индексы колонок нужны, чтобы вообще прочитать хоть одну строку.
    if (missingHeaders.length) {
      throw new Error(
        'На листе "' + this.SHEET_NAME + '" отсутствуют обязательные столбцы: ' +
        missingHeaders.join(", ") + "."
      );
    }

    const byKey = {};
    const duplicateNames = [];
    const invalidManagerRows = [];
    // normalizedDepartment -> {department, managers: [{name, row}]}
    const departments = {};

    dataRows.forEach((row, rowOffset) => {

      const sheetRow = rowOffset + 2; // +1 заголовок, +1 переход к 1-based

      const rawName = row[columnIndex.NAME];
      const rawCity = row[columnIndex.CITY];
      const rawDepartment = row[columnIndex.DEPARTMENT];
      const rawExpectations = row[columnIndex.EXPECTATIONS];
      const rawGrade = row[columnIndex.GRADE];
      const rawIsManager = row[columnIndex.IS_MANAGER];

      const isRowEmpty = [rawName, rawCity, rawDepartment, rawExpectations, rawGrade, rawIsManager]
        .every(value => value === "" || value === null || value === undefined);

      if (isRowEmpty) return;

      const name = String(rawName || "").trim();

      // Без ФИО строку невозможно сопоставить с ответами — она
      // не является содержательной записью справочника.
      if (!name) return;

      const key = this.normalizeName_(name);
      const department = String(rawDepartment || "").trim();

      // Строка с повторяющимся ФИО — диагностика, а не блокировка:
      // первая встреченная запись используется, остальные откладываются
      // в issues.duplicateNames (сопоставление по ней всё равно
      // неоднозначно, поэтому она не заменяет первую).
      if (byKey.hasOwnProperty(key)) {
        duplicateNames.push({ name: name, row: sheetRow });
        return;
      }

      let isManager = null;

      if (rawIsManager === true || rawIsManager === false) {
        isManager = rawIsManager;
      } else {
        invalidManagerRows.push({ name: name, row: sheetRow });
      }

      byKey[key] = {
        name: name,
        city: String(rawCity || "").trim(),
        department: department,
        expectations: String(rawExpectations || "").trim(),
        grade: String(rawGrade || "").trim(),
        isManager: isManager,
        row: sheetRow
      };

      if (department) {
        const deptKey = this.normalizeText_(department);
        if (!departments[deptKey]) departments[deptKey] = { department: department, managers: [] };
        if (isManager === true) {
          departments[deptKey].managers.push({ name: name, row: sheetRow });
        }
      }

    });

    return {
      byKey: byKey,
      size: Object.keys(byKey).length,
      departments: departments,
      issues: {
        duplicateNames: duplicateNames,
        invalidManagerRows: invalidManagerRows
      }
    };

  },

  /**
   * Отделы, где в справочнике "перформанс" не указан ровно один
   * руководитель (0 — отсутствует, >1 — неоднозначно). Строгая проверка
   * — используется ТОЛЬКО отчетом "Руководитель и команда"
   * (см. ManagerTeamReport.gs), не блокирует обычные отчеты/срезы.
   *
   * @returns {Array<{department: String, type: "missing"|"multiple", names: Array<String>}>}
   */
  managerIssues() {
    return this.managerIssuesFor_(this.load());
  },

  managerIssuesFor_(directory) {

    const deptKeys = Object.keys(directory.departments || {}).sort(
      (a, b) => directory.departments[a].department.localeCompare(directory.departments[b].department, "ru")
    );

    const issues = [];

    deptKeys.forEach(deptKey => {

      const entry = directory.departments[deptKey];

      if (entry.managers.length === 0) {
        issues.push({ department: entry.department, type: "missing", names: [] });
      } else if (entry.managers.length > 1) {
        issues.push({
          department: entry.department,
          type: "multiple",
          names: entry.managers.map(m => m.name)
        });
      }

    });

    return issues;

  },

  /**
   * Уникальные непустые значения поля справочника (для динамических
   * вариантов фильтра "Соответствие ожиданиям"/"Грейд").
   *
   * @param {String} fieldTitle - "Соответствие ожиданиям" или "Грейд"
   */
  distinctValues(fieldTitle) {

    let directory;

    // Обычные фильтры не должны падать из-за структурно сломанного
    // листа "перформанс" (отсутствует/пуст/без нужных столбцов) — в
    // этом случае вариантов фильтра просто нет, а не ошибка сайдбара.
    try {
      directory = this.load();
    } catch (error) {
      return [];
    }

    const field = fieldTitle === this.COLUMNS.GRADE ? "grade" : "expectations";
    const values = {};

    Object.keys(directory.byKey).forEach(key => {
      const value = directory.byKey[key][field];
      if (value) values[value] = true;
    });

    return Object.keys(values).sort((a, b) => a.localeCompare(b, "ru"));

  },

  /**
   * Присоединить справочник к уже прочитанным строкам "Ответы 2026".
   * Чистая функция — не трогает SpreadsheetApp и не мутирует входные
   * headers/rows. НЕ бросает исключение на проблемах сопоставления
   * (сотрудник не найден, город/отдел не совпадает) — такая строка
   * просто не получает данных справочника (пустые "Соответствие
   * ожиданиям"/"Грейд"/"Роль в отделе") и не попадает в новые срезы.
   * Все проблемы собираются в issues — их показывает (или не
   * показывает) вызывающий код в зависимости от того, нужна ли ему
   * строгая проверка (см. loadEnrichedSurveyData_ и ManagerTeamReport.write).
   *
   * @param {Array<String>} surveyHeaders
   * @param {Array<Array>} surveyRows
   * @param {{byKey: Object}} directory
   * @returns {{headers: Array<String>, data: Array<Array>, issues: Array<{name, row, reason}>}}
   */
  enrich_(surveyHeaders, surveyRows, directory) {

    const nameIndex = surveyHeaders.findIndex(
      h => this.normalizeText_(h) === this.normalizeText_(this.COLUMNS.NAME)
    );

    // Отсутствие самого столбца ФИО в "Ответы 2026" — структурная
    // проблема анкеты, а не справочника "перформанс", исправляется
    // только кодом/структурой листа. Единственный throw в enrich_.
    if (nameIndex === -1) {
      throw new Error(
        'В листе "Ответы 2026" не найден столбец "' + this.COLUMNS.NAME +
        '" — присоединить справочник "' + this.SHEET_NAME + '" невозможно.'
      );
    }

    const cityIndex = surveyHeaders.findIndex(
      h => this.normalizeText_(h) === this.normalizeText_(this.COLUMNS.CITY)
    );
    const departmentIndex = surveyHeaders.findIndex(
      h => this.normalizeText_(h) === this.normalizeText_(this.COLUMNS.DEPARTMENT)
    );

    const headers = surveyHeaders.slice();
    headers.push(this.COLUMNS.EXPECTATIONS, this.COLUMNS.GRADE, "Роль в отделе");

    const issues = [];

    const data = surveyRows.map(row => {

      const enrichedRow = row.slice();
      const name = String(row[nameIndex] || "").trim();

      if (!name) {
        enrichedRow.push("", "", "");
        return enrichedRow;
      }

      const entry = directory.byKey[this.normalizeName_(name)];

      if (!entry) {
        issues.push({ name: name, row: null, reason: "not_found" });
        enrichedRow.push("", "", "");
        return enrichedRow;
      }

      let mismatched = false;

      if (cityIndex !== -1) {
        const surveyCity = String(row[cityIndex] || "").trim();
        if (surveyCity && entry.city && this.normalizeText_(surveyCity) !== this.normalizeText_(entry.city)) {
          issues.push({ name: name, row: entry.row, reason: "city_mismatch" });
          mismatched = true;
        }
      }

      if (departmentIndex !== -1) {
        const surveyDepartment = String(row[departmentIndex] || "").trim();
        if (surveyDepartment && entry.department &&
          this.normalizeText_(surveyDepartment) !== this.normalizeText_(entry.department)) {
          issues.push({ name: name, row: entry.row, reason: "department_mismatch" });
          mismatched = true;
        }
      }

      // ФИО совпало, но город/отдел — нет: сопоставление ненадежно.
      // Лучше исключить сотрудника из среза целиком (не присваивать ни
      // "Соответствие ожиданиям", ни "Грейд", ни "Роль в отделе"), чем
      // рискнуть данными из чужой строки справочника.
      if (mismatched) {
        enrichedRow.push("", "", "");
        return enrichedRow;
      }

      const role = entry.isManager === true ? this.ROLE.MANAGER
        : entry.isManager === false ? this.ROLE.EMPLOYEE
          : "";

      enrichedRow.push(entry.expectations, entry.grade, role);

      return enrichedRow;

    });

    return { headers: headers, data: data, issues: issues };

  },

  /**
   * Нормализация ФИО для сопоставления: убрать пробелы по краям,
   * схлопнуть повторяющиеся пробелы, сравнивать без учета регистра.
   */
  normalizeName_(value) {
    return String(value).trim().replace(/\s+/g, " ").toLowerCase();
  },

  normalizeText_(value) {
    return String(value).trim().replace(/\s+/g, " ").toLowerCase();
  }

};

/**
 * Обертка над loadSurveyData: для источника "2026" с загруженными
 * данными присоединяет справочник "перформанс" В ПАМЯТИ и возвращает
 * НОВЫЙ объект с копиями headers/data — закэшированный в DataLoader
 * объект (surveySheetCache_) не мутируется. Для "2025" и "both" —
 * прозрачный проход к loadSurveyData без изменений.
 *
 * ЭТО МЯГКИЙ ПУТЬ, для обычных отчетов/фильтров/срезов: если справочник
 * "перформанс" временно недоступен или структурно сломан (нет листа,
 * нет нужных столбцов), обогащение просто не применяется — источник
 * "2026" возвращается как есть, без "Соответствие ожиданиям"/"Грейд"/
 * "Роль в отделе". Функциям, которым эти поля действительно нужны (см.
 * ManagerTeamReport.write), нужна строгая проверка — они не должны
 * использовать эту обертку и обязаны загружать/валидировать
 * PerformanceDirectory сами.
 *
 * @param {String} source - '2025' | '2026' | 'both'
 * @param {Boolean} includeData
 */
function loadEnrichedSurveyData_(source, includeData) {

  if (source !== "2026" || !includeData) {
    return loadSurveyData(source, includeData);
  }

  const survey = loadSurveyData("2026", true);

  let enriched;

  try {
    const directory = PerformanceDirectory.load();
    enriched = PerformanceDirectory.enrich_(survey.headers, survey.data, directory);
  } catch (error) {
    enriched = {
      headers: survey.headers.slice(),
      data: survey.data.map(row => row.slice()),
      issues: []
    };
  }

  return {
    source: survey.source,
    rows: survey.rows,
    columns: enriched.headers.length,
    headers: enriched.headers,
    data: enriched.data,
    performanceIssues: enriched.issues
  };

}
