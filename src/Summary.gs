/**
 * ==========================================================
 * Сводная аналитика
 * ==========================================================
 *
 * Отдельный долгоживущий лист: одна строка — одна выборка, столбцы —
 * ее основные показатели. Обновляется после каждого построения отчета.
 *
 * Ничего не считает. Получает уже готовый reportData — тот же объект,
 * из которого строится детальный отчет, — и только раскладывает его
 * значения по ячейкам. Statistics, Comparison и FilterEngine отсюда не
 * вызываются ни разу.
 *
 * Структура листа фиксирована (COLUMNS): состав анкеты не меняется,
 * поэтому здесь нет ни определения столбцов по данным, ни дописывания
 * новых столбцов на ходу. Порядок столбцов в COLUMNS — это и есть
 * порядок столбцов на листе.
 *
 * Отличие от ReportBuilder по модели жизни листа: отчет удаляется и
 * пересоздается целиком при каждой сборке, а этот лист, наоборот,
 * создается один раз и дальше только накапливает и обновляет строки.
 */

const Summary = {

  // Название дается листу только при создании. Найти его потом по имени
  // нельзя — пользователь волен переименовать лист, поэтому он помечается
  // developer metadata и ищется по ней (тот же прием, что и у листов
  // отчетов, см. ReportBuilder.REPORT_KEY_METADATA_KEY).
  SHEET_NAME: "Сводная аналитика",

  SHEET_METADATA_KEY: "hranalytics_summary_sheet",

  // Строка 1 — названия блоков, строка 2 — названия столбцов,
  // данные начинаются с третьей строки.
  BLOCK_ROW: 1,
  HEADER_ROW: 2,
  FIRST_DATA_ROW: 3,

  // Скрытый служебный столбец с ключом выборки (см. buildSampleKey_).
  // Столбцы COLUMNS идут сразу после него.
  KEY_COLUMN: 1,

  // Моноширинный шрифт для ячеек с распределениями и Топ-5: только он
  // дает ровные колонки внутри одной ячейки, где значения выравниваются
  // пробелами (в пропорциональном шрифте они бы "поехали").
  MONO_FONT: "Roboto Mono",

  // Ширины столбцов по типу содержимого.
  WIDTH_: {
    sample: 220,
    number: 90,
    distribution: 300,
    top: 300,
    average: 80,
    headcount: 100,
    responseRate: 90
  },

  /**
   * Фиксированный состав и порядок столбцов сводной.
   *
   * question — точное название вопроса в каталоге Questions.gs, по нему
   * ищутся данные; title — подпись столбца на листе (у одного вопроса
   * она может быть короче, чтобы шапка оставалась читаемой).
   */
  COLUMNS: [

    { block: "Основное", title: "Выборка", kind: "sample" },
    // Год берется из source строки (reportData.source), а не фиксирован:
    // с тех пор как "Ответы 2026" и "Ответы 2025" стали разными строками
    // (см. buildSampleKey_), у каждой строки один источник, и размер
    // выборки должен соответствовать именно ему.
    { block: "Основное", title: "Размер выборки", kind: "employees" },

    { block: "eNPS", title: "eNPS 2026", kind: "enps", year: "2026" },
    { block: "eNPS", title: "eNPS 2025", kind: "enps", year: "2025" },
    { block: "eNPS", title: "Δ", kind: "enpsDelta" },

    { block: "Демография", title: "Стаж", kind: "distribution", question: "Стаж" },
    { block: "Демография", title: "Формат работы", kind: "distribution", question: "Формат работы" },

    { block: "Распределения", title: "Work-life balance", kind: "distribution", question: "Work-life balance" },
    { block: "Распределения", title: "Задачи", kind: "distribution", question: "Задачи" },
    { block: "Распределения", title: "Ожидания", kind: "distribution", question: "Ожидания" },
    { block: "Распределения", title: "Проф мнение", kind: "distribution", question: "Проф мнение" },
    { block: "Распределения", title: "Возможности роста", kind: "distribution", question: "Возможности роста" },
    { block: "Распределения", title: "ОС от руководителя", kind: "distribution", question: "ОС от руководителя" },
    { block: "Распределения", title: "Выгорание", kind: "distribution", question: "Выгорание" },
    { block: "Распределения", title: "Смена работы", kind: "distribution", question: "Смена работы" },
    { block: "Распределения", title: "Ценности", kind: "distribution", question: "Ценности" },
    { block: "Распределения", title: "О жизни компании", kind: "distribution", question: "О жизни компании" },
    { block: "Распределения", title: "Цели компании", kind: "distribution", question: "Цели компании" },
    { block: "Распределения", title: "Вклад", kind: "distribution", question: "Вклад" },
    { block: "Распределения", title: "Атмосфера в отделе", kind: "distribution", question: "Атмосфера в отделе" },
    { block: "Распределения", title: "Межкомандное взаимодействие", kind: "distribution", question: "Межкомандное взаимодействие" },
    { block: "Распределения", title: "Неформальное общение", kind: "distribution", question: "Неформальное общение" },
    { block: "Распределения", title: "Решение споров", kind: "distribution", question: "Решение споров" },

    { block: "Top-5", title: "Ценишь в компании", kind: "top", question: "Ценишь в компании" },
    { block: "Top-5", title: "Зоны роста компании", kind: "top", question: "Зоны роста компании" },

    { block: "Средние оценки", title: "Рабочий стол", kind: "average", question: "Рабочий стол" },
    { block: "Средние оценки", title: "Рабочее кресло", kind: "average", question: "Рабочее кресло" },
    { block: "Средние оценки", title: "Расположение рабочего места", kind: "average", question: "Расположение рабочего места" },
    { block: "Средние оценки", title: "Офисное пространство", kind: "average", question: "Офисное пространство" },
    { block: "Средние оценки", title: "Отдых в офисе", kind: "average", question: "Отдых в офисе" },
    { block: "Средние оценки", title: "Переговорки", kind: "average", question: "Переговорки" },
    { block: "Средние оценки", title: "Питание", kind: "average", question: "Питание и возможность перекусить, выпить чай, кофе" },
    { block: "Средние оценки", title: "Атмосфера в офисе", kind: "average", question: "Атмосфера в офисе" },
    { block: "Средние оценки", title: "Рабочая техника", kind: "average", question: "Рабочая техника" },
    { block: "Средние оценки", title: "Корпоративы", kind: "average", question: "Корпоративы" },
    { block: "Средние оценки", title: "Обучение", kind: "average", question: "Обучение" },
    { block: "Средние оценки", title: "Курсы английского", kind: "average", question: "Курсы английского" },
    { block: "Средние оценки", title: "ДМС", kind: "average", question: "ДМС" },
    { block: "Средние оценки", title: "Мерч за достижения", kind: "average", question: "Мерч за достижения" },
    { block: "Средние оценки", title: "Удовл. раб. задачами", kind: "average", question: "Удовлетворенность рабочими задачами" },
    { block: "Средние оценки", title: "ЗП", kind: "average", question: "ЗП" },

    // Добавлены в конец, чтобы существующий сводный лист можно было
    // безопасно расширить без сдвига уже накопленных данных.
    { block: "Явка", title: "Приглашены", kind: "headcount" },
    { block: "Явка", title: "Явка, %", kind: "responseRate" },

    // Company-wide сигналы из расширенного контура для этого же среза
    // (см. src/SegmentContext.gs) — пусто, если фильтр отчета не бьет
    // однозначно в один бакет измерения (отдел/стаж/город/...).
    { block: "Контекст по компании", title: "Отклонения (расш. контур)", kind: "segmentContext" }

  ],

  /**
   * Обновить сводную по только что построенному отчету — единственная
   * точка входа модуля.
   *
   * @param {Object} reportData - тот же объект, из которого построен отчет
   * @param {Sheet} sheet - лист построенного отчета (для названия и ссылки)
   */
  update(reportData, sheet) {

    const summarySheet = this.ensureSheet_();

    // Перед любой записью — проверка структуры листа. Если он изменен
    // так, что запись может испортить данные, обновление прекращается с
    // понятным сообщением, и лист остается нетронутым. Молча дописать
    // строку вслепую хуже, чем показать ошибку: пользователь заметит
    // испорченные данные гораздо позже, чем сообщение.
    const problem = this.checkStructure_(summarySheet);

    if (problem) {
      throw new Error(problem);
    }

    const key = this.buildSampleKey_(reportData);
    const row = this.findRow_(summarySheet, key) || this.appendRow_(summarySheet);

    const lookups = this.buildLookups_(reportData);
    const values = [key].concat(this.COLUMNS.map(column => this.buildCellValue_(column, reportData, lookups, sheet)));

    // Вся строка пишется одним вызовом — 43 отдельных setValue на каждую
    // пересборку отчета упирались бы в лимиты Apps Script.
    summarySheet.getRange(row, 1, 1, values.length).setValues([values]);

    this.formatRow_(summarySheet, row);

    // Подсветка проблемных выборок (см. Heatmap.gs) — отдельный шаг
    // после того, как строка записана: сначала сохраняем данные новой
    // строки (recordRow), затем пересчитываем заливку по всему листу
    // сразу (apply), потому что подсветка одной выборки зависит от
    // значений остальных.
    Heatmap.recordRow(summarySheet, row, this.KEY_COLUMN, this.COLUMNS, lookups.distributions);
    Heatmap.apply(summarySheet, this.COLUMNS, this.KEY_COLUMN, this.FIRST_DATA_ROW);

    // Строки без отчета (лист удален пользователем) убираются последним
    // шагом, уже после того, как текущая строка дописана и ее ссылка
    // указывает на актуальный (пере)созданный лист — иначе, если этот же
    // отчет только что пересобран, ReportBuilder успевает удалить старый
    // лист до этого места, старая ссылка строки на мгновение "протухает",
    // и строку удалило бы саму себя вместо простого обновления на месте.
    this.pruneDeletedSamples_(summarySheet);

  },

  /**
   * Обновить текст гиперссылок в столбце "Выборка", если лист отчета
   * был переименован вручную. Ссылка (gid) остается рабочей, но
   * отображаемое название устаревает — здесь оно подтягивается из
   * текущего sheet.getName().
   */
  syncSampleNames(ss) {

    const sheet = this.findSheetByMetadata_(ss);

    if (!sheet) {
      return;
    }

    const lastRow = sheet.getLastRow();

    if (lastRow < this.FIRST_DATA_ROW) {
      return;
    }

    const sampleColumn = this.KEY_COLUMN + 1;
    const rowCount = lastRow - this.FIRST_DATA_ROW + 1;

    const formulas = sheet
      .getRange(this.FIRST_DATA_ROW, sampleColumn, rowCount, 1)
      .getFormulas();

    const displayed = sheet
      .getRange(this.FIRST_DATA_ROW, sampleColumn, rowCount, 1)
      .getDisplayValues();

    const sheetsById = {};
    ss.getSheets().forEach(function (s) { sheetsById[String(s.getSheetId())] = s; });

    for (var i = 0; i < rowCount; i++) {

      var gid = this.extractGid_(formulas[i][0]);

      if (gid === null) {
        continue;
      }

      var target = sheetsById[gid];

      if (!target) {
        continue;
      }

      if (displayed[i][0] !== target.getName()) {
        sheet.getRange(this.FIRST_DATA_ROW + i, sampleColumn)
          .setFormula(this.buildSampleLink_(target));
      }

    }

  },

  /**
   * Лист сводной: найти по метке или создать и оформить.
   * В отличие от листа отчета никогда не пересоздается — иначе
   * потерялись бы строки всех остальных выборок.
   *
   * Поиск идет по developer metadata, а не по имени: пользователь может
   * переименовать лист, и это не должно приводить к появлению второго
   * листа сводной, пока первый копит строки.
   */
  ensureSheet_() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existing = this.findSheetByMetadata_(ss);

    if (existing) {
      this.migrateCoverageColumns_(existing);
      return existing;
    }

    // Имя может быть занято посторонним листом — getUniqueSheetName
    // подберет свободное, а находить лист все равно будем по метке.
    const sheet = ss.insertSheet(
      ReportBuilder.getUniqueSheetName(ss, this.SHEET_NAME),
      0
    );

    sheet.addDeveloperMetadata(this.SHEET_METADATA_KEY, this.SHEET_METADATA_KEY);

    // Новый лист создается с 26 столбцами по умолчанию, а сводной нужно
    // 42: обращение к диапазону за границей сетки — ошибка, а не
    // автоматическое расширение.
    const missingColumns = this.totalColumns_() - sheet.getMaxColumns();

    if (missingColumns > 0) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
    }

    this.renderHeader_(sheet);

    return sheet;

  },

  /**
   * Безопасная миграция сводной предыдущего формата: два новых столбца
   * добавляются только если вся старая шапка совпадает и справа нет
   * пользовательских столбцов. Существующие данные не сдвигаются.
   */
  migrateCoverageColumns_(sheet) {

    const addedColumns = 2;
    const legacyColumns = this.COLUMNS.slice(0, this.COLUMNS.length - addedColumns);
    const legacyTotalColumns = legacyColumns.length + 1;
    const lastColumn = sheet.getLastColumn();

    if (lastColumn === this.totalColumns_() || lastColumn !== legacyTotalColumns) return;

    const actualTitles = sheet
      .getRange(this.HEADER_ROW, this.KEY_COLUMN + 1, 1, legacyColumns.length)
      .getValues()[0];
    const titlesMatch = legacyColumns.every(
      (column, index) => String(actualTitles[index]) === column.title
    );

    if (!titlesMatch) return;

    const missingColumns = this.totalColumns_() - sheet.getMaxColumns();
    if (missingColumns > 0) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
    }

    this.renderHeaderValues_(sheet);
    for (let index = this.COLUMNS.length - addedColumns; index < this.COLUMNS.length; index++) {
      const column = this.COLUMNS[index];
      sheet.setColumnWidth(this.KEY_COLUMN + 1 + index, this.WIDTH_[column.kind] || this.WIDTH_.number);
    }

  },

  /**
   * Помеченный лист сводной, если он есть в книге.
   */
  findSheetByMetadata_(ss) {

    const matches = ss.createDeveloperMetadataFinder()
      .withKey(this.SHEET_METADATA_KEY)
      .find();

    return matches.length > 0 ? matches[0].getLocation().getSheet() : null;

  },

  /**
   * Шапка: строка блоков, строка названий столбцов, ширины, заморозка.
   * Пишется один раз при создании листа.
   */
  renderHeader_(sheet) {

    this.renderHeaderValues_(sheet);

    this.COLUMNS.forEach((column, index) => {
      sheet.setColumnWidth(this.KEY_COLUMN + 1 + index, this.WIDTH_[column.kind] || this.WIDTH_.number);
    });

    // Ключ выборки — служебное поле, пользователю оно не нужно.
    sheet.hideColumns(this.KEY_COLUMN);

    // Шапка и название выборки остаются на виду при прокрутке вправо:
    // без этого на сорока с лишним столбцах непонятно, чья это строка.
    Formatter.freezeHeader(sheet, this.HEADER_ROW, this.KEY_COLUMN + 1);

  },

  /**
   * Ожидаемое содержимое двух строк шапки: названия блоков и названия
   * столбцов. Название блока ставится только над его первым столбцом —
   * остальные ячейки блока пустые, чтобы шапка читалась как группировка.
   */
  buildHeaderRows_() {

    const blocks = this.COLUMNS.map((column, index) =>
      (index === 0 || this.COLUMNS[index - 1].block !== column.block) ? column.block : ""
    );

    return [blocks, this.COLUMNS.map(column => column.title)];

  },

  /**
   * Записать и оформить сами строки шапки. Отделено от renderHeader_,
   * потому что вызывается еще и при восстановлении заголовков — там
   * ширины столбцов, скрытие и заморозка уже настроены и не трогаются.
   */
  renderHeaderValues_(sheet) {

    const rows = this.buildHeaderRows_();

    sheet
      .getRange(this.BLOCK_ROW, this.KEY_COLUMN + 1, rows.length, this.COLUMNS.length)
      .setValues(rows);

    const headerRange = sheet.getRange(this.BLOCK_ROW, 1, rows.length, this.totalColumns_());
    Formatter.applyBaseFont(headerRange);
    Formatter.formatTableHeader(headerRange);

    sheet.getRange(this.BLOCK_ROW, 1, 1, this.totalColumns_()).setFontSize(11);

  },

  /**
   * Полное число столбцов листа вместе со служебным.
   */
  totalColumns_() {
    return this.COLUMNS.length + 1;
  },

  // Общий хвост всех сообщений о поврежденной структуре: что делать
  // дальше. Удаление листа безопасно — он создастся заново, а строки
  // вернутся по мере пересборки отчетов.
  RECOVERY_HINT_: " Отмените изменение (Ctrl+Z) или удалите лист — он будет создан заново, " +
    "а строки вернутся по мере пересборки отчетов.",

  /**
   * Проверить структуру листа перед записью и, если это безопасно,
   * восстановить только заголовки.
   *
   * Возвращает null, когда писать можно, либо текст проблемы, когда лист
   * изменен так, что запись тихо испортила бы данные: дописала бы
   * строку-дубликат (ключи выборок больше не находятся на своих местах)
   * или наложила бы значения на сдвинувшиеся столбцы.
   *
   * Заголовки восстанавливаются ТОЛЬКО после того, как все структурные
   * проверки пройдены — то есть когда точно известно, что изменился лишь
   * текст шапки, а не расположение данных. Во всех остальных случаях
   * лист не трогается вообще: что именно удалил пользователь, неизвестно,
   * и "починка" вслепую испортила бы данные необратимо.
   */
  checkStructure_(sheet) {

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    // Лист пуст (например, пользователь очистил его целиком) — терять
    // нечего, шапку можно просто написать заново.
    if (lastRow === 0) {
      this.renderHeaderValues_(sheet);
      return null;
    }

    // 1. Ширина. Удаленный или вставленный столбец сдвигает все данные
    // вбок, и значения легли бы не в свои столбцы.
    if (lastColumn !== this.totalColumns_()) {
      return "на листе \"" + sheet.getName() + "\" изменилось число столбцов: ожидается " +
        this.totalColumns_() + ", сейчас " + lastColumn +
        ". Данные могли сдвинуться, поэтому запись остановлена." + this.RECOVERY_HINT_;
    }

    // 2. Вертикальный сдвиг. Если в строках шапки оказался ключ выборки,
    // значит строки уехали вверх — восстановление шапки затерло бы
    // данные, а поиск строк шел бы не с той строки.
    const headerColumn = sheet
      .getRange(this.BLOCK_ROW, this.KEY_COLUMN, this.FIRST_DATA_ROW - 1, 1)
      .getValues();

    if (headerColumn.some(row => this.isSampleKey_(row[0]))) {
      return "на листе \"" + sheet.getName() + "\" сдвинуты строки: в шапке оказались данные выборки. " +
        "Запись остановлена, чтобы их не затереть." + this.RECOVERY_HINT_;
    }

    // 3. Служебный столбец. Каждая строка данных обязана начинаться с
    // ключа выборки — именно по нему строка находится и обновляется.
    // Если там что-то другое, ни одна строка не найдется и каждая
    // пересборка добавляла бы дубликат.
    if (lastRow >= this.FIRST_DATA_ROW) {

      const keys = sheet
        .getRange(this.FIRST_DATA_ROW, this.KEY_COLUMN, lastRow - this.FIRST_DATA_ROW + 1, 1)
        .getValues();

      if (keys.some(row => !this.isSampleKey_(row[0]))) {
        return "на листе \"" + sheet.getName() + "\" поврежден служебный столбец с ключами выборок — " +
          "непонятно, какую строку обновлять. Запись остановлена." + this.RECOVERY_HINT_;
      }

    }

    // 4. Заголовки. Структура цела, значит расхождение может быть только
    // в тексте шапки — его безопасно переписать, не задев данные.
    if (!this.headerMatches_(sheet)) {
      this.renderHeaderValues_(sheet);
    }

    return null;

  },

  /**
   * Совпадает ли шапка листа с ожидаемой.
   */
  headerMatches_(sheet) {

    const expected = this.buildHeaderRows_();

    const actual = sheet
      .getRange(this.BLOCK_ROW, this.KEY_COLUMN + 1, expected.length, this.COLUMNS.length)
      .getValues();

    return expected.every((row, rowIndex) =>
      row.every((value, index) => String(actual[rowIndex][index]) === value)
    );

  },

  /**
   * Похоже ли значение служебной ячейки на ключ выборки. Ключ — это
   * всегда JSON-объект вида {source, filters} (см. buildSampleKey_), где
   * filters — нормализованный массив фильтров, в том числе пустой у
   * выборки без фильтров. Ничто другое, что может оказаться в этой
   * ячейке после сдвига строк или столбцов (название выборки, число,
   * формула, пустая ячейка), под это описание не подходит.
   */
  isSampleKey_(value) {

    const text = String(value).trim();

    if (text.charAt(0) !== "{") {
      return false;
    }

    try {
      const parsed = JSON.parse(text);
      return !!parsed && typeof parsed.source === "string" && Array.isArray(parsed.filters);
    } catch (error) {
      return false;
    }

  },

  /**
   * Удалить строки, чей лист детального отчета больше не существует
   * (пользователь удалил его вручную) — "нет листа = нет строки".
   *
   * Отдельного идентификатора листа строка не хранит: вместо этого gid
   * читается из уже записанной гиперссылки в столбце "Выборка"
   * (buildSampleLink_ кладет туда "...#gid=<id>..."), поэтому правило
   * работает и для строк, записанных до появления этой функции — им не
   * нужна отдельная миграция.
   *
   * Строки удаляются снизу вверх, чтобы удаление одной не сдвигало еще
   * не проверенные номера строк.
   */
  pruneDeletedSamples_(sheet) {

    const lastRow = sheet.getLastRow();

    if (lastRow < this.FIRST_DATA_ROW) {
      return;
    }

    const rowCount = lastRow - this.FIRST_DATA_ROW + 1;
    const sampleColumn = this.KEY_COLUMN + 1;

    const formulas = sheet
      .getRange(this.FIRST_DATA_ROW, sampleColumn, rowCount, 1)
      .getFormulas();

    const existingGids = new Set(
      SpreadsheetApp.getActiveSpreadsheet().getSheets().map(s => String(s.getSheetId()))
    );

    for (let offset = rowCount - 1; offset >= 0; offset--) {

      const gid = this.extractGid_(formulas[offset][0]);

      // Строка без распознанной ссылки не трогается — удалять можно
      // только то, что точно ведет на несуществующий лист, а не любую
      // строку с непонятным содержимым столбца "Выборка".
      if (gid !== null && !existingGids.has(gid)) {
        sheet.deleteRow(this.FIRST_DATA_ROW + offset);
      }

    }

  },

  /**
   * gid листа отчета из формулы HYPERLINK в столбце "Выборка"
   * (см. buildSampleLink_), либо null, если формула не распознана.
   */
  extractGid_(formula) {

    const match = /#gid=(\d+)/.exec(String(formula || ""));

    return match ? match[1] : null;

  },

  /**
   * Ручная точка входа для меню: убрать строки без отчета, не строя
   * новый отчет. Возвращает число удаленных строк (0, если листа
   * сводной еще нет или удалять нечего).
   */
  pruneDeletedSamples() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = this.findSheetByMetadata_(ss);

    if (!sheet) {
      return 0;
    }

    const problem = this.checkStructure_(sheet);

    if (problem) {
      throw new Error(problem);
    }

    const before = sheet.getLastRow();

    this.pruneDeletedSamples_(sheet);

    return Math.max(0, before - sheet.getLastRow());

  },

  /**
   * Номер строки выборки с этим ключом или null, если ее еще нет.
   * Ключи читаются одним вызовом, а не по ячейке.
   */
  findRow_(sheet, key) {

    const lastRow = sheet.getLastRow();

    if (lastRow < this.FIRST_DATA_ROW) {
      return null;
    }

    const keys = sheet
      .getRange(this.FIRST_DATA_ROW, this.KEY_COLUMN, lastRow - this.FIRST_DATA_ROW + 1, 1)
      .getValues();

    for (let index = 0; index < keys.length; index++) {
      if (keys[index][0] === key) {
        return this.FIRST_DATA_ROW + index;
      }
    }

    return null;

  },

  /**
   * Номер новой строки в конце листа.
   */
  appendRow_(sheet) {

    return Math.max(sheet.getLastRow() + 1, this.FIRST_DATA_ROW);

  },

  /**
   * Оформление одной строки данных: моноширинный шрифт для ячеек с
   * распределениями и Топ-5 (в них значения выравниваются пробелами),
   * обычный — для остальных, и выравнивание содержимого по верхнему
   * краю, иначе высокие многострочные ячейки растянут всю строку.
   */
  formatRow_(sheet, row) {

    const range = sheet.getRange(row, 1, 1, this.COLUMNS.length + 1);

    Formatter.applyBaseFont(range);
    range.setVerticalAlignment("top");

    this.COLUMNS.forEach((column, index) => {

      if (column.kind !== "distribution" && column.kind !== "top") {
        return;
      }

      sheet
        .getRange(row, this.KEY_COLUMN + 1 + index)
        .setFontFamily(this.MONO_FONT)
        .setFontSize(9);

    });

  },

  /**
   * Ключ строки — источник данных ("2026"/"2025") плюс нормализованный
   * набор фильтров выборки. Источник входит в ключ намеренно: отчеты
   * "Ответы 2026" и "Ответы 2025" — это разные отчеты на разных листах,
   * и с одинаковыми фильтрами они обязаны занимать разные строки.
   * Флаг "Сравнить с 2025" в ключ по-прежнему НЕ входит — он влияет
   * только на отображение отчета, а не на то, какая это выборка, поэтому
   * пересборка одного и того же отчета с разным значением флага
   * по-прежнему обновляет одну и ту же строку.
   * Нормализацию фильтров делает ReportBuilder.getNormalizedFilters — она
   * же используется сигнатурой самого отчета, поэтому "одинаковость"
   * выборки понимается в обоих местах одинаково.
   */
  buildSampleKey_(reportData) {

    const keyObject = {
      source: reportData.source,
      filters: ReportBuilder.getNormalizedFilters(reportData.filters)
    };

    // Как и в ReportBuilder.getReportKey_: cohortOnly входит в ключ,
    // только когда он включен, поэтому ключи уже существующих строк
    // обычных отчетов (без этого поля) продолжают читаться как прежде,
    // а когортная выборка получает СВОЮ строку — даже с теми же
    // фильтрами, что и обычный отчет за 2026.
    if (reportData.cohortOnly) {
      keyObject.cohortOnly = true;
    }

    return JSON.stringify(keyObject);

  },

  /**
   * Словари "название вопроса -> уже посчитанные данные". Ничего не
   * пересчитывают, только группируют то, что уже есть в reportData
   * (тот же прием, что и ReportBuilder.buildDetailLookups_).
   */
  buildLookups_(reportData) {

    const distributions = {};
    (reportData.distributions || []).forEach(entry => {
      distributions[entry.question.title] = entry.items;
    });

    const topAnswers = {};
    (reportData.topAnswers || []).forEach(entry => {
      topAnswers[entry.question.title] = entry.items;
    });

    const averages = {};
    (reportData.averageRatings || []).forEach(item => {
      averages[item.question] = item;
    });

    return { distributions: distributions, topAnswers: topAnswers, averages: averages };

  },

  buildCellValue_(column, reportData, lookups, sheet) {

    if (column.kind === "sample") {
      return this.buildSampleLink_(sheet);
    }

    if (column.kind === "employees") {
      const employees = reportData.employeesByYear
        ? reportData.employeesByYear[reportData.source]
        : null;
      return (employees === null || employees === undefined) ? "" : employees;
    }

    if (column.kind === "headcount") {
      const value = reportData.headcountByYear
        ? reportData.headcountByYear[reportData.source]
        : null;
      return (value === null || value === undefined) ? "" : value;
    }

    if (column.kind === "responseRate") {
      const value = reportData.responseRateByYear
        ? reportData.responseRateByYear[reportData.source]
        : null;
      return (value === null || value === undefined) ? "" : value;
    }

    if (column.kind === "enps") {
      const value = this.enpsValue_(reportData, column.year);
      return value === null ? "" : value;
    }

    if (column.kind === "enpsDelta") {
      const delta = this.enpsDelta_(reportData);
      return delta === null ? "" : delta;
    }

    if (column.kind === "distribution") {
      return this.formatDistribution_(lookups.distributions[column.question]);
    }

    if (column.kind === "top") {
      return this.formatTopAnswers_(lookups.topAnswers[column.question]);
    }

    if (column.kind === "average") {
      return this.formatAverage_(lookups.averages[column.question]);
    }

    if (column.kind === "segmentContext") {
      return this.formatSegmentContext_(reportData.segmentContext);
    }

    throw new Error("Summary: неизвестный тип столбца \"" + column.kind + "\"");

  },

  /**
   * Гиперссылка на лист отчета. Ссылка строится по идентификатору листа,
   * а не по его названию: ReportBuilder при пересборке удаляет лист и
   * создает новый, поэтому идентификатор меняется — и ссылка
   * перезаписывается вместе со всей строкой при каждом обновлении.
   */
  buildSampleLink_(sheet) {

    const url = SpreadsheetApp.getActiveSpreadsheet().getUrl() + "#gid=" + sheet.getSheetId();

    return "=HYPERLINK(\"" + url + "\";\"" + this.escapeFormulaText_(sheet.getName()) + "\")";

  },

  escapeFormulaText_(text) {
    return String(text).replace(/"/g, "\"\"");
  },

  /**
   * eNPS за конкретный год из уже посчитанного reportData.enpsByYear.
   * null, если данных за этот год нет вовсе (нет листа) или в выборке
   * нет ни одного валидного ответа — в этом случае показывать "0" было
   * бы враньем. Условие total > 0 — то же, по которому значение года
   * считается отсутствующим в Comparison.compareENPS.
   */
  enpsValue_(reportData, year) {

    const enps = reportData.enpsByYear ? reportData.enpsByYear[year] : null;

    return (enps && enps.total > 0) ? enps.enps : null;

  },

  /**
   * Динамика eNPS в процентных пунктах — арифметическая разница двух
   * значений из соседних столбцов, а не новый расчет. null, если хотя бы
   * за один год значения нет.
   */
  enpsDelta_(reportData) {

    const current = this.enpsValue_(reportData, "2026");
    const previous = this.enpsValue_(reportData, "2025");

    return (current !== null && previous !== null) ? current - previous : null;

  },

  /**
   * Полное распределение ответов в одной ячейке, по строке на вариант:
   * вариант, количество и доля. Порядок вариантов и сами проценты —
   * ровно те, что уже посчитаны для детального отчета
   * (Statistics.calculateDistribution), включая варианты с нулем: это
   * полное распределение, а не топ.
   *
   * Названия вариантов дополняются пробелами до одной ширины, чтобы
   * числа выстроились в колонку (работает вместе с MONO_FONT).
   */
  formatDistribution_(items) {

    if (!items || items.length === 0) {
      return "";
    }

    const labels = items.map(item => this.capitalize_(item.answer));
    const width = Math.max.apply(null, labels.map(label => label.length));

    return items
      .map((item, index) => {
        const value = item.count + " (" + item.percent + "%)";
        return this.padRight_(labels[index], width) + "  " + value;
      })
      .join("\n");

  },

  /**
   * Топ-5 вариантов с долями в одной ячейке. Список и проценты берутся
   * готовыми из reportData.topAnswers (Statistics.selectTopAnswers) —
   * тот же топ и те же доли, что и в детальном отчете. Год без валидных
   * ответов дает percent null — тогда вместо доли выводится "н/д", как
   * и в отчете.
   */
  formatTopAnswers_(items) {

    if (!items || items.length === 0) {
      return "";
    }

    const width = Math.max.apply(null, items.map(item => item.answer.length));

    return items
      .map(item => {
        const value = item.percent === null || item.percent === undefined
          ? "н/д"
          : item.percent + "%";
        return this.padRight_(item.answer, width) + "  " + value;
      })
      .join("\n");

  },

  /**
   * Средняя оценка числом (чтобы столбец можно было сортировать).
   * Пустая ячейка, если на вопрос не ответил никто: Statistics в этом
   * случае возвращает средний балл 0, и записать его как настоящую
   * оценку значило бы исказить и саму строку, и сортировку по столбцу.
   */
  formatAverage_(item) {

    return (item && item.count > 0) ? item.average : "";

  },

  /**
   * Company-wide сигналы из расширенного контура (см. SegmentContext.gs)
   * одной строкой — одна сводная не терпит многострочных ячеек, как у
   * distribution/top (см. MONO_FONT), поэтому здесь просто перечисление
   * через "; ", без выравнивания.
   */
  formatSegmentContext_(segments) {

    if (!segments || segments.length === 0) return "";

    return segments
      .map(segment => {
        const badCount = segment.deviations.filter(d => d.bad).length;
        return segment.dimension + ": " + badCount + " " +
          ReportBuilder.pluralizeRu_(badCount, ["отклонение", "отклонения", "отклонений"]) +
          (segment.confirmed ? " (подтверждено)" : "");
      })
      .join("; ");

  },

  padRight_(text, width) {

    let result = String(text);

    while (result.length < width) {
      result += " ";
    }

    return result;

  },

  capitalize_(text) {
    return text && text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

};
