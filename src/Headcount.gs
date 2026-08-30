/**
 * ==========================================================
 * Редактируемый многолетний справочник численности
 * ==========================================================
 *
 * ИСТОЧНИК ИСТИНЫ. Данные читаются с листа Google Sheets
 * "Численность". Одна строка — численность одного отдела за один год.
 * Расчеты всегда явно передают год и не смешивают штат разных периодов.
 *
 * ID ОТДЕЛА. Название и управление могут меняться, поэтому одинаковый
 * логический отдел связывается между годами через стабильный "ID
 * отдела". Для переименования достаточно оставить один ID и указать в
 * каждой строке название, действовавшее в соответствующем году.
 *
 * МИГРАЦИЯ. Если листа нет, ensureSheet() создает его и переносит
 * текущий справочник 2026 года из INITIAL_ROWS_. Если уже есть лист
 * старого формата без ID, колонка добавляется и заполняется, не меняя
 * пользовательские годы, управления, названия и численность.
 */

const Headcount = {

  SHEET_NAME: "Численность",
  INITIAL_YEAR: "2026",

  COLUMNS: {
    YEAR: "Год",
    DEPARTMENT_ID: "ID отдела",
    DIVISION: "Управление",
    TEAM_TYPE: "Тип команды",
    DEPARTMENT: "Отдел",
    COUNT: "Численность"
  },

  // Разделитель составного ключа "Управление + Тип команды" (см.
  // teamGroupOf/listTeamGroups/forTeamGroup) — одинаковое название типа
  // команды в разных управлениях не должно объединяться в одну группу
  // (см. заголовок модуля и требование HR).
  TEAM_GROUP_SEPARATOR: " → ",

  // Одноразовое начальное заполнение нового листа. После создания
  // расчеты читают только редактируемые ячейки.
  INITIAL_ROWS_: [
    { division: "Управление разработки ПО", department: "Отдел тестирования ПО", count: 39 },
    { division: "Управление разработки ПО", department: "Отдел аналитики и управления данными", count: 31 },
    { division: "Управление разработки ПО", department: "Отдел автоматизации операционной деятельности", count: 27 },
    { division: "Управление разработки ПО", department: "Отдел разработки водительских сервисов", count: 25 },
    { division: "Управление разработки ПО", department: "Отдел разработки интегрированных систем", count: 23 },
    { division: "Управление разработки ПО", department: "Отдел разработки гео сервисов", count: 21 },
    { division: "Управление разработки ПО", department: "Отдел локализации и перевода", count: 21 },
    { division: "Управление разработки ПО", department: "Отдел разработки клиентских сервисов", count: 20 },
    { division: "Управление разработки ПО", department: "Отдел разработки сервисов заказа", count: 16 },
    { division: "Управление разработки ПО", department: "Отдел системного анализа", count: 16 },
    { division: "Управление разработки ПО", department: "Отдел поддержки прикладного программного обеспечения", count: 15 },
    { division: "Управление разработки ПО", department: "Отдел управления процессами", count: 14 },
    { division: "Управление разработки ПО", department: "Отдел разработки мобильного ПО", count: 14 },
    { division: "Управление разработки ПО", department: "Отдел разработки биллинг сервисов", count: 13 },
    { division: "Управление разработки ПО", department: "Отдел развития продуктов", count: 11 },
    { division: "Управление разработки ПО", department: "Отдел разработки сайтов", count: 10 },
    { division: "Управление разработки ПО", department: "Отдел разработки технической документации", count: 10 },
    { division: "Управление разработки ПО", department: "Отдел бизнес-анализа", count: 9 },
    { division: "Управление разработки ПО", department: "Отдел проектирования и дизайна интерфейсов", count: 6 },
    { division: "Управление разработки ПО", department: "Отдел разработки инфраструктурных сервисов", count: 3 },
    { division: "Управление разработки ПО", department: "Отдел безопасности программного обеспечения", count: 3 },
    { division: "Управление разработки ПО", department: "Отдел разработки сервисов коммуникаций", count: 5 },
    { division: "ИТ-управление", department: "Отдел серверных решений и СХД", count: 29 },
    { division: "ИТ-управление", department: "Отдел системного администрирования", count: 18 },
    { division: "ИТ-управление", department: "Отдел обучения", count: 17 },
    { division: "ИТ-управление", department: "Отдел внедрения и обслуживания учетных систем", count: 16 },
    { division: "ИТ-управление", department: "Отдел сетевой инфраструктуры", count: 15 },
    { division: "ИТ-управление", department: "Отдел обслуживания платежных систем", count: 14 },
    { division: "ИТ-управление", department: "Отдел технической поддержки", count: 15 },
    { division: "ИТ-управление", department: "HR-отдел", count: 12 },
    { division: "ИТ-управление", department: "Отдел связи", count: 9 },
    { division: "ИТ-управление", department: "Отдел поддержки и управления сервисами IP-телефонии", count: 8 },
    { division: "ИТ-управление", department: "Администрация IT", count: 7 },
    { division: "ИТ-управление", department: "Отдел эксплуатации сети", count: 6 },
    { division: "ИТ-управление", department: "Отдел программируемых микроконтроллеров", count: 6 },
    { division: "ИТ-управление", department: "PR-отдел", count: 5 },
    { division: "ИТ-управление", department: "Отдел промышленной автоматизации", count: 4 },
    { division: "ИТ-управление", department: "Отдел информационной безопасности инфраструктуры", count: 4 },
    { division: "ИТ-управление", department: "Отдел информационной безопасности", count: 1 },
    { division: null, department: "Отдел поддержки проектов", count: 2 },
    { division: null, department: "Отдел сетевого администрирования", count: 1 },
    { division: null, department: "(не указан отдел)", count: 1 }
  ],

  rowsCache_: null,
  warningsCache_: null,
  directory_: null,
  directoryError_: null,
  fallbackDirectory_: null,

  /** Создать новый лист или безопасно дополнить старый колонкой ID. */
  ensureSheet() {

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const existing = spreadsheet.getSheetByName(this.SHEET_NAME);

    if (existing) {
      this.ensureDepartmentIdColumn_(existing);
      this.ensureTeamTypeColumn_(existing);
      return existing;
    }

    const previouslyActive = spreadsheet.getActiveSheet();
    const sheet = spreadsheet.insertSheet(this.SHEET_NAME);
    const headers = this.headerValues_();
    const values = this.INITIAL_ROWS_.map(entry => [
      Number(this.INITIAL_YEAR),
      this.initialDepartmentId_(entry.department),
      entry.division || "",
      entry.teamType || "",
      entry.department,
      entry.count
    ]);

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    this.formatSheet_(sheet, values.length);

    if (previouslyActive) spreadsheet.setActiveSheet(previouslyActive);

    this.resetCache_();
    return sheet;

  },

  headerValues_() {
    return [
      this.COLUMNS.YEAR,
      this.COLUMNS.DEPARTMENT_ID,
      this.COLUMNS.DIVISION,
      this.COLUMNS.TEAM_TYPE,
      this.COLUMNS.DEPARTMENT,
      this.COLUMNS.COUNT
    ];
  },

  formatSheet_(sheet, dataRowCount) {

    const headers = this.headerValues_();
    const headerRange = sheet.getRange(1, 1, 1, headers.length);

    headerRange
      .setBackground("#1f4e78")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setNotes([[
        "Год, к которому относится численность.",
        "Стабильный ID: один и тот же для отдела до и после переименования. Можно заполнить позже — до этого временно используется название отдела.",
        "Управление в структуре указанного года; можно оставить пустым.",
        "Необязательно. Тип команды отдела в указанном году (например «Сервисная команда», «Доменная разработка»). Можно оставить пустым — тогда отдел не входит ни в одну группу по типу команды, но продолжает учитываться в компании/управлении/отделе. Логическая группа — сочетание Управление + Тип команды: одинаковое название типа в разных управлениях не объединяется.",
        "Название отдела, действовавшее в указанном году.",
        "Положительное целое число приглашенных сотрудников."
      ]]);

    sheet.setFrozenRows(1);
    sheet.setHiddenGridlines(true);
    sheet.setTabColor("#1f4e78");
    sheet.setColumnWidth(1, 80);
    sheet.setColumnWidth(2, 230);
    sheet.setColumnWidth(3, 240);
    sheet.setColumnWidth(4, 220);
    sheet.setColumnWidth(5, 420);
    sheet.setColumnWidth(6, 130);
    sheet.getRange(2, 1, Math.max(dataRowCount, 1), 1).setNumberFormat("0");
    sheet.getRange(2, 6, Math.max(dataRowCount, 1), 1).setNumberFormat("0");
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();

    this.applyInputValidations_(sheet);

  },

  /**
   * Назначить проверки по фактическим заголовкам. После вставки новой
   * колонки Google Sheets копирует в нее проверку соседнего столбца
   * (см. insertColumnAfter в ensureDepartmentIdColumn_/ensureTeamTypeColumn_),
   * поэтому ID и Тип команды обязательно очищаются от унаследованной
   * валидации: ID вставляется после «Года» (числовая проверка года),
   * Тип команды — после «Управления» (там проверки нет, но зависеть от
   * этого нельзя — недостающая проверка «Управления» сегодня не
   * гарантирует ее отсутствие завтра). Метод также чинит уже
   * мигрированные листы при каждом открытии (см. ensureSheet).
   */
  applyInputValidations_(sheet) {

    const lastColumn = sheet.getLastColumn();
    const dataRowCount = sheet.getMaxRows() - 1;
    if (!lastColumn || dataRowCount < 1) return;

    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const findColumn = title => headers.findIndex(
      value => this.normalizeText_(value) === this.normalizeText_(title)
    ) + 1;
    const yearColumn = findColumn(this.COLUMNS.YEAR);
    const idColumn = findColumn(this.COLUMNS.DEPARTMENT_ID);
    const teamTypeColumn = findColumn(this.COLUMNS.TEAM_TYPE);
    const countColumn = findColumn(this.COLUMNS.COUNT);

    const yearValidation = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(2000, 2100)
      .setAllowInvalid(false)
      .setHelpText("Укажите год числом, например 2025.")
      .build();
    const countValidation = SpreadsheetApp.newDataValidation()
      .requireNumberGreaterThan(0)
      .setAllowInvalid(false)
      .setHelpText("Укажите положительное целое число приглашенных.")
      .build();

    if (yearColumn) {
      sheet.getRange(2, yearColumn, dataRowCount, 1)
        .setNumberFormat("0")
        .setDataValidation(yearValidation);
    }
    if (idColumn) {
      sheet.getRange(2, idColumn, dataRowCount, 1)
        .clearDataValidations()
        .setNumberFormat("@");
    }
    if (teamTypeColumn) {
      // Поле необязательное (правило 1 в заголовке модуля): обычный
      // текст без списка значений и без унаследованной проверки —
      // пустая ячейка должна оставаться допустимой.
      sheet.getRange(2, teamTypeColumn, dataRowCount, 1)
        .clearDataValidations()
        .setNumberFormat("@");
    }
    if (countColumn) {
      sheet.getRange(2, countColumn, dataRowCount, 1)
        .setNumberFormat("0")
        .setDataValidation(countValidation);
    }

  },

  /**
   * Миграция листа из формата «Год / Управление / Отдел /
   * Численность». Вставляется только новая колонка, остальные значения
   * и их форматирование Google Sheets сдвигает без перезаписи.
   */
  ensureDepartmentIdColumn_(sheet) {

    const lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) return;

    let headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const normalize = value => this.normalizeText_(value);
    const idIndex = headers.findIndex(value => normalize(value) === normalize(this.COLUMNS.DEPARTMENT_ID));

    if (idIndex !== -1) {
      this.applyInputValidations_(sheet);
      return;
    }

    const yearIndex = headers.findIndex(value => normalize(value) === normalize(this.COLUMNS.YEAR));
    const departmentIndex = headers.findIndex(value => normalize(value) === normalize(this.COLUMNS.DEPARTMENT));

    // Непохожий пользовательский лист не перестраиваем автоматически:
    // parse_ ниже покажет точный список отсутствующих колонок.
    if (yearIndex === -1 || departmentIndex === -1) return;

    const insertAfterColumn = yearIndex + 1; // индексы 0-based, API 1-based
    sheet.insertColumnAfter(insertAfterColumn);
    const insertedColumn = insertAfterColumn + 1;
    sheet.getRange(1, insertedColumn).setValue(this.COLUMNS.DEPARTMENT_ID);

    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const migratedDepartmentIndex = headers.findIndex(
      value => normalize(value) === normalize(this.COLUMNS.DEPARTMENT)
    );
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      const departments = sheet.getRange(2, migratedDepartmentIndex + 1, lastRow - 1, 1).getValues();
      const ids = departments.map(row => [
        row[0] === "" || row[0] === null || row[0] === undefined
          ? ""
          : this.initialDepartmentId_(row[0])
      ]);
      sheet.getRange(2, insertedColumn, ids.length, 1).setValues(ids);
    }

    sheet.getRange(1, insertedColumn)
      .setBackground("#1f4e78")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setNote(
        "Стабильный ID: один и тот же для отдела до и после переименования. " +
        "Можно заполнить позже — до этого временно используется название отдела."
      );
    sheet.setColumnWidth(insertedColumn, 230);

    // Вставленная после «Года» колонка наследует его числовую
    // проверку. Сразу снимаем ее и переводим ID в обычный текст.
    this.applyInputValidations_(sheet);

    this.resetCache_();

  },

  /**
   * Миграция листа, у которого уже есть ID отдела, но нет колонки
   * "Тип команды" (новое поле). Вставляется пустая колонка сразу после
   * "Управление" — существующие годы/ID/управления/отделы/численность
   * и их форматирование не трогаются. Поле по правилам опционально —
   * пустая колонка не заполняется никакими значениями по умолчанию.
   */
  ensureTeamTypeColumn_(sheet) {

    const lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) return;

    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const normalize = value => this.normalizeText_(value);
    const teamTypeIndex = headers.findIndex(value => normalize(value) === normalize(this.COLUMNS.TEAM_TYPE));

    if (teamTypeIndex !== -1) return;

    const divisionIndex = headers.findIndex(value => normalize(value) === normalize(this.COLUMNS.DIVISION));

    // Непохожий пользовательский лист не перестраиваем автоматически:
    // parse_ ниже покажет точный список отсутствующих колонок.
    if (divisionIndex === -1) return;

    const insertAfterColumn = divisionIndex + 1; // индексы 0-based, API 1-based
    sheet.insertColumnAfter(insertAfterColumn);
    const insertedColumn = insertAfterColumn + 1;

    sheet.getRange(1, insertedColumn)
      .setValue(this.COLUMNS.TEAM_TYPE)
      .setBackground("#1f4e78")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setNote(
        "Необязательно. Тип команды отдела в указанном году (например «Сервисная команда», «Доменная разработка»). " +
        "Можно оставить пустым — тогда отдел не входит ни в одну группу по типу команды, но продолжает учитываться " +
        "в компании/управлении/отделе. Логическая группа — сочетание Управление + Тип команды."
      );
    sheet.setColumnWidth(insertedColumn, 220);

    // Вставленная после "Управление" колонка может унаследовать его
    // проверку данных (Google Sheets копирует валидацию соседней
    // колонки при insertColumnAfter) — applyInputValidations_ явно
    // очищает ее и переводит колонку в обычный текстовый формат без
    // обязательного списка значений (см. applyInputValidations_ выше).
    this.applyInputValidations_(sheet);

    this.resetCache_();

  },

  initialDepartmentId_(department) {
    const resolved = this.resolveKnownAlias_(department);
    return resolved.id || resolved.canonicalName;
  },

  /** Тот же реестр алиасов, но без предупреждения для обычных новых отделов. */
  resolveKnownAlias_(department) {

    const raw = String(department || "").trim();
    const key = this.normalizeText_(raw);
    const registry = DepartmentAliases.REGISTRY_ || [];
    const canonicalEntry = registry.find(entry => this.normalizeText_(entry.canonicalName) === key);

    if (canonicalEntry) {
      return { id: canonicalEntry.id, canonicalName: canonicalEntry.canonicalName, matchedAlias: false };
    }

    const aliasEntry = registry.find(entry =>
      (entry.aliases || []).some(alias => this.normalizeText_(alias.name) === key)
    );

    return aliasEntry
      ? { id: aliasEntry.id, canonicalName: aliasEntry.canonicalName, matchedAlias: true }
      : { id: null, canonicalName: raw, matchedAlias: false };

  },

  loadRows_() {

    if (this.rowsCache_) return this.rowsCache_;

    const sheet = this.ensureSheet();
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow === 0 || lastColumn === 0) {
      throw new Error('Лист "' + this.SHEET_NAME + '" пуст.');
    }

    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const rows = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
      : [];

    const result = this.parse_(headers, rows);
    this.rowsCache_ = result.rows;
    this.warningsCache_ = result.warnings;
    return this.rowsCache_;

  },

  /**
   * Чистый разбор и валидация редактируемых строк.
   *
   * Численность опциональна (см. подсказку "Можно заполнить позже" на
   * листе): без нее строка все равно участвует в списке отделов и
   * управлений (см. Filters.gs), просто не учитывается в показателях
   * явки. Строка с отсутствующим годом или названием отдела не может
   * быть однозначно отнесена ни к чему — такая строка пропускается, а
   * не валит разбор всего листа: одна опечатка не должна отключать
   * справочник для всех остальных корректных строк (см.
   * Headcount.diagnoseHeadcount для просмотра пропущенных строк).
   */
  parse_(headerRow, dataRows) {

    const indexes = {};
    const missing = [];

    Object.keys(this.COLUMNS).forEach(key => {
      const title = this.COLUMNS[key];
      const index = headerRow.findIndex(value => this.normalizeText_(value) === this.normalizeText_(title));
      if (index === -1) missing.push(title);
      else indexes[key] = index;
    });

    if (missing.length) {
      throw new Error(
        'На листе "' + this.SHEET_NAME + '" отсутствуют обязательные столбцы: ' +
        missing.join(", ") + "."
      );
    }

    const parsed = [];
    const warnings = [];

    dataRows.forEach((row, offset) => {

      const sheetRow = offset + 2;
      const rawYear = row[indexes.YEAR];
      const rawId = row[indexes.DEPARTMENT_ID];
      const rawDivision = row[indexes.DIVISION];
      const rawTeamType = row[indexes.TEAM_TYPE];
      const rawDepartment = row[indexes.DEPARTMENT];
      const rawCount = row[indexes.COUNT];
      const isEmpty = [rawYear, rawId, rawDivision, rawTeamType, rawDepartment, rawCount]
        .every(value => value === "" || value === null || value === undefined);

      if (isEmpty) return;

      const yearText = String(rawYear === null || rawYear === undefined ? "" : rawYear).trim();
      const yearNumber = Number(yearText);
      const validYear = Number.isFinite(yearNumber) && Math.floor(yearNumber) === yearNumber &&
        yearNumber >= 2000 && yearNumber <= 2100;
      const enteredDepartmentId = String(rawId === null || rawId === undefined ? "" : rawId).trim();
      const divisionText = String(rawDivision === null || rawDivision === undefined ? "" : rawDivision).trim();
      // Необязательное поле (см. заголовок модуля, правило 1-4): пустое
      // значение — не ошибка и не отдельная синтетическая группа, а
      // просто "отдел не входит ни в одну группу по типу команды".
      // Отображаемое название сохраняется как введено — нормализация
      // (см. normalizeText_) применяется только при сопоставлении.
      const teamTypeText = String(rawTeamType === null || rawTeamType === undefined ? "" : rawTeamType).trim();
      const department = String(rawDepartment === null || rawDepartment === undefined ? "" : rawDepartment).trim();
      const countProvided = !(rawCount === "" || rawCount === null || rawCount === undefined);
      const count = typeof rawCount === "number" ? rawCount : Number(String(rawCount).trim());
      const validCount = Number.isFinite(count) && count > 0 && Math.floor(count) === count;

      if (!yearText) {
        warnings.push("строка " + sheetRow + ": не указан год — строка пропущена");
        return;
      }
      if (!validYear) {
        warnings.push("строка " + sheetRow + ": год должен быть целым числом от 2000 до 2100 — строка пропущена");
        return;
      }
      if (!department) {
        warnings.push("строка " + sheetRow + ": не указан отдел — строка пропущена");
        return;
      }
      if (countProvided && !validCount) {
        warnings.push("строка " + sheetRow + ": численность должна быть положительным целым числом — учтена без численности");
      }

      // ID нужен только для надежного связывания переименований между
      // годами. Пока пользователь его не заполнил, используем
      // временный ID из названия отдела: аналитика и текущая
      // численность продолжают работать, но разные исторические
      // названия объединятся только после ввода общего ID.
      const departmentId = enteredDepartmentId ||
        (department ? this.initialDepartmentId_(department) : "");

      parsed.push({
        year: String(yearNumber),
        departmentId: departmentId,
        division: divisionText || null,
        teamType: teamTypeText || null,
        department: department,
        count: validCount ? count : null,
        row: sheetRow,
        generatedId: !enteredDepartmentId
      });

    });

    return { rows: parsed, warnings: warnings };

  },

  /**
   * Общий каталог идентичности отделов и годовых записей.
   * entriesByYear[year][id] = {division, count}; nameToId связывает
   * исторические и текущие названия с одним стабильным ID.
   *
   * Расходящаяся строка (то же название на два ID, то же ID/год на два
   * управления) не может быть однозначно разрешена автоматически, но и
   * не должна отключать справочник целиком: побеждает первая встреченная
   * строка, а расхождение уходит в directory.warnings (см.
   * Headcount.diagnoseHeadcount) вместо остановки разбора.
   */
  buildDirectory_() {

    if (this.directory_) return this.directory_;

    const entriesByYear = {};
    const nameToId = {};
    const preferredById = {};
    const warnings = [];

    this.loadRows_().forEach(entry => {

      const idKey = this.normalizeText_(entry.departmentId);
      const resolvedAlias = this.resolveKnownAlias_(entry.department);
      const nameKeys = [
        this.normalizeText_(entry.department),
        this.normalizeText_(resolvedAlias.canonicalName)
      ].filter((value, index, list) => value && list.indexOf(value) === index);

      nameKeys.forEach(nameKey => {
        if (nameToId[nameKey] && nameToId[nameKey] !== idKey) {
          warnings.push(
            'строка ' + entry.row + ': название «' + entry.department + '» уже связано с ID «' +
            nameToId[nameKey] + '», эта строка использует «' + entry.departmentId + '» — оставлен первый ID'
          );
        } else {
          nameToId[nameKey] = idKey;
        }
      });

      const preferred = preferredById[idKey];
      const candidateYear = Number(entry.year);
      const candidateIsAlias = !!resolvedAlias.matchedAlias;

      if (!preferred || candidateYear > preferred.year ||
        (candidateYear === preferred.year && preferred.isAlias && !candidateIsAlias)) {
        preferredById[idKey] = {
          id: entry.departmentId,
          name: resolvedAlias.canonicalName,
          year: candidateYear,
          isAlias: candidateIsAlias
        };
      }

      if (!entriesByYear[entry.year]) entriesByYear[entry.year] = {};
      const existing = entriesByYear[entry.year][idKey];

      if (existing) {
        if (existing.division !== entry.division) {
          warnings.push(
            'строка ' + entry.row + ': ID «' + entry.departmentId + '» за ' + entry.year +
            ' год уже указан в управлении «' + (existing.division || this.UNASSIGNED_LABEL) +
            '», эта строка указывает «' + (entry.division || this.UNASSIGNED_LABEL) + '» — оставлено первое управление'
          );
        } else {
          // Конфликт непустых типов команды у одного ID/года — то же
          // детерминированное правило, что и для управления выше:
          // побеждает первый встреченный непустой тип, расхождение уходит
          // в предупреждение и не останавливает разбор остальных строк.
          // Сравнение — через normalizeText_ (без учета регистра, с trim
          // и схлопыванием повторных пробелов), как и везде в модуле:
          // "Сервисная команда" и " сервисная   команда" — один и тот же
          // тип, а не конфликт (правило 7 — нормализация только для
          // сопоставления, отображаемое название не переписывается).
          if (entry.teamType) {
            if (existing.teamType && this.normalizeText_(existing.teamType) !== this.normalizeText_(entry.teamType)) {
              warnings.push(
                'строка ' + entry.row + ': ID «' + entry.departmentId + '» за ' + entry.year +
                ' год уже указан с типом команды «' + existing.teamType +
                '», эта строка указывает «' + entry.teamType + '» — оставлен первый тип команды'
              );
            } else if (!existing.teamType) {
              existing.teamType = entry.teamType;
            }
          }
          if (entry.count !== null) {
            existing.count = (existing.count || 0) + entry.count;
          }
          existing.names.push(entry.department);
        }
      } else {
        entriesByYear[entry.year][idKey] = {
          id: entry.departmentId,
          idKey: idKey,
          division: entry.division,
          teamType: entry.teamType,
          count: entry.count,
          names: [entry.department]
        };
      }

    });

    this.directory_ = {
      entriesByYear: entriesByYear,
      nameToId: nameToId,
      preferredById: preferredById,
      warnings: (this.warningsCache_ || []).concat(warnings)
    };
    return this.directory_;

  },

  /**
   * Необязательный доступ к справочнику для отчетов и фильтров.
   * Ошибки редактируемого листа не должны останавливать аналитику по
   * ответам: в таком случае численность/явка временно скрываются, а
   * названия отделов обрабатываются через основной реестр алиасов.
   * После того как отдельные некорректные строки стали
   * предупреждениями (см. parse_/buildDirectory_), buildDirectory_()
   * бросает исключение только при структурной проблеме листа —
   * отсутствующих столбцах или полностью пустом листе.
   */
  getDirectory_() {

    if (this.directory_) return this.directory_;
    if (this.directoryError_) return this.fallbackDirectory_;

    try {
      return this.buildDirectory_();
    } catch (error) {
      this.directoryError_ = error;
      this.fallbackDirectory_ = {
        entriesByYear: {},
        nameToId: {},
        preferredById: {},
        warnings: [],
        unavailable: true,
        errorMessage: String(error && error.message ? error.message : error)
      };
      console.warn(
        "Headcount: справочник численности временно не используется; " +
        "основная аналитика продолжена без показателей явки. " +
        this.fallbackDirectory_.errorMessage
      );
      return this.fallbackDirectory_;
    }

  },

  resolveDepartment(departmentName) {

    const directory = this.getDirectory_();
    const raw = String(departmentName || "").trim();
    const canonical = this.resolveKnownAlias_(raw).canonicalName;
    const idKey = directory.nameToId[this.normalizeText_(raw)] ||
      directory.nameToId[this.normalizeText_(canonical)] || null;
    const preferred = idKey ? directory.preferredById[idKey] : null;

    return {
      id: preferred ? preferred.id : null,
      idKey: idKey,
      name: preferred ? preferred.name : canonical,
      known: !!preferred
    };

  },

  departmentKey(departmentName) {
    const resolved = this.resolveDepartment(departmentName);
    return resolved.idKey
      ? "id:" + resolved.idKey
      : "name:" + this.normalizeText_(resolved.name);
  },

  entriesForYear_(year) {
    const byId = this.getDirectory_().entriesByYear[String(year)] || {};
    return Object.keys(byId).map(key => byId[key]);
  },

  hasYear(year) {
    return this.entriesForYear_(year).length > 0;
  },

  availableYears() {
    return Object.keys(this.getDirectory_().entriesByYear).sort((a, b) => Number(b) - Number(a));
  },

  historicalNames(departmentName) {

    const resolved = this.resolveDepartment(departmentName);
    if (!resolved.idKey) return DepartmentAliases.getAliasesFor(resolved.name);

    const names = [];
    const directory = this.getDirectory_();

    Object.keys(directory.entriesByYear).forEach(year => {
      const entry = directory.entriesByYear[year][resolved.idKey];
      if (!entry) return;
      entry.names.forEach(name => {
        if (this.normalizeText_(name) !== this.normalizeText_(resolved.name) && names.indexOf(name) === -1) {
          names.push(name);
        }
      });
    });

    return names;

  },

  forDepartment(year, departmentName) {

    const resolved = this.resolveDepartment(departmentName);
    if (!resolved.idKey) return null;

    const byId = this.getDirectory_().entriesByYear[String(year)] || {};
    const entry = byId[resolved.idKey];

    return entry
      ? { id: entry.id, name: resolved.name, division: entry.division, teamType: entry.teamType || null, count: entry.count }
      : null;

  },

  divisionOf(year, departmentName) {
    const entry = this.forDepartment(year, departmentName);
    return entry ? entry.division : null;
  },

  /**
   * Тип команды отдела за конкретный год (см. заголовок модуля, правило
   * 5 — принадлежность определяется отдельно для каждого года).
   * @returns {String|null} null, если поле не заполнено для этого
   *   отдела/года — это не ошибка (см. правило 3).
   */
  teamTypeOf(year, departmentName) {
    const entry = this.forDepartment(year, departmentName);
    return entry ? entry.teamType : null;
  },

  /**
   * Логическая группа "Управление + Тип команды" (правило 9-10): та же
   * пара типа команды в другом управлении — другая группа. Возвращает
   * null, если у отдела за этот год не указано управление ИЛИ тип
   * команды — отдел в этом случае не входит ни в одну группу, но
   * продолжает участвовать в расчетах компании/управления/отдела
   * (см. Segments.splitBy/analyze).
   * @returns {String|null} "Управление разработки ПО → Сервисная команда"
   */
  teamGroupOf(year, departmentName) {
    const entry = this.forDepartment(year, departmentName);
    if (!entry || !entry.division || !entry.teamType) return null;
    return entry.division + this.TEAM_GROUP_SEPARATOR + entry.teamType;
  },

  forDivision(year, divisionName) {

    const isUnassigned = this.normalizeText_(divisionName) === this.normalizeText_(this.UNASSIGNED_LABEL);
    const count = this.entriesForYear_(year).reduce((sum, entry) => {
      const belongs = isUnassigned
        ? entry.division === null
        : this.normalizeText_(entry.division) === this.normalizeText_(divisionName);
      return belongs ? sum + entry.count : sum;
    }, 0);

    return { count: count };

  },

  /**
   * Численность одной группы "Управление + Тип команды" (см.
   * teamGroupOf) — сумма численности всех явно отнесенных к ней
   * отделов за этот год. Отделы без управления или без типа команды
   * не попадают ни в одну группу и в сумму не входят (правило 3).
   */
  forTeamGroup(year, groupLabel) {

    const target = this.normalizeText_(groupLabel);
    const count = this.entriesForYear_(year).reduce((sum, entry) => {
      if (!entry.division || !entry.teamType) return sum;
      const label = entry.division + this.TEAM_GROUP_SEPARATOR + entry.teamType;
      return this.normalizeText_(label) === target ? sum + entry.count : sum;
    }, 0);

    return { count: count };

  },

  /**
   * Все непустые группы "Управление + Тип команды", реально
   * встречающиеся в справочнике за этот год — источник вариантов для
   * производного фильтра/среза "Группа команд" (см. Filters.gs,
   * AnalyticsService.build). Список не хардкодится (правило 8):
   * состав всегда читается с листа "Численность".
   */
  listTeamGroups(year) {

    const seen = {};
    const groups = [];

    this.entriesForYear_(year).forEach(entry => {
      if (!entry.division || !entry.teamType) return;
      const label = entry.division + this.TEAM_GROUP_SEPARATOR + entry.teamType;
      const key = this.normalizeText_(label);
      if (!seen[key]) {
        seen[key] = true;
        groups.push(label);
      }
    });

    return groups.sort((a, b) => a.localeCompare(b, "ru"));

  },

  listDivisions(year) {

    const seen = {};
    const divisions = [];

    this.entriesForYear_(year).forEach(entry => {
      const key = this.normalizeText_(entry.division);
      if (entry.division && !seen[key]) {
        seen[key] = true;
        divisions.push(entry.division);
      }
    });

    return divisions.sort((a, b) => a.localeCompare(b, "ru"));

  },

  listDepartments(year) {

    const directory = this.getDirectory_();
    const entries = year ? this.entriesForYear_(year) : Object.keys(directory.preferredById).map(idKey => ({ idKey: idKey }));

    return entries.map(entry => directory.preferredById[entry.idKey].name)
      .filter((value, index, list) => list.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, "ru"));

  },

  total(year) {
    const entries = this.entriesForYear_(year);
    return entries.length ? entries.reduce((sum, entry) => sum + entry.count, 0) : null;
  },

  /**
   * Знаменатель для отчета с фильтрами. Точный процент возможен только
   * без фильтров либо при фильтрах по отделу/управлению: для города,
   * стажа, оценок и других признаков численность приглашенных в
   * справочнике не разбита, поэтому процент намеренно не вычисляется.
   */
  invitedForFilters(year, filters) {

    const active = (filters || []).filter(filter => {
      if (Array.isArray(filter.values)) return filter.values.length > 0;
      return filter.value !== "" && filter.value !== null && filter.value !== undefined;
    });
    const supported = active.every(filter => {
      const title = this.normalizeText_(filter.question);
      return title === this.normalizeText_("Отдел") || title === this.normalizeText_("Управление") ||
        title === this.normalizeText_("Группа команд");
    });

    if (!supported) return { count: null, supported: false };

    const departmentKeys = {};
    const divisionKeys = {};
    const groupKeys = {};
    let hasDepartmentFilter = false;
    let hasDivisionFilter = false;
    let hasGroupFilter = false;

    active.forEach(filter => {
      const title = this.normalizeText_(filter.question);
      if (title === this.normalizeText_("Отдел")) {
        hasDepartmentFilter = true;
        (filter.values || []).forEach(value => { departmentKeys[this.departmentKey(value)] = true; });
      } else if (title === this.normalizeText_("Управление")) {
        hasDivisionFilter = true;
        (filter.values || []).forEach(value => { divisionKeys[this.normalizeText_(value)] = true; });
      } else if (title === this.normalizeText_("Группа команд")) {
        hasGroupFilter = true;
        (filter.values || []).forEach(value => { groupKeys[this.normalizeText_(value)] = true; });
      }
    });

    // "Управление + Группа команд + Отдел" пересекаются через И (правило
    // 11): отдел без указанного типа команды не имеет группы (label ===
    // null) и поэтому никогда не совпадает ни с одним значением фильтра
    // "Группа команд" — пустые типы в сумму приглашенных не входят.
    const selected = this.entriesForYear_(year).filter(entry => {
      const departmentMatches = !hasDepartmentFilter || departmentKeys["id:" + entry.idKey];
      const divisionLabel = entry.division || this.UNASSIGNED_LABEL;
      const divisionMatches = !hasDivisionFilter || divisionKeys[this.normalizeText_(divisionLabel)];
      const groupLabel = (entry.division && entry.teamType)
        ? entry.division + this.TEAM_GROUP_SEPARATOR + entry.teamType
        : null;
      const groupMatches = !hasGroupFilter || (groupLabel !== null && groupKeys[this.normalizeText_(groupLabel)]);
      return departmentMatches && divisionMatches && groupMatches;
    });

    return {
      count: selected.length ? selected.reduce((sum, entry) => sum + entry.count, 0) : null,
      supported: true
    };

  },

  normalizeText_(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  },

  UNASSIGNED_LABEL: "Не отнесено к управлению",

  resetCache_() {
    this.rowsCache_ = null;
    this.warningsCache_ = null;
    this.directory_ = null;
    this.directoryError_ = null;
    this.fallbackDirectory_ = null;
  }

};

/**
 * Диагностика для меню: строгий buildDirectory_() вместо тихого
 * getDirectory_() — показывает точную причину, по которой справочник
 * численности мог молча отключиться (см. Headcount.getDirectory_).
 */
function diagnoseHeadcount() {
  const ui = SpreadsheetApp.getUi();
  Headcount.resetCache_();

  try {
    const directory = Headcount.buildDirectory_();
    const years = Object.keys(directory.entriesByYear).sort();
    const summary = years.map(year => {
      const divisions = Headcount.listDivisions(year);
      return year + ': ' + (divisions.length ? divisions.join(', ') : '(управлений нет)');
    }).join('\n');

    const warningsBlock = directory.warnings.length
      ? '\n\nПропущенные/неоднозначные строки (не мешают остальным данным):\n' + directory.warnings.join('\n')
      : '';

    ui.alert('Численность: справочник работает.\n\n' + summary + warningsBlock);
  } catch (error) {
    ui.alert('Численность: справочник отключен из-за структурной проблемы листа.\n\n' + error.message);
  }
}

function openHeadcountSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = Headcount.ensureSheet();
  spreadsheet.setActiveSheet(sheet);
  spreadsheet.toast(
    'Можно заполнить позже. Для переименованного отдела используйте одинаковый ID в обоих годах.',
    'Численность',
    7
  );
}
