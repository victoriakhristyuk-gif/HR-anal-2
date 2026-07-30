/**
 * ==========================================================
 * Построение отчета
 * ==========================================================
 */

const ReportBuilder = {

  // UX-пороги для подсветки динамики (эвристика для визуального
  // выделения "заметных" изменений, НЕ статистическая значимость).
  // Значения относятся к предметной области отчета, поэтому живут
  // здесь, а не в Formatter — Formatter только умеет красить диапазон
  // по переданному порогу, не зная, откуда порог взялся.
  DELTA_THRESHOLD_RATING: 0.3,   // средние оценки (шкала 1-5), баллы
  DELTA_THRESHOLD_PERCENT: 5,    // eNPS/распределения/Top-5, п.п.

  // Минимальный охват метрики (100% - % "не пользовался"), ниже которого
  // средняя оценка не попадает в топ/дно Short Summary — иначе метрику
  // с горсткой ответивших ("Курсы английского", "Мерч за достижения")
  // может вынести в топ/дно случайным средним по 2-3 респондентам.
  MIN_COVERAGE_PERCENT_: 45,

  // Порог "драматичности" изменения между периодами для долевых метрик
  // (проценты вариантов ответа, категории eNPS), в процентных пунктах.
  // Отдельная константа, а не DELTA_THRESHOLD_PERCENT (5) — тот считает
  // "заметность" для подсветки в детальном отчете (тепловая карта и
  // т.п.), а этот — специально для детектора резких сдвигов между
  // периодами, с другим назначением и намеренно другим числом.
  // Порог для средних оценок не заводится отдельно — используется
  // существующий DELTA_THRESHOLD_RATING (0.3), тот же порог, что и для
  // остальных UX-порогов "заметности" изменения оценки.
  DRAMATIC_CHANGE_THRESHOLD_PERCENT_: 3,

  // Ключ developer metadata, которым лист-отчет помечается сигнатурой
  // своих параметров построения (источник + сравнение + фильтры).
  // Позволяет находить "тот же" отчет независимо от его названия.
  REPORT_KEY_METADATA_KEY: "hranalytics_report_key",

  // Два столбца-отступа, вставленные в начало листа для визуального
  // центрирования (см. createReport) — контент начинается с колонки 3.
  CONTENT_COLUMN_OFFSET: 2,

  /**
   * Единый источник видимых подписей периода.
   *
   * currentYear/previousYear задает ReportService. Fallback на source и
   * 2025 оставлен для совместимости со старыми тестовыми reportData.
   */
  getReportPeriods_(reportData) {

    return {
      currentYear: String(reportData.currentYear || reportData.source),
      previousYear: reportData.previousYear
        ? String(reportData.previousYear)
        : (reportData.comparison ? "2025" : null)
    };

  },

  createReport(reportData, reportName, isCustomName) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reportKey = this.getReportKey_(reportData);
    const existingSheet = this.findReportSheetByKey_(ss, reportKey);

    let sheet;

    if (existingSheet) {

      // Отчет с такими же параметрами уже существует. Вместо очистки
      // контента на месте (sheet.clear() не удаляет графики, группировку
      // строк и другие структуры листа) — лист удаляется целиком и сразу
      // пересоздается на том же месте с тем же именем: весь "мусор"
      // предыдущих версий гарантированно исчезает вместе со старым листом.
      const existingIndex = existingSheet.getIndex() - 1; // getIndex() 1-based, insertSheet(index) 0-based

      // Пользовательское название не участвует в поиске отчета (сигнатура
      // строится только по source/comparison/filters, см. getReportKey_).
      // Если оно не задано — сохраняем текущее имя листа как есть.
      const finalName = isCustomName ? reportName : existingSheet.getName();

      ss.deleteSheet(existingSheet);
      sheet = ss.insertSheet(this.getUniqueSheetName(ss, finalName), existingIndex);

    } else {
      sheet = ss.insertSheet(this.getUniqueSheetName(ss, reportName));
    }

    // Сигнатура прикрепляется к листу заново в обоих случаях — при
    // удалении листа его developer metadata удаляется вместе с ним.
    sheet.addDeveloperMetadata(this.REPORT_KEY_METADATA_KEY, reportKey);

    Formatter.applyReportBaseFont(sheet.getRange("A1:F50"));
    Formatter.setColumnWidths(sheet, [320, 110, 110, 110, 110, 110]);

    // ctx.row — "курсор" текущей свободной строки. Каждый render-метод
    // дописывает свой блок начиная с ctx.row и сам сдвигает его дальше,
    // поэтому блоки верхней части листа можно переставлять местами, не
    // пересчитывая номера строк вручную.
    const ctx = { sheet: sheet, row: 1 };

    this.renderHeader_(ctx);
    this.renderPassport_(ctx, reportData);

    // Замораживаем строки заголовка/паспорта (без хвостовой пустой
    // строки-разделителя) — они остаются на виду при прокрутке
    // остальной, гораздо более длинной, части отчета.
    const frozenRows = ctx.row - 1;

    // Порядок разделов отчета (см. также ReportSections.gs):
    // Executive Summary → Ключевые показатели (eNPS) → Состав выборки →
    // Удовлетворенность работой и оплатой → Риски → Культура →
    // Средние оценки (с вложенными Офис/Бенефиты) → Сырые данные.
    // Заголовки крупных разделов идут подряд, без пустых строк между
    // ними (пустые строки внутри самих разделов не затрагиваются).
    this.renderExecutiveSummary_(ctx, reportData);
    this.renderKeyIndicators_(ctx, reportData);
    this.renderDetailedAnalyticsBefore_(ctx, reportData);
    this.renderAverageOverviewSection_(ctx, reportData);
    this.renderRawData_(ctx, reportData);

    Formatter.freezeHeader(sheet, frozenRows, 0);

    // Визуальное центрирование: весь уже построенный отчет (со всем
    // форматированием и группировкой строк) целиком сдвигается на два
    // столбца вправо, поэтому контент начинается с колонки C, а не A.
    // Сами столбцы-отступы A/B делаются узкими (не стандартной ширины),
    // чтобы отступ был небольшим, как в макете.
    sheet.insertColumns(1, 2);
    sheet.setColumnWidth(1, 40);
    sheet.setColumnWidth(2, 40);
    sheet.getRange(1, 1, sheet.getMaxRows(), 2).setBackground(null);

    return sheet;

  },

  /**
   * Заголовок отчета: всегда точно название листа (sheet.getName()) —
   * единственный источник для обоих; заголовок ничего не строит
   * самостоятельно, чтобы не дублировать логику именования и не
   * рисковать расхождением с реальным именем листа (в т.ч. с
   * уникализирующим суффиксом "_2" и т.п., см. getUniqueSheetName, и с
   * пользовательским названием отчета). При ручном переименовании
   * листа заголовок обновляется автоматически (см. syncHeader).
   */
  renderHeader_(ctx) {

    const sheet = ctx.sheet;

    const range = sheet.getRange(ctx.row, 1, 1, 6);
    range.setValue(sheet.getName());
    Formatter.formatReportMainTitle(sheet, range);

    ctx.row += 1;

  },

  /**
   * Обновить заголовок листа-отчета, если он разошелся с текущим
   * названием листа (пользователь переименовал лист вручную).
   * Ячейка уже отформатирована (mergeAcross, шрифт, цвет) — setValue
   * меняет только текст, форматирование сохраняется.
   */
  syncHeader(sheet) {

    const cell = sheet.getRange(1, 1 + this.CONTENT_COLUMN_OFFSET);
    const current = String(cell.getValue());
    const name = sheet.getName();

    if (current !== name) {
      cell.setValue(name);
    }

  },

  /**
   * Паспорт выборки: источник, примененные фильтры, размер(ы) выборки.
   */
  renderPassport_(ctx, reportData) {

    const sheet = ctx.sheet;
    const periods = this.getReportPeriods_(reportData);

    const activeFilters = reportData.filters
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.formatFilterForPassport(filter));

    const filtersText = activeFilters.length > 0
      ? activeFilters.join("; ")
      : "без фильтров";

    const sourceLineCell = sheet.getRange(ctx.row, 1);
    sourceLineCell.setValue(
      "Источник: " + reportData.source + " · Фильтры: " + filtersText
    );
    sourceLineCell.setFontColor(Formatter.MUTED_TEXT_COLOR);
    ctx.row += 1;

    const sampleText = reportData.comparison
      ? "Размер выборки: " + periods.currentYear + " — n=" + reportData.employees +
        "; " + periods.previousYear + " — n=" + reportData.comparison.employees2025
      : "Размер выборки: n=" + reportData.employees;

    const sampleLineCell = sheet.getRange(ctx.row, 1);
    sampleLineCell.setValue(sampleText);
    sampleLineCell.setFontColor(Formatter.MUTED_TEXT_COLOR);
    ctx.row += 1;

    ctx.row += 1; // пустая строка-разделитель

  },

  /**
   * Executive Summary — компактное текстовое представление уже
   * посчитанных данных (eNPS, средние оценки, их динамика), без
   * новых показателей и без новой аналитики. Состав зафиксирован
   * макетом V3.
   */
  renderExecutiveSummary_(ctx, reportData) {

    const sheet = ctx.sheet;

    const titleRange = sheet.getRange(ctx.row, 1, 1, 6);
    titleRange.setValue("Short Summary");
    Formatter.formatSectionTitle(sheet, titleRange);
    ctx.row += 1;

    let lineIndex = 0;

    // 1. eNPS: значение + дельта к предыдущему периоду + (для любого
    // среза, кроме "вся компания") сравнение с eNPS всей компании.
    this.renderEnpsLine_(ctx, reportData, lineIndex++);

    // 2. Интерпретация изменения eNPS (Модуль 3) — пропускается целиком,
    // если сравнивать не с чем или изменение ниже порога значимости.
    const enpsShift = this.interpretEnpsShift_(reportData);

    if (enpsShift) {
      const enpsShiftCell = sheet.getRange(ctx.row, 1);
      enpsShiftCell.setValue(enpsShift);
      Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 6), lineIndex++);
      ctx.row += 1;
    }

    // 3. Топ-тем из открытых комментариев (Модуль 4) — пропускается,
    // если ни одна тема не набрала total > 1.
    const comments = this.buildCommentsForThemeDetection_(reportData);
    const themes = this.detectCommentThemes_(comments);

    if (themes.length > 0) {
      const themesLineCell = sheet.getRange(ctx.row, 1);
      themesLineCell.setValue("Темы в комментариях: " + this.formatThemesList_(themes.slice(0, 3)));
      Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 6), lineIndex++);
      ctx.row += 1;
    }

    // 4. Драматичные изменения по всем блокам анкеты (Модуль 2) —
    // пропускается, если список пуст (нет пары за прошлый год, либо
    // изменений выше порога не нашлось).
    const dramaticChangesInput = this.buildDramaticChangesInput_(reportData);
    const dramaticChanges = this.selectDramaticChanges_(dramaticChangesInput);

    if (dramaticChanges.length > 0) {
      const dramaticChangesCell = sheet.getRange(ctx.row, 1);
      dramaticChangesCell.setValue("Заметные изменения: " + this.formatDramaticChangesList_(dramaticChanges.slice(0, 3)));
      Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 6), lineIndex++);
      ctx.row += 1;
    }

    // 5. Топ-3/дно-3 метрик с фильтром по покрытию (Модуль 1).
    const metrics = this.buildRatingMetricsForSummary_(reportData);
    const extremes = this.selectTopBottomRatings_(metrics, 3);

    const highLineCell = sheet.getRange(ctx.row, 1);
    Formatter.setColoredPrefixText(
      highLineCell, "Самые высокие показатели: ",
      this.formatRatingList_(extremes.top), Formatter.DELTA_GOOD_COLOR
    );
    Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 6), lineIndex++);
    ctx.row += 1;

    const lowLineCell = sheet.getRange(ctx.row, 1);
    Formatter.setColoredPrefixText(
      lowLineCell, "Самые низкие показатели: ",
      this.formatRatingList_(extremes.bottom), Formatter.DELTA_BAD_COLOR
    );
    Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 6), lineIndex++);
    ctx.row += 1;

  },

  /**
   * "Тема (total, негатив N)" для списка тем из detectCommentThemes_ —
   * количество негатива показывается только если он есть (negative===0
   * не добавляет тексту сигнала, только шум).
   */
  formatThemesList_(themes) {

    return themes
      .map(t => t.theme + " (" + t.total + (t.negative > 0 ? ", негатив " + t.negative : "") + ")")
      .join("   ");

  },

  /**
   * "questionTitle Δ" для rating-изменений, "questionTitle — answerLabel Δ"
   * для percent-изменений из selectDramaticChanges_ — тот же формат
   * дельты (стрелка+знак), что и у остальных строк Executive Summary.
   */
  formatDramaticChangesList_(changes) {

    return changes
      .map(change => {

        const label = change.kind === "rating"
          ? change.questionTitle
          : change.questionTitle + " — " + change.answerLabel;

        const suffix = change.kind === "rating" ? "" : " п.п.";

        return label + " " + this.formatSignedDelta_(change.delta, suffix);

      })
      .join("   ");

  },

  /**
   * "Вопрос — X.X   Вопрос2 — X.X" для списка средних оценок
   */
  formatRatingList_(items) {
    return items.map(item => item.question + " — " + item.average).join("   ");
  },

  /**
   * Строка eNPS для Executive Summary: значение (+ динамика к 2025,
   * если сравнение включено).
   */
  buildEnpsSummaryLine_(reportData) {

    const enps = reportData.enps.enps;
    const previousYear = this.getReportPeriods_(reportData).previousYear;

    if (!reportData.comparison) {
      return "eNPS: " + enps;
    }

    const comparisonEnps = reportData.comparison.enps;

    if (comparisonEnps.delta === null || comparisonEnps.value2025 === null) {
      return "eNPS: " + enps + " (нет данных " + previousYear + " для сравнения)";
    }

    return "eNPS: " + enps + " (" + this.formatSignedDelta_(comparisonEnps.delta, " п.п.") +
      " к " + previousYear + ": " + comparisonEnps.value2025 + ")";

  },

  // Порог отставания eNPS среза от eNPS компании (в п.п.), при котором
  // строка получает дополнительный визуальный акцент (см.
  // renderEnpsLine_) — срез отстает настолько сильно, что это нельзя
  // просто прочитать наравне с остальными строками Short Summary.
  // Работает только в одну сторону: срез лучше компании, даже сильно
  // лучше, дополнительного акцента не получает (см. задачу) — только
  // обычная зеленая покраска слова "выше".
  ENPS_COMPANY_GAP_ALERT_THRESHOLD_: 20,

  /**
   * Строка 1 Short Summary для СРЕЗА (не "вся компания" — для нее
   * используется buildEnpsSummaryLine_ без изменений, сравнивать не с
   * чем). Помимо значения и YoY-динамики (та же логика, что и раньше,
   * см. buildEnpsSummaryLine_), строка получает сравнение eNPS среза с
   * eNPS всей компании за тот же период — отдельный, независимый от
   * YoY элемент строки.
   *
   * Пишет ячейку целиком сама (а не возвращает строку, как
   * buildEnpsSummaryLine_) — нужен RichText для покраски одного слова
   * ("выше"/"ниже") и, при сильном отставании, полноценное условное
   * форматирование строки, а не просто текст.
   */
  renderEnpsLine_(ctx, reportData, lineIndex) {

    const sheet = ctx.sheet;
    const rowRange = sheet.getRange(ctx.row, 1, 1, 6);
    const cell = sheet.getRange(ctx.row, 1);

    const isWholeCompany = reportData.filters.filter(filter => this.hasFilterValue(filter)).length === 0;

    if (isWholeCompany) {
      cell.setValue(this.buildEnpsSummaryLine_(reportData));
      Formatter.applyZebraStripe(rowRange, lineIndex);
      ctx.row += 1;
      return;
    }

    const sliceEnps = reportData.enps.enps;
    const companyEnps = this.getCompanyEnpsForPeriod_(reportData);
    const companyClause = this.buildEnpsCompanyComparisonClause_(sliceEnps, companyEnps);

    // YoY-часть — независимый от сравнения с компанией элемент строки:
    // присутствует, только когда применимо (сравнение с 2025 включено
    // для этого построения отчета), той же семантикой, что и раньше.
    const yoyText = reportData.comparison ? this.buildSliceEnpsYoyText_(reportData) : null;

    let text = "eNPS: " + sliceEnps;
    let wordStart = null;
    let wordLength = 0;
    let isDramaticallyLower = false;

    if (companyClause) {

      const beforeWord = text + " (";
      text = beforeWord + companyClause.text + ")";

      if (companyClause.wordStart !== null) {
        wordStart = beforeWord.length + companyClause.wordStart;
        wordLength = companyClause.wordLength;
      }

      isDramaticallyLower = companyClause.isDramaticallyLower;

    }

    if (yoyText !== null) {
      text += " · " + yoyText;
    }

    Formatter.setColoredSubstring(cell, text, wordStart, wordLength,
      wordStart !== null ? companyClause.color : null);

    Formatter.applyZebraStripe(rowRange, lineIndex);

    // Доп. акцент — только когда срез хуже компании на пороговую
    // величину и более; срез лучше компании (даже сильно) акцента не
    // получает (см. задачу).
    if (isDramaticallyLower) {
      Formatter.formatWarningBanner(rowRange);
    }

    ctx.row += 1;

  },

  /**
   * eNPS всей компании за тот же период (reportData.source), БЕЗ каких-
   * либо фильтров — базовая линия для сравнения среза с компанией (см.
   * renderEnpsLine_). null, если во всей компании нет ни одного
   * валидного ответа на eNPS (на реальных данных недостижимо, но чтобы
   * не сравнивать с фиктичным 0 — тот же прием, что и everywhere в
   * этом файле).
   *
   * loadSurveyData кэширует лист в пределах одного запуска скрипта
   * (см. DataLoader.gs) — ReportService.buildReport уже читает тот же
   * лист в начале построения отчета, поэтому здесь это не второе
   * чтение листа, а попадание в кэш.
   *
   * @param {Object} reportData
   * @returns {number|null}
   */
  getCompanyEnpsForPeriod_(reportData) {

    const survey = loadSurveyData(reportData.source, true);
    const companyEnps = Statistics.calculateENPS(survey.data, survey.headers);

    return companyEnps.total > 0 ? companyEnps.enps : null;

  },

  /**
   * "выше на N п.п." / "ниже на N п.п." / "на уровне компании" — часть
   * строки eNPS про сравнение среза со всей компанией. null, если
   * companyEnps недоступен — сравнивать не с чем, вызывающая сторона
   * этот элемент строки просто не показывает.
   *
   * wordStart/wordLength — позиция слова "выше"/"ниже" ВНУТРИ этого
   * текста (для покраски через Formatter.setColoredSubstring в
   * renderEnpsLine_, где этот текст уже вставлен в более длинную
   * строку) — null у "на уровне компании", красить нечего.
   *
   * @param {number} sliceEnps
   * @param {number|null} companyEnps
   * @returns {{text: string, wordStart: number|null, wordLength: number, color: string|null, isDramaticallyLower: boolean}|null}
   */
  buildEnpsCompanyComparisonClause_(sliceEnps, companyEnps) {

    if (companyEnps === null) {
      return null;
    }

    const delta = sliceEnps - companyEnps;

    if (delta === 0) {
      return { text: "на уровне компании", wordStart: null, wordLength: 0, color: null, isDramaticallyLower: false };
    }

    const word = delta > 0 ? "выше" : "ниже";
    const color = delta > 0 ? Formatter.DELTA_GOOD_COLOR : Formatter.DELTA_BAD_COLOR;

    return {
      text: word + " на " + Math.abs(delta) + " п.п.",
      wordStart: 0,
      wordLength: word.length,
      color: color,
      // Только "хуже компании" может дать доп. акцент — срез лучше
      // компании (delta > 0) никогда сюда не попадает.
      isDramaticallyLower: delta <= -this.ENPS_COMPANY_GAP_ALERT_THRESHOLD_
    };

  },

  /**
   * YoY-часть строки eNPS для среза (не "вся компания") — та же логика,
   * что и в buildEnpsSummaryLine_, но с формулировками для комбинированной
   * строки (см. renderEnpsLine_): "нет данных 2025 для сравнения по
   * срезу" (уточнение "по срезу" — есть данные 2025, но не для этого
   * среза) вместо просто "нет данных 2025 для сравнения", и "к 2025 (N)"
   * вместо "к 2025: N" — чтобы не путать с скобками сравнения с
   * компанией. Вызывается, только когда reportData.comparison есть.
   */
  buildSliceEnpsYoyText_(reportData) {

    const comparisonEnps = reportData.comparison.enps;
    const previousYear = this.getReportPeriods_(reportData).previousYear;

    if (comparisonEnps.delta === null || comparisonEnps.value2025 === null) {
      return "нет данных " + previousYear + " для сравнения по срезу";
    }

    return this.formatSignedDelta_(comparisonEnps.delta, " п.п.") +
      " к " + previousYear + " (" + comparisonEnps.value2025 + ")";

  },

  /**
   * Текстовое представление дельты со стрелкой и знаком (для строк
   * Executive Summary, которые пишутся обычным текстом, а не через
   * Formatter.applyDeltaNumberFormat — там нет числовой ячейки).
   */
  formatSignedDelta_(delta, suffix) {

    const arrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "–");
    const sign = delta > 0 ? "+" : "";

    return arrow + " " + sign + delta + suffix;

  },

  /**
   * Число с явным знаком в тексте (не стрелка, не Δ) — отрицательное
   * значение и так печатается со знаком "-", здесь только добавляется
   * "+" для положительного (ноль — без знака). Для значений вроде eNPS
   * за прошлый год, которые пишутся строкой (например, "(2025: +59)"),
   * а не отдельной числовой ячейкой с number format.
   */
  formatSignedInt_(value) {
    return value > 0 ? "+" + value : String(value);
  },

  /**
   * Ключевые показатели: eNPS-карточка — главный KPI отчета. "Средние
   * оценки — обзор" сюда больше не входит (см. createReport) — это
   * отдельный раздел, расположенный после "Культура" по новой структуре
   * отчета.
   */
  renderKeyIndicators_(ctx, reportData) {

    const sheet = ctx.sheet;

    const titleRange = sheet.getRange(ctx.row, 1, 1, 6);
    titleRange.setValue("КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ");
    Formatter.formatSectionTitle(sheet, titleRange);
    ctx.row += 1;

    this.renderEnpsIndicator_(ctx, reportData);

  },

  // Эмодзи/подписи категорий eNPS — единственное место, где сопоставляются
  // ключи Statistics.calculateENPS/Comparison.compareEnpsCategories_
  // ("promoters"/"neutrals"/"detractors") и их отображение.
  ENPS_CATEGORY_META_: {
    promoters: { emoji: "🟢", label: "Промоутеры", barColor: "#2FA67E" },
    neutrals: { emoji: "🟡", label: "Нейтралы", barColor: "#E0AC3E" },
    detractors: { emoji: "🔴", label: "Критики", barColor: "#D1483A" }
  },

  /**
   * eNPS — главный KPI отчета, оформлен как остальные компактные блоки:
   * заголовок "⭐ eNPS" → крупное жирное значение eNPS + Δ справа (то же
   * форматирование Δ, что и у KPI разделов средних оценок/риск-блоков) +
   * справочное значение "(2025: N)" мелким серым текстом (muted small) →
   * разделитель → детальный список категорий (эмодзи + название +
   * "кол-во (%)" + компактный progress bar — переиспользуется
   * renderCompactAnswerList_ с hasComparison=false, без своих Δ и своей
   * строки "2025:", т.к. они здесь не нужны на уровне категорий) →
   * итоговая строка "2025:" с агрегированными процентами категорий
   * (muted small, только эмодзи — без названий, по макету).
   * Ничего не пересчитывает — использует готовые
   * reportData.enps/reportData.comparison.enps.
   */
  renderEnpsIndicator_(ctx, reportData) {

    const sheet = ctx.sheet;
    const enps = reportData.enps;
    const comparisonEnps = reportData.comparison ? reportData.comparison.enps : null;
    const periods = this.getReportPeriods_(reportData);
    const categories = ["promoters", "neutrals", "detractors"];

    const labelRange = sheet.getRange(ctx.row, 1);
    labelRange.setValue("⭐ eNPS");
    Formatter.formatLabel(sheet, labelRange);
    ctx.row += 1;

    const valueCell = sheet.getRange(ctx.row, 1);
    valueCell.setValue(enps.enps);
    Formatter.applyReportHighlightCard(sheet, valueCell);
    Formatter.applySignedIntegerFormat(valueCell);

    if (comparisonEnps && comparisonEnps.delta !== null && comparisonEnps.delta !== undefined) {
      const deltaCell = sheet.getRange(ctx.row, 2);
      deltaCell.setValue(comparisonEnps.delta);
      deltaCell.setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center");
      Formatter.applyCompactDeltaNumberFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, comparisonEnps.delta, "up");
    }

    if (comparisonEnps && comparisonEnps.value2025 !== null && comparisonEnps.value2025 !== undefined) {
      const value2025Cell = sheet.getRange(ctx.row, 3);
      value2025Cell.setValue("(" + periods.previousYear + ": " + this.formatSignedInt_(comparisonEnps.value2025) + ")");
      Formatter.formatMutedSmall(value2025Cell);
      value2025Cell.setHorizontalAlignment("center");
    }

    ctx.row += 1;

    const comparisonByCategory = {};
    if (comparisonEnps) {
      comparisonEnps.categories.forEach(item => { comparisonByCategory[item.category] = item; });
    }

    const items = categories.map(category => ({
      answer: category,
      count2026: enps[category],
      percent2026: enps[category + "Percent"]
    }));

    this.renderCompactAnswerList_(
      ctx, items, false, periods.currentYear, periods.previousYear,
      category => this.ENPS_CATEGORY_META_[category].emoji + " " + this.ENPS_CATEGORY_META_[category].label,
      null,
      category => this.ENPS_CATEGORY_META_[category].barColor
    );

    if (comparisonEnps) {

      const summary = categories
        .map(category => {

          const cmp = comparisonByCategory[category];
          const value = (cmp && cmp.percent2025 !== null && cmp.percent2025 !== undefined)
            ? cmp.count2025 + " (" + cmp.percent2025 + "%)"
            : "н/д";

          return this.ENPS_CATEGORY_META_[category].emoji + " " + value;

        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue(periods.previousYear + ": " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Обзор средних оценок сгруппирован по смысловым разделам анкеты (см.
   * AVERAGE_SCORE_GROUPS_), а не единой таблицей на все rating5-вопросы:
   * для каждого раздела — KPI "Средняя оценка раздела" (среднее уже
   * посчитанных per-question средних, не новый расчет по сырым данным),
   * затем тот же ранжированный список (медаль/номер + большая жирная
   * оценка + Δ), что и в остальных блоках отчета. Источник данных —
   * buildAverageOverviewRows_ (не меняется), только группировка и
   * отображение.
   */
  renderAverageOverview_(ctx, reportData) {

    const sheet = ctx.sheet;
    const hasComparison = !!reportData.comparison;
    const previousYear = this.getReportPeriods_(reportData).previousYear;
    const rows = this.buildAverageOverviewRows_(reportData);
    const coverageByQuestion = this.buildAverageCoverageInfo_(reportData);

    const byQuestion = {};
    rows.forEach(row => { byQuestion[row.question] = row; });

    const titleRange = sheet.getRange(ctx.row, 1, 1, 6);
    titleRange.setValue("📊 Средние оценки");
    Formatter.formatSectionTitle(sheet, titleRange);
    ctx.row += 1;
    ctx.row += 1; // пустая строка-разделитель

    Object.keys(this.AVERAGE_SCORE_GROUPS_).forEach(groupName => {

      const group = this.AVERAGE_SCORE_GROUPS_[groupName];

      const groupRows = group.questions
        .map(title => byQuestion[title])
        .filter(Boolean)
        .sort((a, b) => (b.value2026 ?? -Infinity) - (a.value2026 ?? -Infinity));

      if (groupRows.length === 0) {
        return;
      }

      this.renderAverageScoreGroup_(
        ctx, groupName, group.icon, groupRows, hasComparison, coverageByQuestion, previousYear
      );
      ctx.row += 1; // пустая строка-разделитель между разделами

    });

    // Группировка строк здесь не создается — этот блок не заканчивается
    // здесь: "Офис"/"Бенефиты" рендерятся сразу следом (см.
    // renderAverageOverviewSection_) и должны попасть в ту же, одну общую
    // группу "Средние оценки", а не оказаться вне ее.

  },

  /**
   * "Средние оценки" вместе с вложенными в нее детальными разделами
   * "Офис"/"Бенефиты" (последние две секции ReportSections.sections —
   * см. renderDetailedAnalyticsAfter_). Содержимое и логика сворачивания
   * самих разделов не меняются: "Офис"/"Бенефиты" по-прежнему
   * группируются каждый сам по себе (renderSection_). Здесь же вся
   * объединенная область — от строки сразу после заголовка "Средние
   * оценки" до последней строки "Бенефиты" — оборачивается ОДНОЙ
   * дополнительной группой; поскольку "Офис"/"Бенефиты" уже входят в
   * нее как во вложенный диапазон, Google Sheets автоматически поднимает
   * их группы на уровень глубже — они становятся визуально и
   * структурно вложенными подразделами "Средних оценок", без изменения
   * их собственного содержимого.
   */
  renderAverageOverviewSection_(ctx, reportData) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;

    this.renderAverageOverview_(ctx, reportData);
    this.renderDetailedAnalyticsAfter_(ctx, reportData);

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Подпись строки охвата ("Не пользовались"/"Не участвовали"/...) для
   * вопросов rating5, у которых есть вариант ответа "не пользовался" —
   * по конкретному смыслу вопроса, а не общей формулировкой (аналогично
   * YES_NO_SUMMARIES_/RISK_QUESTIONS_). Вопрос без записи здесь просто
   * не получает вторую строку (см. buildAverageCoverageInfo_) — сюда
   * попадают только rating5-вопросы из AVERAGE_SCORE_GROUPS_, у которых
   * в каталоге (Questions.gs) реально есть ответ "не пользовался"
   * ("Удовлетворенность рабочими задачами"/"ЗП" его не имеют и поэтому не перечислены).
   *
   * Значение — объект (не голая строка), т.к. это по сути мини-конфигурация
   * на вопрос, а не просто словарь подписей: например, buildAverageCoverageInfo_
   * сейчас ищет в распределении ответ "не пользовался" одним и тем же
   * жестко заданным текстом для всех вопросов — если в будущем появится
   * вопрос с другой формулировкой "неучастия" (например, "нет опыта"),
   * сюда достаточно будет добавить свое поле у нужной записи, не меняя
   * форму остальных.
   */
  AVERAGE_COVERAGE_CONFIG_: {
    "Рабочий стол": { label: "Не пользовались" },
    "Рабочее кресло": { label: "Не пользовались" },
    "Расположение рабочего места": { label: "Не пользовались" },
    "Офисное пространство": { label: "Не пользовались" },
    "Отдых в офисе": { label: "Не пользовались" },
    "Переговорки": { label: "Не пользовались" },
    "Питание и возможность перекусить, выпить чай, кофе": { label: "Не пользовались" },
    "Атмосфера в офисе": { label: "Не были в офисе" },
    "Рабочая техника": { label: "Не пользовались" },
    "Корпоративы": { label: "Не участвовали" },
    "Обучение": { label: "Не участвовали" },
    "Курсы английского": { label: "Не пользовались" },
    "ДМС": { label: "Не пользовались" },
    "Мерч за достижения": { label: "Не оценили" }
  },

  /**
   * Собрать для каждого сконфигурированного вопроса (AVERAGE_COVERAGE_CONFIG_)
   * количество/процент варианта ответа "не пользовался" — берется из уже
   * посчитанного reportData.distributions/reportData.comparison.distributions
   * (Statistics.calculateDistribution/Comparison.compareDistributions),
   * новых расчетов нет, только поиск нужного варианта ответа в уже
   * готовом распределении. Вопрос отсутствует в результате, если у него
   * нет записи в AVERAGE_COVERAGE_CONFIG_, либо в его распределении нет
   * варианта "не пользовался", либо для него нет данных (count/percent
   * null/undefined).
   */
  buildAverageCoverageInfo_(reportData) {

    const hasComparison = !!reportData.comparison;
    const distributions = hasComparison ? reportData.comparison.distributions : reportData.distributions;

    const byQuestionTitle = {};
    distributions.forEach(entry => { byQuestionTitle[entry.question.title] = entry; });

    const coverage = {};

    Object.keys(this.AVERAGE_COVERAGE_CONFIG_).forEach(title => {

      const entry = byQuestionTitle[title];

      if (!entry) {
        return;
      }

      const item = entry.items.find(candidate => candidate.answer === "не пользовался");

      if (!item) {
        return;
      }

      const count = hasComparison ? item.count2026 : item.count;
      const percent = hasComparison ? item.percent2026 : item.percent;

      // Строка не показывается, если вариант отсутствует, либо никто
      // его не выбрал (count 0) или его доля округлилась до 0% — иначе
      // она только засоряет отчет строками вида "Не пользовались: 0 (0%)".
      if (!count || percent === 0) {
        return;
      }

      coverage[title] = {
        label: this.AVERAGE_COVERAGE_CONFIG_[title].label,
        count: count,
        percent: percent
      };

    });

    return coverage;

  },

  /**
   * Метрики для Short Summary: reportData.averageRatings, дополненные
   * процентом "не пользовался" из buildAverageCoverageInfo_, слитые по
   * названию вопроса. Вопрос без записи в coverage (нет варианта "не
   * пользовался" в принципе, либо доля округлилась до 0%) считается
   * охваченным на 100% — notUsedPercent 0.
   *
   * Отдельная функция, а не инлайн в renderExecutiveSummary_, потому что
   * selectTopBottomRatings_ работает с произвольным списком метрик —
   * это сборка такого списка конкретно из reportData текущего отчета.
   *
   * @param {Object} reportData
   * @returns {Array<{question: string, average: number, notUsedPercent: number}>}
   */
  buildRatingMetricsForSummary_(reportData) {

    const coverage = this.buildAverageCoverageInfo_(reportData);

    return reportData.averageRatings.map(item => ({
      question: item.question,
      average: item.average,
      notUsedPercent: coverage[item.question] ? coverage[item.question].percent : 0
    }));

  },

  /**
   * Топ-limit и дно-limit метрик по среднему баллу, с исключением
   * метрик с низким охватом (100% - notUsedPercent < MIN_COVERAGE_PERCENT_) —
   * такую метрику посчитали единицы, и ее среднее ненадежно как для
   * похвалы, так и для тревоги.
   *
   * Не читает reportData/лист напрямую: принимает уже собранный список
   * метрик, поэтому подходит для любого среза (общий отчет, департамент,
   * сравнение и т.д.), а не только для reportData.averageRatings как есть.
   *
   * Топ и дно не пересекаются даже при небольшом числе метрик, прошедших
   * фильтр охвата: сначала берется top-limit по убыванию, затем дно —
   * из оставшихся (без повторной сортировки заново), а не из полного
   * списка. Сортировка стабильная (Array.prototype.sort в V8/Apps Script
   * стабилен) — при равном среднем балле порядок как во входном массиве.
   *
   * Если после фильтра метрик меньше limit (или меньше 2*limit) — топ
   * и/или дно возвращаются укороченными, без дозаполнения и без ошибки.
   *
   * @param {Array<{question: string, average: number, notUsedPercent?: number}>} metrics
   * @param {number} [limit=3]
   * @returns {{top: Array, bottom: Array}}
   */
  selectTopBottomRatings_(metrics, limit) {

    const n = limit || 3;

    const eligible = metrics.filter(metric =>
      (100 - (metric.notUsedPercent || 0)) >= this.MIN_COVERAGE_PERCENT_
    );

    const sortedDesc = eligible.slice().sort((a, b) => b.average - a.average);

    const top = sortedDesc.slice(0, n);
    const remaining = sortedDesc.slice(n);

    const bottom = remaining.slice().sort((a, b) => a.average - b.average).slice(0, n);

    return { top: top, bottom: bottom };

  },

  // Вопросы, которые не участвуют в детекторе драматичных изменений, хотя
  // и попадают в reportData.comparison.distributions — это состав выборки
  // (демография), а не мнение respondentов. Сдвиг в "Отделе" на 3 п.п.
  // почти всегда значит "кто-то перешел в другой отдел", а не сигнал для
  // Short Summary. Список закрытый и по названию, а не по какому-то
  // общему признаку в Questions.gs — эти четыре вопроса единственные в
  // своем роде (демографический профиль), и общего маркера для них нет.
  DRAMATIC_CHANGE_EXCLUDED_QUESTIONS_: ["Формат работы", "Город", "Отдел", "Стаж"],

  // Подписи категорий eNPS для detector-записей — то же деление, что и в
  // Statistics.calculateENPS/Comparison.compareEnpsCategories_.
  ENPS_CATEGORY_LABELS_: {
    promoters: "Промоутеры",
    neutrals: "Нейтралы",
    detractors: "Критики"
  },

  // Варианты ответа, которые означают "не знаю"/"не пользовался"/отказ
  // отвечать по существу, а не содержательный ответ — при пересчете долей
  // для детектора драматичных изменений исключаются и из числителя, и из
  // знаменателя (см. recomputeDistributionDeltasExcludingNeutral_), чтобы
  // рост доли "затрудняюсь ответить" не размывал проценты по остальным,
  // содержательным вариантам. Названия, а не какой-то общий признак в
  // Questions.gs — как и у DRAMATIC_CHANGE_EXCLUDED_QUESTIONS_, общего
  // маркера для "неответа" в каталоге нет. Список закрытый, но
  // применяется универсально к любому вопросу, где такой вариант
  // встретится, а не только к "Выгоранию" (единственному, где он есть
  // среди текущих данных).
  NEUTRAL_DISTRIBUTION_ANSWERS_: ["затрудняюсь ответить", "не знаю", "не пользовался"],

  /**
   * Является ли вариант ответа "неответом" по существу (см.
   * NEUTRAL_DISTRIBUTION_ANSWERS_).
   */
  isNeutralDistributionAnswer_(answer) {
    return this.NEUTRAL_DISTRIBUTION_ANSWERS_.indexOf(Statistics.normalize_(answer)) !== -1;
  },

  /**
   * Проценты и дельта варианта ответа заново, БЕЗ учета "неответа"
   * (NEUTRAL_DISTRIBUTION_ANSWERS_) — ни в числителе, ни в знаменателе.
   * comparison.distributions уже содержит percent2026/percent2025/delta
   * (Comparison.compareDistributionItems), но они посчитаны от ВСЕХ
   * ответивших, включая "затрудняюсь ответить"/"не пользовался" — здесь
   * знаменатель пересчитывается только по содержательным вариантам.
   *
   * Сам вариант-неответ в результат не попадает вовсе — это только
   * исправление метода расчета остальных долей, а не новая метрика для
   * показа (см. задачу).
   *
   * Год без валидных (после исключения неответа) ответов — percent null,
   * а не 0, той же семантикой, что и everywhere в этом файле: если все
   * ответившие на вопрос выбрали "затрудняюсь ответить", знаменатель
   * обнуляется, и percent/delta по остальным вариантам не считаются,
   * а не делятся на ноль.
   *
   * @param {Array<{answer: string, count2026: number, count2025: number}>} items
   * @returns {Array<{answer: string, delta: number|null}>}
   */
  recomputeDistributionDeltasExcludingNeutral_(items) {

    const meaningfulItems = items.filter(item => !this.isNeutralDistributionAnswer_(item.answer));

    const total2026 = meaningfulItems.reduce((sum, item) => sum + item.count2026, 0);
    const total2025 = meaningfulItems.reduce((sum, item) => sum + item.count2025, 0);

    return meaningfulItems.map(item => {

      const percent2026 = total2026 > 0 ? Math.round(item.count2026 / total2026 * 100) : null;
      const percent2025 = total2025 > 0 ? Math.round(item.count2025 / total2025 * 100) : null;

      return {
        answer: item.answer,
        delta: (percent2026 !== null && percent2025 !== null) ? percent2026 - percent2025 : null
      };

    });

  },

  /**
   * Плоский список изменений между периодами из reportData.comparison —
   * входные данные для selectDramaticChanges_. Пустой массив, если
   * сравнение выключено (reportData.comparison нет).
   *
   * Источники, в порядке добавления:
   * 1. comparison.averageRatings — по одной записи на вопрос (kind:
   *    "rating", answerLabel null).
   * 2. comparison.distributions — по одной записи на каждый вариант
   *    ответа (kind: "percent"), КРОМЕ:
   *    - вопросов из DRAMATIC_CHANGE_EXCLUDED_QUESTIONS_ (демография,
   *      не мнение);
   *    - вопросов типа rating5 (question.type === "rating5") — их
   *      средний балл уже учтен через averageRatings; включить сюда еще
   *      и процент по конкретной оценке (например, "Рабочий стол: 5")
   *      значило бы сообщить об одном и том же сдвиге дважды.
   *    Для вопросов со шкалой Да/Скорее да/Скорее нет/Нет, у которых уже
   *    есть настроенная агрегированная пара "Устраивает/Не устраивает"
   *    (Questions.isYesNoScale + YES_NO_SUMMARIES_, см.
   *    getYesNoBlockConfig_/aggregateAnswerBuckets_ — тот же блок, что
   *    уже отображается в отчете) — ОДНА запись на вопрос, а не на
   *    каждый из 4 исходных вариантов ответа и не на обе агрегированные
   *    группы. Положительная и отрицательная группы зеркальны (delta
   *    одной равна -delta другой) — это один и тот же факт с двух
   *    сторон, поэтому в список идет только отрицательная/нежелательная
   *    сторона — только та группа, что РАСТЕТ (delta > 0), независимо от
   *    того, положительная она (🟢) или отрицательная (🔴); падающая
   *    (зеркальная) сторона не показывается вовсе — стрелка вниз рядом с
   *    ней ничего не добавляет к уже показанному факту, а у 🔴-группы еще
   *    и требует двойного отрицания, чтобы понять знак новости. Так
   *    соседние градации одного знака (например, "да" ▼ и "скорее да" ▲) не
   *    попадают в блок как две противоречащие друг другу строки, и один
   *    и тот же сдвиг не занимает в топе два слота вместо одного —
   *    берется уже готовая, посчитанная для этого же блока в отчете
   *    дельта агрегированной группы (aggregateAnswerBuckets_
   *    переиспользуется как есть, без пересчета). Если у вопроса нет
   *    настроенной сводки в YES_NO_SUMMARIES_ (blockConfig === null) —
   *    вопрос логируется и пропускается целиком (ни агрегированных, ни
   *    исходных записей), чтобы не возвращать старую нестыковку.
   *    Остальные вопросы (не Да/Нет-шкала) — как раньше, проценты берутся
   *    не как есть из comparison.distributions, а пересчитываются через
   *    recomputeDistributionDeltasExcludingNeutral_ — без учета
   *    "затрудняюсь ответить"/"не пользовался" в знаменателе (см. эту
   *    функцию), поэтому и сам вариант-неответ в результат не попадает.
   * 3. comparison.enps.categories — доли промоутеров/нейтралов/критиков,
   *    та же природа метрики, что и проценты в distributions (kind:
   *    "percent"), questionTitle фиксированно "eNPS".
   *
   * Записи с delta === null (год без валидных ответов, см. Comparison.gs,
   * либо после исключения неответа знаменатель года обнулился, см.
   * recomputeDistributionDeltasExcludingNeutral_) в список не попадают
   * вовсе — их не с чем сравнивать, а не "изменение ниже порога".
   *
   * Не читает лист — источник только reportData (пересчет процентов
   * внутри — по уже готовым count2026/count2025, без обращения к сырым
   * строкам), поэтому подходит для любого среза, для которого он построен.
   *
   * @param {Object} reportData
   * @returns {Array<{questionTitle: string, answerLabel: string|null, delta: number, kind: "percent"|"rating", direction: "up"|"down"}>}
   */
  buildDramaticChangesInput_(reportData) {

    const comparison = reportData.comparison;

    if (!comparison) {
      return [];
    }

    const changes = [];

    comparison.averageRatings.forEach(item => {

      if (item.delta === null) {
        return;
      }

      changes.push({
        questionTitle: item.question,
        answerLabel: null,
        delta: item.delta,
        kind: "rating",
        direction: item.delta > 0 ? "up" : "down"
      });

    });

    comparison.distributions.forEach(entry => {

      if (this.DRAMATIC_CHANGE_EXCLUDED_QUESTIONS_.indexOf(entry.question.title) !== -1) {
        return;
      }

      if (entry.question.type === "rating5") {
        return;
      }

      if (Questions.isYesNoScale(entry.question)) {

        const blockConfig = this.getYesNoBlockConfig_(entry.question);

        if (!blockConfig) {
          console.warn(
            "buildDramaticChangesInput_: нет агрегированной пары (YES_NO_SUMMARIES_) для вопроса Да/Нет-шкалы \"" +
            entry.question.title + "\" — вопрос пропущен в блоке \"Заметные изменения\"."
          );
          return;
        }

        // Бакеты "положительная/отрицательная группа" зеркальны (delta
        // одной равна -delta другой) — это один и тот же факт с двух
        // сторон, поэтому в "Заметные изменения" попадает только РАСТУЩАЯ
        // сторона (delta > 0), а падающая (та же самая дельта с обратным
        // знаком) не показывается вовсе — стрелка вниз рядом с падающим
        // зеркальным бакетом ничего не добавляет к уже показанному факту,
        // а для отрицательного бакета (🔴) еще и путает: "Нет общения ▼"
        // требует двойного отрицания, чтобы понять, что это улучшение.
        // bucket.direction ("up"/"down" — 🟢/🔴 из getYesNoBlockConfig_)
        // здесь не критерий выбора, а лишь классификация хорошо/плохо —
        // ее используют другие места (например, KPI-карточка вопроса),
        // не этот блок.
        const growingBucket = this.aggregateAnswerBuckets_(entry.items, blockConfig.buckets)
          .find(bucket => typeof bucket.delta === "number" && bucket.delta > 0);

        if (!growingBucket) {
          return;
        }

        changes.push({
          questionTitle: entry.question.title,
          answerLabel: this.stripBucketLabelEmoji_(growingBucket.label),
          delta: growingBucket.delta,
          kind: "percent",
          direction: "up"
        });

        return;

      }

      this.recomputeDistributionDeltasExcludingNeutral_(entry.items).forEach(item => {

        if (item.delta === null) {
          return;
        }

        changes.push({
          questionTitle: entry.question.title,
          answerLabel: item.answer,
          delta: item.delta,
          kind: "percent",
          direction: item.delta > 0 ? "up" : "down"
        });

      });

    });

    comparison.enps.categories.forEach(category => {

      if (category.delta === null) {
        return;
      }

      changes.push({
        questionTitle: "eNPS",
        answerLabel: this.ENPS_CATEGORY_LABELS_[category.category],
        delta: category.delta,
        kind: "percent",
        direction: category.delta > 0 ? "up" : "down"
      });

    });

    return changes;

  },

  /**
   * Из плоского списка изменений (buildDramaticChangesInput_ либо любой
   * другой источник той же формы) отбирает "драматичные" — те, чей
   * |delta| не ниже порога своего kind (DRAMATIC_CHANGE_THRESHOLD_PERCENT_
   * для "percent", DELTA_THRESHOLD_RATING для "rating") — и сортирует по
   * убыванию |delta|, самые резкие сдвиги первыми.
   *
   * Не читает reportData/лист: принимает готовый список change-записей,
   * поэтому подходит для любого среза (общий отчет, департамент и т.д.),
   * а не только для reportData.comparison как есть.
   *
   * @param {Array<{questionTitle: string, answerLabel: string|null, delta: number, kind: "percent"|"rating", direction: "up"|"down"}>} changes
   * @returns {Array} тот же тип записей, отфильтрованный и отсортированный
   */
  selectDramaticChanges_(changes) {

    return changes
      .filter(change => Math.abs(change.delta) >= this.dramaticChangeThreshold_(change.kind))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  },

  /**
   * Порог "драматичности" для одного вида метрики (см. selectDramaticChanges_).
   */
  dramaticChangeThreshold_(kind) {
    return kind === "rating" ? this.DELTA_THRESHOLD_RATING : this.DRAMATIC_CHANGE_THRESHOLD_PERCENT_;
  },

  /**
   * Одна фраза-интерпретация того, ЗА СЧЕТ ЧЕГО изменился eNPS между
   * периodами — не просто "eNPS вырос/упал на N", а разбор структуры
   * (промоутеры/нейтралы/критики), чтобы Short Summary не заставлял
   * читателя самому сопоставлять три отдельные дельты. null, если
   * сравнения нет, данных для сравнения нет, либо изменение eNPS не
   * дотягивает до порога "драматичности" — тогда этот абзац просто не
   * нужен.
   *
   * Источник данных — reportData.comparison.enps (Comparison.compareENPS),
   * тот же объект, что уже используется buildDramaticChangesInput_/
   * buildEnpsSummaryLine_. Ничего не пересчитывает.
   *
   * Правила проверяются по порядку, отдельно на первом подошедшем:
   * 1. Данных для сравнения нет (comparison отсутствует, либо у eNPS или
   *    любой из трех категорий delta === null) — null.
   * 2. Критики практически не изменились (|delta| <= 1 п.п.), а
   *    промоутеры и нейтралы сдвинулись в противоположные стороны и оба
   *    сдвига не близки к нулю (порог тот же, что и "драматичность" в
   *    selectDramaticChanges_, DRAMATIC_CHANGE_THRESHOLD_PERCENT_) —
   *    переток между промоутерами и нейтралами.
   * 3. Критики сдвинулись заметно (|delta| > 1 п.п.) и это основной
   *    вклад в изменение eNPS (|delta критиков| больше |delta
   *    промоутеров|) — доминирующий фактор критики.
   * 4. Промоутеры и критики оба меняются значимо и в одну и ту же
   *    "хорошую"/"плохую" сторону для eNPS (промоутеры растут и критики
   *    падают, либо наоборот) — два фактора усиливают друг друга.
   * 5. Ни один из структурных факторов не доминирует, но сам eNPS
   *    изменился заметно — нейтральная фраза без указания причины.
   * 6. eNPS изменился, но не заметно (ниже порога) — null.
   *
   * @param {Object} reportData
   * @returns {string|null}
   */
  interpretEnpsShift_(reportData) {

    const comparison = reportData.comparison;

    if (!comparison) {
      return null;
    }

    const enps = comparison.enps;

    const byCategory = {};
    enps.categories.forEach(category => { byCategory[category.category] = category; });

    const promoters = byCategory.promoters;
    const neutrals = byCategory.neutrals;
    const detractors = byCategory.detractors;

    if (enps.delta === null || promoters.delta === null || neutrals.delta === null || detractors.delta === null) {
      return null;
    }

    const threshold = this.DRAMATIC_CHANGE_THRESHOLD_PERCENT_;

    // Правило 2: критики стабильны, изменение — переток между
    // промоутерами и нейтралами (произведение дельт < 0 значит разные
    // знаки и что ни одна из них не равна нулю).
    if (Math.abs(detractors.delta) <= 1 &&
        promoters.delta * neutrals.delta < 0 &&
        Math.abs(promoters.delta) >= threshold &&
        Math.abs(neutrals.delta) >= threshold) {

      const growing = promoters.delta > 0 ? promoters : neutrals;
      const shrinking = promoters.delta > 0 ? neutrals : promoters;
      const growingLabel = growing === promoters ? "промоутеров" : "нейтралов";
      const shrinkingLabel = shrinking === promoters ? "промоутеров" : "нейтралов";

      return "eNPS изменился на " + this.formatSignedDelta_(enps.delta, " п.п.") +
        " за счет перетока между промоутерами и нейтралами: доля " + growingLabel +
        " выросла на " + Math.abs(growing.delta) + " п.п. (до " + growing.percent2026 + "%), доля " +
        shrinkingLabel + " сократилась на " + Math.abs(shrinking.delta) + " п.п. (до " + shrinking.percent2026 + "%). " +
        "Доля критиков " + (detractors.delta === 0 ? "не изменилась" : "почти не изменилась") +
        " (" + detractors.percent2026 + "%).";

    }

    // Правило 3: критики — основной вклад в изменение eNPS.
    if (Math.abs(detractors.delta) > 1 && Math.abs(detractors.delta) > Math.abs(promoters.delta)) {

      const verb = enps.delta >= 0 ? "вырос" : "снизился";
      const criticsVerb = detractors.delta > 0 ? "рост" : "снижение";

      return "eNPS " + verb + " на " + Math.abs(enps.delta) + " п.п. — основной вклад вносит " +
        criticsVerb + " доли критиков (" + this.formatSignedDelta_(detractors.delta, " п.п.") +
        ", до " + detractors.percent2026 + "%).";

    }

    // Правило 4: промоутеры и критики одновременно значимо двигаются в
    // одну и ту же сторону для eNPS (разные знаки дельт: рост
    // промоутеров + падение критиков — обе "хорошие", и наоборот).
    if (Math.abs(promoters.delta) >= threshold &&
        Math.abs(detractors.delta) >= threshold &&
        promoters.delta * detractors.delta < 0) {

      const verb = enps.delta >= 0 ? "вырос" : "снизился";
      const promotersVerb = promoters.delta > 0 ? "растет" : "сокращается";
      const detractorsVerb = detractors.delta > 0 ? "растет" : "сокращается";

      return "eNPS " + verb + " на " + Math.abs(enps.delta) + " п.п. — одновременно " + promotersVerb +
        " доля промоутеров (" + this.formatSignedDelta_(promoters.delta, " п.п.") + ", до " + promoters.percent2026 + "%) и " +
        detractorsVerb + " доля критиков (" + this.formatSignedDelta_(detractors.delta, " п.п.") + ", до " + detractors.percent2026 + "%): " +
        "эффекты усиливают друг друга.";

    }

    // Правило 5: доминирующего фактора нет, но само eNPS изменилось заметно.
    if (Math.abs(enps.delta) >= threshold) {

      const verb = enps.delta >= 0 ? "вырос" : "снизился";

      return "eNPS " + verb + " на " + Math.abs(enps.delta) + " п.п., но явного доминирующего фактора в структуре " +
        "промоутеров/нейтралов/критиков не выявлено (промоутеры " + this.formatSignedDelta_(promoters.delta, " п.п.") +
        ", нейтралы " + this.formatSignedDelta_(neutrals.delta, " п.п.") + ", критики " +
        this.formatSignedDelta_(detractors.delta, " п.п.") + ").";

    }

    // Правило 6: изменение eNPS ниже порога "драматичности".
    return null;

  },

  /**
   * Разделы для группировки блока "Средние оценки — обзор" —
   * принадлежность вопроса к разделу определяется исключительно этой
   * картой (без if по названиям вопросов). Порядок вопросов внутри
   * массива значения не имеет — итоговый порядок в разделе всегда
   * пересортировывается по убыванию 2026 (см. renderAverageOverview_).
   */
  AVERAGE_SCORE_GROUPS_: {

    "Офис": {
      icon: "🏢",
      questions: [
        "Рабочий стол", "Рабочее кресло", "Расположение рабочего места",
        "Офисное пространство", "Отдых в офисе", "Переговорки",
        "Питание и возможность перекусить, выпить чай, кофе",
        "Атмосфера в офисе", "Рабочая техника"
      ]
    },

    "Бенефиты": {
      icon: "🎁",
      questions: ["Корпоративы", "Обучение", "Курсы английского", "ДМС", "Мерч за достижения"]
    },

    "Вознаграждение": {
      icon: "💰",
      questions: ["ЗП"]
    }

  },

  /**
   * Один раздел обзора средних оценок: заголовок (иконка + название) →
   * KPI "Средняя оценка раздела" (пропускается, если в разделе всего
   * один вопрос — см. AVERAGE_SCORE_GROUPS_["Вознаграждение"], иначе это
   * было бы дублированием единственного показателя) → разделитель →
   * ранжированный список вопросов раздела (медаль/номер, большая жирная
   * оценка, Δ справа — тот же стиль, что и у "⭐ Средняя оценка" внутри
   * вопроса и у KPI-карточек риск-блока/Да-Нет).
   */
  renderAverageScoreGroup_(ctx, groupName, icon, groupRows, hasComparison, coverageByQuestion, previousYear) {

    const sheet = ctx.sheet;

    const labelRange = sheet.getRange(ctx.row, 1);
    labelRange.setValue(icon + " " + groupName);
    Formatter.formatLabel(sheet, labelRange);
    ctx.row += 1;

    if (groupRows.length > 1) {
      this.renderAverageScoreGroupKpi_(ctx, groupRows, hasComparison, previousYear);
    }

    let zebraIndex = 0;

    groupRows.forEach(row => {
      zebraIndex = this.renderAverageScoreRankItem_(
        ctx, row, hasComparison, coverageByQuestion[row.question], zebraIndex
      );
    });

  },

  /**
   * KPI "Средняя оценка раздела": среднее значение value2026 (и, при
   * сравнении, value2025 → Δ) уже посчитанных per-question средних
   * группы — простое агрегирование готовых чисел, без обращения к
   * Statistics/Comparison. null, если хотя бы у одного вопроса группы
   * нет value2025 (нет данных 2025 по нему) — тогда для среднего 2025
   * раздела оно тоже не считается. Подпись и значение — одна строка:
   * "Средняя оценка раздела" (col1) | значение (+"(2025: ...)" той же
   * ячейкой, см. setKpiValueWithPreviousYear_) (col2) | Δ (col3).
   */
  renderAverageScoreGroupKpi_(ctx, groupRows, hasComparison, previousYear) {

    const sheet = ctx.sheet;
    const average = values => +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);

    sheet.getRange(ctx.row, 1).setValue("Средняя оценка раздела");

    const value2026 = average(groupRows.map(row => row.value2026));
    const allHave2025 = hasComparison && groupRows.every(row => row.value2025 !== null && row.value2025 !== undefined);

    const valueCell = sheet.getRange(ctx.row, 2);

    if (allHave2025) {

      const value2025 = average(groupRows.map(row => row.value2025));
      const delta = +(value2026 - value2025).toFixed(2);

      // "4,52 (2025: 4,49)" одной ячейкой — воспринимается как единый
      // KPI, а не три независимых элемента; Δ — соседней ячейкой справа.
      this.setKpiValueWithPreviousYear_(valueCell, value2026, value2025, previousYear);

      const deltaCell = sheet.getRange(ctx.row, 3);
      deltaCell.setValue(delta);
      deltaCell.setHorizontalAlignment("center");
      Formatter.applyCompactDeltaTwoDecimalFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, delta, "up");

    } else {
      valueCell.setValue(value2026);
      valueCell.setFontWeight("bold").setHorizontalAlignment("right");
    }

    ctx.row += 1;
    ctx.row += 1; // пустая строка-разделитель перед ранжированным списком

  },

  /**
   * Один пункт списка средних оценок — одна строка, без места в
   * рейтинге (сортировка по убыванию 2026 сохраняется, просто не
   * отображается номером/медалью): название (жирный, вся ячейка) |
   * оценка (жирный, обычный размер — без formatHighlightNumber, по весу
   * как count(%) в остальных компактных блоках), с прошлогодней оценкой
   * в скобках после нее той же ячейкой (серым, обычным начертанием, без
   * изменения высоты строки — см. buildRatingWithPreviousYear_) | Δ
   * (числовая ячейка с двумя знаками после запятой — Formatter.
   * applyCompactDeltaTwoDecimalFormat/setDeltaFontColor; средние оценки
   * сами показываются с точностью до сотых, поэтому и Δ здесь с двумя
   * знаками, а не с одним, как в большинстве других компактных блоков).
   * Взгляд читает строку
   * слева направо: вопрос → оценка → изменение. Значения/Δ берутся из
   * уже посчитанных reportData.averageRatings/comparison.averageRatings
   * (buildAverageOverviewRows_), никаких новых вычислений.
   *
   * Если для вопроса есть coverageInfo (см. buildAverageCoverageInfo_) —
   * сразу под строкой добавляется вторая, менее заметная строка охвата
   * ("Не пользовались: 298 (71%)"): мелкий серый неполужирный текст,
   * ширина блока не меняется (текст остается в первой колонке).
   */
  renderAverageScoreRankItem_(ctx, row, hasComparison, coverageInfo, zebraIndex) {

    const sheet = ctx.sheet;
    const itemRow = ctx.row;
    let nextZebraIndex = zebraIndex;

    // Название вопроса — обычный жирный текст строки списка, НЕ
    // подпись-подраздел (Formatter.formatLabel): в макете эта строка
    // выглядит как остальные строки компактных списков (см. C327 "Атмосфера
    // в офисе" — 10pt жирный, без синего цвета/подчеркивания), в отличие от
    // заголовка самой группы ("🏢 Офис", см. renderAverageScoreGroup_) и от
    // заголовка пункта рейтинга Топ-5 (см. renderRankedAnswerList_), где
    // formatLabel — как раз то, что нужно.
    sheet.getRange(itemRow, 1).setValue(row.question);
    sheet.getRange(itemRow, 1).setFontWeight("bold");

    const valueCell = sheet.getRange(itemRow, 2);

    if (hasComparison && row.value2025 !== null && row.value2025 !== undefined &&
        row.value2026 !== null && row.value2026 !== undefined) {
      this.setRatingWithPreviousYear_(valueCell, row.value2026, row.value2025);
    } else {
      valueCell.setValue(row.value2026 !== null && row.value2026 !== undefined ? row.value2026 : "н/д");
      valueCell.setFontWeight("bold");
    }
    valueCell.setHorizontalAlignment("right");

    if (hasComparison && row.delta !== null && row.delta !== undefined) {

      const deltaCell = sheet.getRange(itemRow, 3);
      deltaCell.setValue(row.delta);
      deltaCell.setFontWeight("bold").setHorizontalAlignment("center");
      Formatter.applyCompactDeltaTwoDecimalFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, row.delta, "up");

    }

    Formatter.applyZebraStripe(sheet.getRange(itemRow, 1, 1, 3), nextZebraIndex++);
    ctx.row += 1;

    if (coverageInfo) {

      const coverageText = coverageInfo.percent !== null && coverageInfo.percent !== undefined
        ? coverageInfo.count + " (" + coverageInfo.percent + "%)"
        : coverageInfo.count + " (н/д)";

      const coverageCell = sheet.getRange(ctx.row, 1);
      coverageCell.setValue(coverageInfo.label + ": " + coverageText);
      Formatter.formatMutedSmall(coverageCell);
      Formatter.applyZebraStripe(sheet.getRange(ctx.row, 1, 1, 3), nextZebraIndex++);

      ctx.row += 1;

    }

    return nextZebraIndex;

  },

  /**
   * Записать в одну ячейку "value2026 (value2025)" — текущая оценка
   * жирным (как и раньше), прошлогодняя в скобках рядом, серым, обычным
   * (не жирным) начертанием, тем же размером шрифта — визуально
   * второстепенная справочная информация в той же строке, без
   * увеличения ее высоты. Разные стили внутри одной ячейки требуют
   * RichTextValue (setFontWeight/setValue на весь Range тут не подходят
   * — они красят ячейку целиком одним стилем).
   */
  setRatingWithPreviousYear_(cell, value2026, value2025) {

    const currentText = this.formatRatingValue_(value2026);
    const previousText = " (" + this.formatRatingValue_(value2025) + ")";
    const fullText = currentText + previousText;

    const richText = SpreadsheetApp.newRichTextValue()
      .setText(fullText)
      .setTextStyle(0, currentText.length, SpreadsheetApp.newTextStyle().setBold(true).build())
      .setTextStyle(
        currentText.length, fullText.length,
        SpreadsheetApp.newTextStyle().setBold(false).setForegroundColor(Formatter.DELTA_NEUTRAL_COLOR).build()
      )
      .build();

    cell.setRichTextValue(richText);

  },

  /**
   * Средняя оценка (шкала 1-5) как текст с запятой в качестве
   * десятичного разделителя ("4,69") — нужно там, где значение
   * записывается вручную как часть строки (RichTextValue), а не как
   * число в отдельной ячейке, где разделитель проставляет сама таблица
   * по локали.
   */
  formatRatingValue_(value) {
    return String(value).replace(".", ",");
  },

  /**
   * То же самое, что setRatingWithPreviousYear_, но с другой подписью
   * прошлогоднего значения ("(2025: X)" вместо "(X)") — для KPI
   * "Средняя оценка раздела": значение жирным обычным размером,
   * "(2025: X)" рядом мелким серым (как Formatter.formatMutedSmall), в
   * той же ячейке — строка читается как единый показатель, а не три
   * независимых элемента. Не крупная карточка (в отличие от "⭐ Средняя
   * оценка" внутри вопроса, см. renderInlineAverage_/
   * Formatter.applyReportHighlightCard) — по макету это компактная
   * строка обзора, а не отдельный акцентный показатель. Δ остается
   * соседней ячейкой, здесь не участвует.
   */
  setKpiValueWithPreviousYear_(cell, value2026, value2025, previousYear) {

    const currentText = this.formatRatingValue_(value2026);
    const previousText = " (" + previousYear + ": " + this.formatRatingValue_(value2025) + ")";
    const fullText = currentText + previousText;

    const richText = SpreadsheetApp.newRichTextValue()
      .setText(fullText)
      .setTextStyle(
        0, currentText.length,
        SpreadsheetApp.newTextStyle().setBold(true).build()
      )
      .setTextStyle(
        currentText.length, fullText.length,
        SpreadsheetApp.newTextStyle().setBold(false).setFontSize(9).setForegroundColor(Formatter.DELTA_NEUTRAL_COLOR).build()
      )
      .build();

    cell.setRichTextValue(richText);
    cell.setHorizontalAlignment("right");

  },

  /**
   * Подготовить строки для обзора средних оценок: вопрос, значение
   * 2026[, 2025, дельта], отсортировано по убыванию 2026. Источник —
   * уже посчитанные reportData.averageRatings /
   * reportData.comparison.averageRatings, новых расчетов нет.
   */
  buildAverageOverviewRows_(reportData) {

    if (reportData.comparison) {

      return reportData.comparison.averageRatings
        .map(item => ({
          question: item.question,
          value2026: item.value2026,
          value2025: item.value2025,
          delta: item.delta
        }))
        .sort((a, b) => (b.value2026 ?? -Infinity) - (a.value2026 ?? -Infinity));

    }

    return reportData.averageRatings
      .map(item => ({ question: item.question, value2026: item.average, value2025: null, delta: null }))
      .sort((a, b) => b.value2026 - a.value2026);

  },

  /**
   * Первая группа смысловых секций анкеты (ReportSections.gs) — идут до
   * блока "Средние оценки" по новому порядку разделов отчета (см.
   * createReport): "Состав выборки", "Удовлетворенность работой и
   * оплатой", "Риски", "Культура" — первые четыре записи
   * ReportSections.sections. Без общего заголовка-обертки — каждая
   * секция теперь самостоятельный раздел верхнего уровня.
   */
  renderDetailedAnalyticsBefore_(ctx, reportData) {

    ReportSections.validate();

    const hasComparison = !!reportData.comparison;
    const lookups = this.buildDetailLookups_(reportData);
    const sections = ReportSections.getSections();

    this.renderSectionsRange_(ctx, sections.slice(0, 4), lookups, hasComparison);

  },

  /**
   * Вторая группа смысловых секций анкеты — "Офис"/"Бенефиты", идут
   * после блока "Средние оценки" (последние две записи
   * ReportSections.sections). См. renderDetailedAnalyticsBefore_.
   */
  renderDetailedAnalyticsAfter_(ctx, reportData) {

    const hasComparison = !!reportData.comparison;
    const lookups = this.buildDetailLookups_(reportData);
    const sections = ReportSections.getSections();

    this.renderSectionsRange_(ctx, sections.slice(4), lookups, hasComparison);

  },

  /**
   * Отрендерить последовательность секций анкеты — общая часть
   * renderDetailedAnalyticsBefore_/renderDetailedAnalyticsAfter_. Секции
   * отличаются только составом вопросов и заголовком, поэтому рендерятся
   * одним и тем же методом (renderSection_), а не отдельной функцией на
   * каждую. Без пустой строки между секциями — заголовки крупных
   * разделов идут подряд, единым списком.
   */
  renderSectionsRange_(ctx, sections, lookups, hasComparison) {

    sections.forEach(section => {
      this.renderSection_(ctx, section, lookups, hasComparison);
    });

  },

  /**
   * Быстрые словари "вопрос -> уже посчитанные данные" по названию —
   * без повторных расчетов, только группировка того, что уже есть в
   * reportData/reportData.comparison.
   */
  buildDetailLookups_(reportData) {

    const periods = this.getReportPeriods_(reportData);

    const byQuestionTitle = list => {
      const map = {};
      list.forEach(entry => { map[entry.question.title] = entry; });
      return map;
    };

    const averages = {};
    reportData.averageRatings.forEach(item => { averages[item.question] = item; });

    const comparisonAverages = {};
    if (reportData.comparison) {
      reportData.comparison.averageRatings.forEach(item => { comparisonAverages[item.question] = item; });
    }

    return {
      distributions: byQuestionTitle(reportData.distributions),
      comparisonDistributions: reportData.comparison ? byQuestionTitle(reportData.comparison.distributions) : {},
      topAnswers: byQuestionTitle(reportData.topAnswers),
      comparisonTopAnswers: reportData.comparison ? byQuestionTitle(reportData.comparison.topAnswers) : {},
      averages: averages,
      comparisonAverages: comparisonAverages,
      currentYear: periods.currentYear,
      previousYear: periods.previousYear
    };

  },

  /**
   * Одна смысловая секция (например "Офис"): заголовок-саммари в виде
   * сворачиваемой группы, внутри — по очереди все вопросы секции.
   * Заголовок — только название секции, без количества вопросов.
   * section.indent (см. ReportSections.gs — сейчас "Офис"/"Бенефиты")
   * добавляет небольшой отступ слева перед названием — визуально
   * показывает, что секция вложена в "Средние оценки" (сама вложенность
   * группировки строк создается отдельно, см. renderAverageOverviewSection_).
   */
  renderSection_(ctx, section, lookups, hasComparison) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;
    const title = section.indent ? "    " + section.name : section.name;

    const titleRange = sheet.getRange(ctx.row, 1, 1, 6);
    titleRange.setValue(title);
    Formatter.formatSectionTitle(sheet, titleRange);
    ctx.row += 1;

    section.questions.forEach(question => {
      this.renderQuestionBlock_(ctx, question, section, lookups, hasComparison);
    });

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Склонение русского существительного по числу: forms = [1, 2-4, 5+],
   * например ["вопрос", "вопроса", "вопросов"] или ["строка", "строки", "строк"].
   */
  pluralizeRu_(count, forms) {

    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return forms[0];
    }

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return forms[1];
    }

    return forms[2];

  },

  /**
   * Один вопрос внутри секции: инлайн-среднее (только для rating5) +
   * таблица ответов — полное распределение для вопросов-шкал/single,
   * либо топ-ответы для вопросов с display "Топ 5". Единый метод для
   * обоих случаев — различается только источник данных (lookups).
   */
  renderQuestionBlock_(ctx, question, section, lookups, hasComparison) {

    const sheet = ctx.sheet;
    const currentYear = lookups.currentYear;
    const previousYear = lookups.previousYear;

    const isTopAnswers = question.display === "Топ 5";

    const entry2026 = isTopAnswers
      ? lookups.topAnswers[question.title]
      : lookups.distributions[question.title];

    const comparisonEntry = isTopAnswers
      ? lookups.comparisonTopAnswers[question.title]
      : lookups.comparisonDistributions[question.title];

    let items = (hasComparison && comparisonEntry)
      ? comparisonEntry.items
      : (entry2026 ? entry2026.items : []).map(item => ({
          answer: item.answer,
          count2026: item.count,
          percent2026: item.percent
        }));

    // Город/Отдел — по частоте (убывание) и без нулевых значений;
    // остальные вопросы сохраняют фиксированный порядок анкеты/шкалы.
    if (section.sortByFrequency.indexOf(question.title) !== -1) {
      items = items
        .filter(item => item.count2026 > 0)
        .slice()
        .sort((a, b) => b.count2026 - a.count2026);
    }

    // "Выгорание"/"Смена работы" (RISK_QUESTIONS_) и вопросы Да/Нет с
    // настроенной сводкой (YES_NO_SUMMARIES_) рендерятся одним и тем же
    // общим блоком "агрегированный KPI + детализация" — см.
    // renderAggregatedAnswerBlock_. Отличаются только конфигурацией
    // группировки/подписей, а не механизмом рендера. Вопрос Да/Нет без
    // записи в YES_NO_SUMMARIES_ безопасно проваливается в обычный путь
    // ниже (компактный список без KPI-карточки, как было раньше).
    const blockConfig = this.getRiskBlockConfig_(question) || this.getYesNoBlockConfig_(question);

    if (blockConfig) {
      this.renderAggregatedAnswerBlock_(
        ctx, blockConfig, items, hasComparison, currentYear, previousYear
      );
      ctx.row += 1; // разделитель между вопросами
      return;
    }

    const questionLabelRange = sheet.getRange(ctx.row, 1);
    questionLabelRange.setValue(question.title);
    Formatter.formatLabel(sheet, questionLabelRange);
    ctx.row += 1;

    if (question.average) {
      this.renderInlineAverage_(ctx, question, lookups, hasComparison);
    }

    const hasPercent = hasComparison || !isTopAnswers;

    if (question.type === "single") {
      // Город/Отдел/Стаж/Формат работы (единственные вопросы типа
      // "single" в каталоге — см. Questions.gs) — справочные вопросы о
      // составе выборки, не аналитическое сравнение. Полное
      // распределение без таблицы 2026/2025/Δ; Δ оставляем только для
      // Стаж/Формат работы (см. SINGLE_QUESTIONS_WITH_DELTA_) — эти два
      // отражают изменение структуры компании, для Города/Отдела Δ не нужна.
      const showDelta = hasComparison && this.SINGLE_QUESTIONS_WITH_DELTA_.indexOf(question.title) !== -1;
      // "Город" — единственный из четырех, где мелкие города (< порога)
      // сворачиваются в одну строку "Другие города" (см.
      // collapseSmallCities_/SMALL_CITY_THRESHOLD_); Отдел/Стаж/Формат
      // работы выводятся полностью, без изменений.
      const displayItems = question.title === "Город" ? this.collapseSmallCities_(items) : items;
      this.renderReferenceAnswerList_(ctx, displayItems, showDelta);
    } else if (Questions.isYesNoScale(question)) {
      this.renderCompactAnswerList_(
        ctx, items, hasComparison, currentYear, previousYear, answer => this.capitalize_(answer)
      );
    } else if (question.type === "rating5") {
      // В строке "2025:" эмодзи-легенда не дублируется (formatSummaryLabel
      // отдельно от formatLabel) — иначе в мелком справочном тексте она
      // конкурирует за внимание с эмодзи основного (2026) списка.
      this.renderCompactAnswerList_(
        ctx, items, hasComparison, currentYear, previousYear,
        answer => this.formatRatingAnswerLabel_(answer),
        answer => answer
      );
    } else if (isTopAnswers) {
      // Все вопросы MULTIPLE (display "Топ 5") автоматически получают
      // рейтинговое отображение — специализированного рендера под
      // конкретный вопрос нет, см. renderRankedAnswerList_.
      this.renderRankedAnswerList_(ctx, items, hasComparison, previousYear);
    } else {
      this.renderAnswerTable_(ctx, items, hasComparison, hasPercent, currentYear, previousYear);
    }

    ctx.row += 1; // разделитель между вопросами

  },

  /**
   * Карта агрегации в риск-категории для вопросов "Выгорание"/"Смена
   * работы" (см. заявленную "ЛОГИКА АГРЕГАЦИИ" макета) — какие варианты
   * ответа складываются в каждую категорию, и как называется/каким
   * эмодзи маркируется сама категория (эмодзи используется только в
   * KPI-карточке и в строке "2025:", детализация ниже — без эмодзи).
   * Числа не пересчитывает — только описывает, как сгруппировать уже
   * посчитанные Statistics/Comparison count/percent/delta по каждому
   * варианту ответа. Приводится к общему для всех агрегированных блоков
   * виду (title/subheading/buckets) функцией getRiskBlockConfig_.
   */
  RISK_QUESTIONS_: {

    "Выгорание": {
      icon: "🔥",
      heading: "Выгорание",
      subheading: "Риск выгорания",
      buckets: [
        { label: "🟢 Низкий риск", answers: ["совсем не чувствовал", "чувствовал редко"], direction: "up" },
        { label: "🔴 Повышенный риск", answers: ["чувствовал регулярно", "чувствовал постоянно и чувствую сейчас"], direction: "down" },
        { label: "⚪ Затруднились", answers: ["затрудняюсь ответить"], direction: "neutral" }
      ]
    },

    "Смена работы": {
      icon: "💼",
      heading: "Риск ухода",
      subheading: null,
      buckets: [
        { label: "🟢 Низкий риск", answers: ["совсем не задумывался", "очень редко, но такие мысли были"], direction: "up" },
        { label: "🔴 Повышенный риск", answers: ["задумывался время от времени", "постоянно и думаю об этом сейчас"], direction: "down" }
      ]
    }

  },

  /**
   * Привести RISK_QUESTIONS_[question.title] к общему для всех
   * агрегированных блоков виду {title, subheading, buckets} — см.
   * renderAggregatedAnswerBlock_. null, если у вопроса нет риск-карты
   * (не "Выгорание"/"Смена работы").
   */
  getRiskBlockConfig_(question) {

    const riskConfig = this.RISK_QUESTIONS_[question.title];

    if (!riskConfig) {
      return null;
    }

    return {
      title: riskConfig.icon + " " + riskConfig.heading,
      subheading: riskConfig.subheading,
      buckets: riskConfig.buckets
    };

  },

  /**
   * Подписи положительной/отрицательной группы для вопросов Да/Скорее
   * да/Скорее нет/Нет — по смыслу конкретного вопроса, а не общими
   * словами вроде "Положительная оценка" (см. запрос: "Не использовать
   * универсальные подписи"). Добавление нового вопроса в этот список —
   * единственное, что нужно для получения для него того же
   * агрегированного KPI-блока, что и у "Выгорание"/"Смена работы"; вопрос
   * без записи здесь просто продолжает рендериться старым компактным
   * списком (см. getYesNoBlockConfig_/renderQuestionBlock_).
   */
  YES_NO_SUMMARIES_: {

    "График": { positive: "Устраивает", negative: "Не устраивает" },
    "Задачи": { positive: "Устраивают", negative: "Не устраивают" },
    "Ожидания": { positive: "Ожидания понятны", negative: "Ожидания непонятны" },
    "Проф мнение": { positive: "Мнение учитывается", negative: "Мнение не учитывается" },
    "Возможности роста": { positive: "Видят возможности роста", negative: "Не видят возможностей роста" },
    "ОС от руководителя": { positive: "Получают обратную связь", negative: "Не получают обратную связь" },
    "Ценности": { positive: "Разделяют ценности", negative: "Не разделяют ценности" },
    "О жизни компании": { positive: "Информированы", negative: "Не информированы" },
    "Цели компании": { positive: "Понимают цели компании", negative: "Не понимают цели компании" },
    "Вклад": { positive: "Видят свой вклад", negative: "Не видят своего вклада" },
    "Атмосфера в отделе": { positive: "Атмосфера комфортная", negative: "Атмосфера некомфортная" },
    "Межкомандное взаимодействие": { positive: "Взаимодействие налажено", negative: "Взаимодействие не налажено" },
    "Неформальное общение": { positive: "Есть неформальное общение", negative: "Нет неформального общения" },
    "Решение споров": { positive: "Споры решаются конструктивно", negative: "Споры решаются неконструктивно" }

  },

  /**
   * Собрать общий {title, subheading, buckets} для вопроса Да/Скорее
   * да/Скорее нет/Нет из YES_NO_SUMMARIES_: положительная группа —
   * "Да"+"Скорее да" (рост хорошо), отрицательная — "Скорее нет"+"Нет"
   * (снижение хорошо). null, если вопрос не Да/Нет-шкала или для него
   * не задана сводка в YES_NO_SUMMARIES_ (тогда вопрос рендерится
   * обычным компактным списком без KPI-карточки).
   */
  getYesNoBlockConfig_(question) {

    if (!Questions.isYesNoScale(question)) {
      return null;
    }

    const summary = this.YES_NO_SUMMARIES_[question.title];

    if (!summary) {
      return null;
    }

    return {
      title: question.title,
      subheading: null,
      buckets: [
        { label: "🟢 " + summary.positive, answers: ["да", "скорее да"], direction: "up" },
        { label: "🔴 " + summary.negative, answers: ["скорее нет", "нет"], direction: "down" }
      ]
    };

  },

  /**
   * Общий блок "агрегированный KPI + детализация" для вопросов
   * "Выгорание"/"Смена работы" и Да/Скорее да/Скорее нет/Нет (см.
   * getRiskBlockConfig_/getYesNoBlockConfig_) — единственное, чем они
   * отличаются, это конфигурация группировки/подписей (blockConfig),
   * сам механизм рендера один: заголовок (title, опционально
   * subheading) → KPI-карточка агрегированных категорий (кол-во/%/Δ,
   * светло-серая заливка строк, без рамки и без бара) → одна пустая
   * строка → то же детальное распределение, что и у остальных вопросов
   * (renderCompactAnswerList_, переиспользуется как есть, без Δ и без
   * эмодзи — эти акценты уже есть в KPI-карточке выше и не дублируются
   * на уровне отдельных вариантов ответа) → строка "2025:" с
   * агрегированными значениями категорий (не по отдельным вариантам
   * ответа).
   */
  renderAggregatedAnswerBlock_(ctx, blockConfig, items, hasComparison, currentYear, previousYear) {

    const sheet = ctx.sheet;

    const blockLabelRange = sheet.getRange(ctx.row, 1);
    blockLabelRange.setValue(blockConfig.title);
    Formatter.formatLabel(sheet, blockLabelRange);
    ctx.row += 1;

    let zebraIndex = 0;

    if (blockConfig.subheading) {
      const subheadingRange = sheet.getRange(ctx.row, 1);
      subheadingRange.setValue(blockConfig.subheading);
      Formatter.applyZebraStripe(subheadingRange, zebraIndex++);
      ctx.row += 1;
    }

    const buckets = this.aggregateAnswerBuckets_(items, blockConfig.buckets);

    this.renderAggregateKpiRows_(ctx, buckets, hasComparison, zebraIndex);

    ctx.row += 1; // одна пустая строка между KPI-карточкой и детализацией

    // hasComparison=false здесь намеренно: детальные строки этого блока
    // показывают только кол-во/%/бар за 2026 (без Δ и без собственной
    // строки "2025:" на уровне отдельных вариантов ответа) — согласно
    // макету, Δ и "2025:" на этом экране относятся только к
    // агрегированным категориям, а не к каждому варианту ответа.
    // Эмодзи-легенда здесь тоже не используется (в отличие от KPI-строк
    // и строки "2025:") — только эмодзи-легенда KPI-карточки остается
    // визуальным акцентом, детализация оформлена нейтрально.
    this.renderCompactAnswerList_(
      ctx, items, false, currentYear, previousYear, answer => this.capitalize_(answer)
    );

    if (hasComparison) {

      const summary = buckets
        .map(bucket => {
          const value2025 = (bucket.percent2025 !== null && bucket.percent2025 !== undefined)
            ? bucket.count2025 + " (" + bucket.percent2025 + "%)"
            : "н/д";
          return bucket.label + " " + value2025;
        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue(previousYear + ": " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Сложить уже посчитанные count2026/percent2026/count2025/percent2025/
   * delta вариантов ответа (items, из Statistics/Comparison) в
   * категории по карте bucket.answers. Общая логика для риск-категорий
   * и для положительной/отрицательной группы Да/Нет — ничего не
   * пересчитывает, только суммирует готовые числа; percent2026/
   * percent2025/delta категории — null, если хотя бы у одного из ее
   * вариантов ответа соответствующее значение null (нет валидных
   * ответов за этот год по всему вопросу — тот же случай, что и в
   * Comparison.gs).
   */
  aggregateAnswerBuckets_(items, buckets) {

    const byAnswer = {};
    items.forEach(item => { byAnswer[item.answer.trim().toLowerCase()] = item; });

    const sumNullable = (matched, key) => matched.reduce((total, item) => {
      const value = item[key];
      return (total !== null && value !== null && value !== undefined) ? total + value : null;
    }, 0);

    return buckets.map(bucket => {

      const matched = bucket.answers
        .map(answer => byAnswer[answer.trim().toLowerCase()])
        .filter(Boolean);

      return {
        label: bucket.label,
        direction: bucket.direction,
        count2026: matched.reduce((total, item) => total + item.count2026, 0),
        percent2026: sumNullable(matched, "percent2026"),
        count2025: matched.reduce((total, item) => total + (item.count2025 || 0), 0),
        percent2025: sumNullable(matched, "percent2025"),
        delta: sumNullable(matched, "delta")
      };

    });

  },

  /**
   * bucket.label ("🟢 Мнение учитывается") без ведущего эмодзи-маркера —
   * для текста в блоке "Заметные изменения" (buildDramaticChangesInput_),
   * где эмодзи уже избыточен (там своя стрелка Δ, см. formatSignedDelta_).
   */
  stripBucketLabelEmoji_(label) {
    return label.replace(/^\S+\s+/, "");
  },

  /**
   * Строки KPI-карточки агрегированных категорий: label | "кол-во (%)" |
   * Δ — без бара (в отличие от renderCompactAnswerList_), общие для
   * риск-блока и блока Да/Нет. Цвет Δ — по bucket.direction (см.
   * GOOD_DIRECTION_/RISK_QUESTIONS_/YES_NO_SUMMARIES_), не по знаку
   * числа: например, снижение "Повышенный риск" или "Не устраивают" —
   * улучшение и красится зеленым, а не красным.
   */
  renderAggregateKpiRows_(ctx, buckets, hasComparison, zebraIndex) {

    const sheet = ctx.sheet;
    const width = hasComparison ? 4 : 2;
    const firstRow = ctx.row;
    let nextZebraIndex = zebraIndex || 0;

    buckets.forEach(bucket => {

      const row = ctx.row;

      sheet.getRange(row, 1).setValue(bucket.label);

      const countCell = sheet.getRange(row, 2);
      countCell.setValue(
        bucket.percent2026 !== null && bucket.percent2026 !== undefined
          ? bucket.count2026 + " (" + bucket.percent2026 + "%)"
          : bucket.count2026 + " (н/д)"
      );
      countCell.setFontWeight("bold").setHorizontalAlignment("right");

      if (hasComparison && bucket.delta !== null && bucket.delta !== undefined) {
        const deltaCell = sheet.getRange(row, 4);
        deltaCell.setValue(bucket.delta);
        deltaCell.setFontWeight("bold").setHorizontalAlignment("center");
        Formatter.setDeltaFontColor(deltaCell, bucket.delta, bucket.direction);
      }

      // Заливка "зебры" — продолжение той же чередующейся заливки, что и
      // у необязательной строки-подзаголовка перед карточкой (см.
      // renderAggregatedAnswerBlock_), поэтому индекс приходит снаружи, а
      // не начинается заново с 0 у каждой карточки.
      Formatter.applyZebraStripe(sheet.getRange(row, 1, 1, width), nextZebraIndex++);

      ctx.row += 1;

    });

    if (hasComparison) {
      const deltaRange = sheet.getRange(firstRow, 4, buckets.length, 1);
      Formatter.applyCompactDeltaNumberFormat(deltaRange);
    }

  },

  /**
   * Желаемое направление изменения Δ по варианту ответа — рост
   * показателя не всегда означает улучшение (например, снижение доли
   * ответа "Нет" — это хорошо). Ключ — нормализованный (trim+lowercase)
   * текст варианта ответа; значение передается в
   * Formatter.resolveDeltaColor/setDeltaFontColor:
   *   "up"      — рост хорошо (Δ>0 зеленый, Δ<0 красный);
   *   "down"    — снижение хорошо (цвет инвертирован, стрелка не меняется);
   *   "neutral" — всегда серый, независимо от знака Δ.
   * Вариант, не указанный здесь, по умолчанию считается "up" (см.
   * getGoodDirection_) — это прежнее поведение отчета.
   */
  GOOD_DIRECTION_: {

    "да": "up",
    "скорее да": "up",
    "скорее нет": "down",
    "нет": "down",

    "5": "up",
    "4": "up",
    "3": "neutral",
    "2": "down",
    "1": "down",
    "не пользовался": "neutral",

    "совсем не чувствовал": "up",
    "чувствовал редко": "up",
    "чувствовал регулярно": "down",
    "чувствовал постоянно и чувствую сейчас": "down",
    "затрудняюсь ответить": "neutral",

    "совсем не задумывался": "up",
    "очень редко, но такие мысли были": "up",
    "задумывался время от времени": "down",
    "постоянно и думаю об этом сейчас": "down"

  },

  /**
   * Желаемое направление Δ для варианта ответа (см. GOOD_DIRECTION_).
   * Явно не описанный вариант по умолчанию считается "up".
   */
  getGoodDirection_(answer) {
    return this.GOOD_DIRECTION_[String(answer).trim().toLowerCase()] || "up";
  },

  // Эмодзи-легенда перед оценкой в строках распределения rating5-вопросов
  // (только визуальная маркировка, порядок/расчеты не затрагивает).
  RATING_ANSWER_EMOJI_: { "5": "🟢", "4": "🟩", "3": "🟨", "2": "🟧", "1": "🟥" },

  /**
   * Подпись варианта ответа rating5-вопроса с эмодзи-легендой перед
   * цифрой оценки (например "🟢 5"). Вариант без эмодзи в карте
   * (например "не пользовался") выводится как есть.
   */
  formatRatingAnswerLabel_(answer) {

    const emoji = this.RATING_ANSWER_EMOJI_[answer];

    return emoji ? emoji + " " + answer : answer;

  },

  /**
   * Строка со средней оценкой вопроса (только rating5) — то же
   * значение, что уже показано в "Средние оценки — обзор", здесь оно
   * повторяется для контекста внутри своей секции анкеты. Значение —
   * главный визуальный элемент блока (крупный жирный шрифт), Δ — той
   * же строкой справа; цвет — по Formatter.resolveDeltaColor с
   * направлением "up" (рост среднего балла всегда хорошо), без порога.
   */
  renderInlineAverage_(ctx, question, lookups, hasComparison) {

    const sheet = ctx.sheet;

    const item = hasComparison
      ? lookups.comparisonAverages[question.title]
      : lookups.averages[question.title];

    if (!item) {
      return;
    }

    sheet.getRange(ctx.row, 1).setValue("⭐ Средняя оценка");
    ctx.row += 1;

    const value2026 = hasComparison
      ? (item.value2026 !== null ? item.value2026 : "н/д")
      : item.average;

    const valueCell = sheet.getRange(ctx.row, 1);
    valueCell.setValue(value2026);
    Formatter.applyReportHighlightCard(sheet, valueCell);

    const delta = hasComparison ? item.delta : null;

    if (delta !== null && delta !== undefined) {

      const deltaCell = sheet.getRange(ctx.row, 2);
      deltaCell.setValue(this.formatSignedDelta_(delta, ""));
      deltaCell.setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center");
      // Средний балл rating5 — рост всегда хорошо (шкала оценки), в
      // отличие от отдельных вариантов ответа в GOOD_DIRECTION_.
      Formatter.setDeltaFontColor(deltaCell, delta, "up");

    }

    ctx.row += 1;

  },

  /**
   * Из четырех вопросов типа "single" (единственных в каталоге —
   * Город/Отдел/Стаж/Формат работы, см. renderQuestionBlock_) только эти
   * два отражают изменение структуры компании, поэтому для них Δ
   * оставляем; для Города/Отдела — нет (это просто описание состава
   * выборки, а не аналитическое сравнение). Тип/display у всех четырех
   * вопросов одинаковые, поэтому это единственное, что нельзя вывести
   * из существующих свойств Questions.gs — здесь минимально необходимый
   * список конкретных названий, а не полноценная конфигурация.
   */
  SINGLE_QUESTIONS_WITH_DELTA_: ["Стаж", "Формат работы"],

  // Порог для сворачивания мелких городов в одну строку "Другие города"
  // (см. collapseSmallCities_) — только для вопроса "Город".
  SMALL_CITY_THRESHOLD_: 3,

  /**
   * Свернуть города с count2026 < SMALL_CITY_THRESHOLD_ в одну итоговую
   * строку "Другие города". Города выше порога остаются как есть,
   * порядок (по убыванию count2026, задан раньше в renderQuestionBlock_)
   * не меняется — "Другие города" всегда добавляется последней строкой,
   * без участия в сортировке. Если мелких городов нет — items
   * возвращается без изменений (строка "Другие города" не добавляется).
   *
   * percent2026 для "Другие города" считается один раз от точной суммы
   * count2026, а НЕ суммой уже округленных percent2026 маленьких
   * городов — Statistics.calculateDistribution уже округляет percent
   * при вычислении (Math.round(count/total*100)), Comparison лишь
   * передает это готовое значение дальше без изменений. Сумма нескольких
   * округленных процентов накопила бы погрешность округления (три
   * города по фактическим 0,4% дали бы 0%+0%+0%=0% вместо верных ~1%).
   * count2026 при этом точный (не округлен), поэтому total (сумма
   * count2026 по items) и итоговый Math.round дают тот же результат, что
   * получился бы, если бы "Другие города" изначально были одной
   * категорией распределения в Statistics.gs — новых расчетов по сырым
   * ответам по-прежнему нет, только другой порядок суммирования/округления
   * уже имеющихся count.
   */
  collapseSmallCities_(items) {

    const bigCities = items.filter(item => item.count2026 >= this.SMALL_CITY_THRESHOLD_);
    const smallCities = items.filter(item => item.count2026 < this.SMALL_CITY_THRESHOLD_);

    if (smallCities.length === 0) {
      return items;
    }

    const otherCount = smallCities.reduce((sum, item) => sum + item.count2026, 0);
    const totalRespondents = items.reduce((sum, item) => sum + item.count2026, 0);
    const otherPercent = totalRespondents > 0 ? Math.round(otherCount / totalRespondents * 100) : 0;

    return bigCities.concat([{ answer: "Другие города", count2026: otherCount, percent2026: otherPercent }]);

  },

  /**
   * Простой список "название — кол-во (%)[, Δ]" для вопросов типа
   * "single" (Город/Отдел/Стаж/Формат работы) — без бара (в отличие от
   * renderCompactAnswerList_) и без заголовка таблицы. Для Города items
   * уже могут быть свернуты через collapseSmallCities_ (мелкие города →
   * "Другие города") до вызова этой функции — сама она просто выводит
   * то, что получила, ничего не агрегируя и не усекая. Δ, если
   * showDelta — целое число со стрелкой, без десятых (например,
   * "▲ +4", а не "▲ +4,0" — см. Formatter.applyCompactDeltaIntegerFormat),
   * цвет — как и везде в отчете (Formatter.setDeltaFontColor), без
   * отдельных "2025, кол-во"/"2025, %" колонок.
   */
  renderReferenceAnswerList_(ctx, items, showDelta) {

    const sheet = ctx.sheet;
    const width = showDelta ? 3 : 2;

    items.forEach((item, index) => {

      const row = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;

      sheet.getRange(row, 1).setValue(item.answer);

      const countCell = sheet.getRange(row, 2);
      countCell.setValue(
        percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)"
      );
      countCell.setFontWeight("bold").setHorizontalAlignment("right");

      if (showDelta) {

        const hasDelta = item.delta !== null && item.delta !== undefined;
        const deltaCell = sheet.getRange(row, 3);

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold").setHorizontalAlignment("center");

        if (hasDelta) {
          Formatter.applyCompactDeltaIntegerFormat(deltaCell);
          Formatter.setDeltaFontColor(deltaCell, item.delta, "up");
        }

      }

      Formatter.applyZebraStripe(sheet.getRange(row, 1, 1, width), index);

      ctx.row += 1;

    });

  },

  /**
   * Таблица "Ответ | 2026 кол-во | 2026 % | 2025 кол-во | 2025 % | Δ" —
   * общая для распределений и Топ-5, колонки процента/сравнения
   * появляются только если для них есть данные (hasPercent/hasComparison).
   */
  renderAnswerTable_(ctx, items, hasComparison, hasPercent, currentYear, previousYear) {

    const sheet = ctx.sheet;
    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Ответ");
    sheet.getRange(headerRow, 2).setValue(currentYear + ", кол-во");

    let width = 2;

    if (hasPercent) {
      sheet.getRange(headerRow, 3).setValue(currentYear + ", %");
      width = 3;
    }

    if (hasComparison) {
      sheet.getRange(headerRow, 4).setValue(previousYear + ", кол-во");
      if (hasPercent) {
        sheet.getRange(headerRow, 5).setValue(previousYear + ", %");
      }
      sheet.getRange(headerRow, 6).setValue("Δ");
      width = 6;
    }

    Formatter.formatReportTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const firstDataRow = ctx.row;
    const formatNullable = value => value !== null && value !== undefined ? value : "н/д";

    items.forEach((item, index) => {

      const row = firstDataRow + index;

      sheet.getRange(row, 1).setValue(item.answer);

      const countCell = sheet.getRange(row, 2);
      countCell.setValue(item.count2026);
      countCell.setHorizontalAlignment("right");

      if (hasPercent) {
        const percentCell = sheet.getRange(row, 3);
        percentCell.setValue(
          item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 + "%" : "н/д"
        );
        percentCell.setHorizontalAlignment("right");
      }

      if (hasComparison) {
        sheet.getRange(row, 4).setValue(formatNullable(item.count2025)).setHorizontalAlignment("right");
        if (hasPercent) {
          sheet.getRange(row, 5).setValue(
            item.percent2025 !== null && item.percent2025 !== undefined ? item.percent2025 + "%" : "н/д"
          ).setHorizontalAlignment("right");
        }
        sheet.getRange(row, 6).setValue(formatNullable(item.delta)).setHorizontalAlignment("center");
      }

      Formatter.applyZebraStripe(sheet.getRange(row, 1, 1, width), index);

    });

    if (items.length > 0) {

      if (hasComparison) {
        const deltaRange = sheet.getRange(firstDataRow, 6, items.length, 1);
        Formatter.applyDeltaNumberFormat(deltaRange, " п.п.");
        Formatter.applyDeltaHighlighting(sheet, deltaRange, this.DELTA_THRESHOLD_PERCENT);
      }

    }

    ctx.row = firstDataRow + items.length;

  },

  /**
   * Компактный список вместо таблицы "Ответ | 2026 кол-во | 2026 % |
   * 2025 кол-во | 2025 % | Δ" — для вопросов со шкалой "Да / Скорее
   * да / Скорее нет / Нет" (см. Questions.isYesNoScale) и для
   * распределений rating5, чтобы результат было проще воспринимать
   * руководителям. Использует те же уже посчитанные count/percent/delta,
   * что и renderAnswerTable_ — меняется только визуальное представление,
   * не расчеты. formatLabel — как подписать вариант ответа в этом
   * конкретном вопросе (с заглавной буквы для "да/нет", с эмодзи-легендой
   * для оценок rating5 — см. вызовы в renderQuestionBlock_).
   *
   * Каждая строка: вариант ответа, "кол-во (%)" за 2026, мини-полоса
   * прогресса по % 2026, и (если есть сравнение) Δ к 2025 — та же
   * подсветка/формат, что и в остальных сравнительных таблицах отчета.
   * Ниже списка, если есть сравнение, одной мелкой серой строкой —
   * справочные значения 2025 по всем вариантам (2026 остается главным).
   * formatSummaryLabel — отдельная (более простая) подпись варианта
   * ответа для этой справочной строки; по умолчанию совпадает с
   * formatLabel, но может отличаться (например, без эмодзи-легенды у
   * rating5 — чтобы не спорить за внимание с основным 2026-списком).
   */
  renderCompactAnswerList_(
    ctx, items, hasComparison, currentYear, previousYear,
    formatLabel, formatSummaryLabel, resolveBarColor
  ) {

    const summaryLabel = formatSummaryLabel || formatLabel;
    const sheet = ctx.sheet;

    if (items.length === 0) {
      return;
    }

    const width = hasComparison ? 4 : 3;

    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Ответ");
    sheet.getRange(headerRow, 2).setValue(currentYear);

    if (hasComparison) {
      sheet.getRange(headerRow, 4).setValue("Δ (п.п.)");
    }

    Formatter.formatReportTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const firstRow = ctx.row;

    items.forEach((item, index) => {

      const row = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;
      const rowRange = sheet.getRange(row, 1, 1, width);

      sheet.getRange(row, 1).setValue(formatLabel(item.answer));

      const countCell = sheet.getRange(row, 2);
      countCell.setValue(
        percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)"
      );
      countCell.setFontWeight("bold").setHorizontalAlignment("right");

      const barColor = resolveBarColor ? resolveBarColor(item.answer) : Formatter.ACCENT_TEAL;
      Formatter.setBlockProgressBar(sheet.getRange(row, 3), percent2026 !== null ? percent2026 : 0, null, barColor);

      if (hasComparison) {

        const deltaCell = sheet.getRange(row, 4);
        const hasDelta = item.delta !== null && item.delta !== undefined;

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold").setHorizontalAlignment("center");

        if (hasDelta) {
          Formatter.setDeltaFontColor(deltaCell, item.delta, this.getGoodDirection_(item.answer));
        }

      }

      Formatter.applyZebraStripe(rowRange, index);

      ctx.row += 1;

    });

    if (hasComparison) {

      const deltaRange = sheet.getRange(firstRow, 4, items.length, 1);
      Formatter.applyCompactDeltaNumberFormat(deltaRange);

      const summary = items
        .map(item => {
          const value2025 = (item.percent2025 !== null && item.percent2025 !== undefined)
            ? item.count2025 + " (" + item.percent2025 + "%)"
            : "н/д";
          return summaryLabel(item.answer) + " " + value2025;
        })
        .join(" • ");

      const summaryRow = ctx.row;

      sheet.getRange(summaryRow, 1).setValue(previousYear + ": " + summary);
      Formatter.formatMutedSmall(sheet.getRange(summaryRow, 1));

      ctx.row += 1;

    }

  },

  /**
   * Первая буква строки — заглавная (для подписи варианта ответа,
   * который в каталоге Questions.gs хранится в нижнем регистре).
   */
  capitalize_(text) {
    return text && text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  },

  /**
   * Рейтинговое отображение для всех вопросов MULTIPLE (display "Топ 5"):
   * автоматически применяется к любому такому вопросу, специализированного
   * рендера под конкретный вопрос нет (см. вызов в renderQuestionBlock_).
   * Сохраняет все существующие данные (кол-во/%/бар/Δ) и добавляет два
   * новых показателя, которые нигде раньше не считались: место в
   * рейтинге (медаль/номер) и его изменение к прошлому году.
   *
   * Ранг 2026 — это просто позиция в уже готовом items (items приходят
   * отсортированными по count2026 — тем же порядком, что и раньше строила
   * таблицу Comparison.compareTopAnswerItems/Statistics.selectTopAnswers,
   * см. renderQuestionBlock_). Ранг 2025 считается тем же способом — той
   * же стабильной сортировкой JS Array.sort по count2025 — поэтому при
   * равенстве count2025 у нескольких вариантов порядок между ними
   * сохраняется таким, каким он был в items (без новой логики разрешения
   * ничьих). positionDelta = rank2025 - rank2026: >0 — поднялся в
   * рейтинге (зеленый), <0 — опустился (красный), 0 — не изменился (серый).
   *
   * Стрелки Δ (▲/▼, изменение процента) и изменения позиции (↗/↘/→)
   * используют разные символы намеренно — иначе визуально не отличить,
   * какая стрелка к чему относится (см. formatRankChange_).
   */
  renderRankedAnswerList_(ctx, items, hasComparison, previousYear) {

    const sheet = ctx.sheet;

    if (items.length === 0) {
      return;
    }

    if (hasComparison) {
      const headerRow = ctx.row;
      const deltaHeaderCell = sheet.getRange(headerRow, 3);
      const positionHeaderCell = sheet.getRange(headerRow, 4);
      deltaHeaderCell.setValue("Δ (п.п.)");
      positionHeaderCell.setValue("Позиция");
      // Легкий серый подзаголовок колонок, а не бирюзовая
      // заливка полноценного заголовка мини-таблицы (см.
      // Formatter.formatReportTableHeader) — по макету у рейтингового
      // списка нет отдельной строки-заголовка "Ответ"/"2026" (эти
      // значения и так очевидны из самого рейтинга), колонки Δ/Позиция
      // подписаны мелким приглушенным текстом по центру.
      sheet.getRange(headerRow, 3, 1, 2)
        .setFontFamily(Formatter.REPORT_FONT)
        .setFontSize(9)
        .setFontColor(Formatter.MUTED_TEXT_COLOR)
        .setHorizontalAlignment("center");
      ctx.row += 1;
    }

    const rank2025ByAnswer = {};

    if (hasComparison) {
      items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (b.item.count2025 || 0) - (a.item.count2025 || 0))
        .forEach((entry, index) => { rank2025ByAnswer[entry.item.answer] = index + 1; });
    }

    items.forEach((item, index) => {

      const rank2026 = index + 1;

      const titleRow = ctx.row;
      const titleRange = sheet.getRange(titleRow, 1);
      titleRange.setValue(this.formatRankLabel_(rank2026) + " " + item.answer);
      Formatter.formatLabel(sheet, titleRange);
      ctx.row += 1;

      const metricsRow = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;

      // Небольшой отступ слева (не форматирование ячейки — Sheets Range
      // не дает API отступа абзаца) — визуально связывает строку
      // показателей со строкой заголовка над ней в один элемент рейтинга.
      const metricsLabelCell = sheet.getRange(metricsRow, 1);
      metricsLabelCell.setValue(
        "    " + (percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)")
      );
      metricsLabelCell.setFontWeight("bold");

      Formatter.setBlockProgressBar(
        sheet.getRange(metricsRow, 2), percent2026 !== null ? percent2026 : 0, null, Formatter.ACCENT_TEAL
      );

      if (hasComparison) {

        const deltaCell = sheet.getRange(metricsRow, 3);
        const hasDelta = item.delta !== null && item.delta !== undefined;

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold").setHorizontalAlignment("center");

        if (hasDelta) {
          Formatter.applyCompactDeltaNumberFormat(deltaCell);
          Formatter.setDeltaFontColor(deltaCell, item.delta, "up");
        }

        const rank2025 = rank2025ByAnswer[item.answer];

        if (rank2025) {

          const positionDelta = rank2025 - rank2026;
          const positionCell = sheet.getRange(metricsRow, 4);

          positionCell.setValue(this.formatRankChange_(positionDelta));
          positionCell.setFontWeight("bold").setHorizontalAlignment("center");
          positionCell.setFontColor(
            positionDelta > 0
              ? Formatter.DELTA_GOOD_COLOR
              : (positionDelta < 0 ? Formatter.DELTA_BAD_COLOR : Formatter.DELTA_NEUTRAL_COLOR)
          );

        }

      }

      // Только строка показателей чередует заливку (см. макет: заголовок
      // пункта рейтинга всегда без заливки, "зебра" — только на второй
      // строке каждого пункта) — index здесь совпадает с рангом-1, т.е.
      // одна и та же чередующаяся заливка для всех пунктов рейтинга.
      Formatter.applyZebraStripe(sheet.getRange(metricsRow, 1, 1, hasComparison ? 4 : 2), index);

      ctx.row += 1; // без пустой строки — каждый пункт рейтинга занимает ровно 2 строки

    });

    if (hasComparison) {

      // Строка "2025:" — в порядке рейтинга 2025 (не 2026), полный текст
      // вариантов ответа без сокращений.
      const orderedBy2025 = items.slice().sort(
        (a, b) => rank2025ByAnswer[a.answer] - rank2025ByAnswer[b.answer]
      );

      const summary = orderedBy2025
        .map((item, index) => {
          const value2025 = (item.percent2025 !== null && item.percent2025 !== undefined)
            ? "(" + item.percent2025 + "%)"
            : "(н/д)";
          return this.formatRankLabel_(index + 1) + " " + item.answer + " " + value2025;
        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue(previousYear + ": " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Место в рейтинге: медаль для топ-3, "N." для остальных.
   */
  formatRankLabel_(rank) {
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    return medals[rank] || (rank + ".");
  },

  /**
   * Изменение позиции в рейтинге: "↗ N" / "↘ N" / "→". Единственное место
   * в отчете, где формируется это значение (рендер только вызывает этот
   * метод и красит ячейку по знаку positionDelta — своей проверки/строк
   * не дублирует). Символы намеренно другие, чем у Δ процента (▲/▼) —
   * иначе визуально не отличить рост процента от роста позиции в
   * рейтинге. "→" — обычный текст, а не "=": строка, начинающаяся с "="
   * в Range.setValue трактуется Google Sheets как формула и раньше
   * приводила к #ERROR!.
   */
  formatRankChange_(positionDelta) {

    if (positionDelta > 0) {
      return "↗ " + positionDelta;
    }

    if (positionDelta < 0) {
      return "↘ " + Math.abs(positionDelta);
    }

    return "→";

  },

  /**
   * Сырые данные — самый низкий приоритет чтения (тир 4), поэтому
   * визуально отделены толстой границей сверху и свернуты по
   * умолчанию. Содержимое (заголовки/строки) не меняется.
   */
  renderRawData_(ctx, reportData) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;

    const rawHeaders = reportData.headers;
    const rawRows = reportData.filteredRows;

    const titleRange = sheet.getRange(ctx.row, 1, 1, 6);
    titleRange.setValue(
      "🗄️ Сырые данные (" + reportData.employees + " " +
      this.pluralizeRu_(reportData.employees, ["ответ", "ответа", "ответов"]) + ")"
    );
    Formatter.formatSectionTitle(sheet, titleRange);
    Formatter.formatSectionDivider(sheet.getRange(ctx.row, 1, 1, Math.max(rawHeaders.length, 1)));
    ctx.row += 1;

    const rawHeaderRow = ctx.row;

    sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length).setValues([rawHeaders]);
    Formatter.formatRawDataHeader(
      sheet, sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length)
    );
    ctx.row += 1;

    if (rawRows.length > 0) {

      sheet.getRange(rawHeaderRow + 1, 1, rawRows.length, rawHeaders.length).setValues(rawRows);

      ctx.row += rawRows.length;

    }

    // Стандартный Filter Google Sheets (не Filter View) строго на
    // таблицу сырых данных: от строки заголовков до последней строки
    // текущей выборки, по всем столбцам — заголовок становится строкой
    // фильтра с выпадающими списками, остальные разделы листа не
    // затрагивает (Range.createFilter ограничивает фильтр этим диапазоном).
    sheet.getRange(rawHeaderRow, 1, rawRows.length + 1, rawHeaders.length).createFilter();

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Сформировать название листа отчета на основе значений выбранных
   * фильтров, без названий вопросов. Если фильтры не выбраны —
   * "Все сотрудники". Несколько фильтров соединяются через " • ".
   */
  generateReportName(filters) {

    const activeFilters = (filters || []).filter(filter => this.hasFilterValue(filter));

    if (activeFilters.length === 0) {
      return "Все сотрудники";
    }

    const parts = activeFilters.map(filter => this.formatFilterValueOnly_(filter));

    return this.sanitizeSheetName(parts.join(" • "));

  },

  /**
   * Значение фильтра без названия вопроса (для автогенерируемого
   * названия отчета). Для rating5/enps — оператор+число, для
   * остальных — выбранные варианты через запятую.
   */
  formatFilterValueOnly_(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.operator + filter.value;
    }

    return filter.values.join(", ");

  },

  /**
   * Убрать символы, запрещенные в названии листа Google Sheets ([ ] * ? : / \),
   * и ограничить длину 100 символами.
   */
  sanitizeSheetName(name) {

    const sanitized = name.replace(/[\[\]\*\?:\/\\]/g, "_");

    return sanitized.length > 100 ? sanitized.substring(0, 100) : sanitized;

  },

  /**
   * Сигнатура параметров построения отчета: источник данных, включено
   * ли сравнение, все выбранные фильтры и их значения. Не зависит от
   * порядка выбора фильтров и от названия листа.
   */
  getReportKey_(reportData) {

    const normalizedFilters = this.getNormalizedFilters(reportData.filters);

    const payload = JSON.stringify({
      source: reportData.source,
      comparison: !!reportData.comparison,
      filters: normalizedFilters
    });

    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload, Utilities.Charset.UTF_8)
      .map(byte => ((byte + 256) % 256).toString(16).padStart(2, "0"))
      .join("");

  },

  /**
   * Нормализованный набор фильтров: только фильтры с заданным значением,
   * приведенные к стабильному виду и отсортированные по названию вопроса.
   *
   * Описывает сами ФИЛЬТРЫ выборки и ничего кроме них: результат не
   * зависит ни от порядка, в котором пользователь их добавлял, ни от
   * источника данных, ни от того, включено ли сравнение. Поэтому
   * используется в двух местах с разным смыслом: здесь — как часть
   * сигнатуры конкретного отчета (getReportKey_ добавляет к нему источник
   * и флаг сравнения), а в сводной аналитике — как часть ключа строки
   * (см. Summary.buildSampleKey_, который добавляет к нему источник, но
   * не флаг сравнения — тот влияет только на отображение отчета, а не на
   * то, какая это выборка).
   */
  getNormalizedFilters(filters) {

    return (filters || [])
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.normalizeFilterForKey_(filter))
      .sort((a, b) => a.question.localeCompare(b.question));

  },

  /**
   * Приводит один фильтр к стабильному для сигнатуры виду.
   */
  normalizeFilterForKey_(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return { question: filter.question, operator: filter.operator, value: filter.value };
    }

    return { question: filter.question, values: (filter.values || []).slice().sort() };

  },

  /**
   * Найти лист ранее созданного отчета с той же сигнатурой параметров,
   * если он есть. Поиск идет по developer metadata, а не по имени листа.
   */
  findReportSheetByKey_(ss, reportKey) {

    const matches = ss.createDeveloperMetadataFinder()
      .withKey(this.REPORT_KEY_METADATA_KEY)
      .withValue(reportKey)
      .find();

    return matches.length > 0 ? matches[0].getLocation().getSheet() : null;

  },

  /**
   * Подобрать уникальное имя листа, добавляя суффиксы _2, _3 и т.д.,
   * если имя уже занято, с учетом ограничения в 100 символов.
   * excludeSheet (опционально) — лист, который не считается коллизией
   * (например, сам переименовываемый лист уже мог носить это имя).
   */
  getUniqueSheetName(ss, baseName, excludeSheet) {

    let name = baseName;
    let counter = 2;

    const isTaken = candidate => {
      const found = ss.getSheetByName(candidate);
      return found !== null && found !== excludeSheet;
    };

    while (isTaken(name)) {
      const suffix = "_" + counter;
      const trimmedBase = baseName.length + suffix.length > 100
        ? baseName.substring(0, 100 - suffix.length)
        : baseName;
      name = trimmedBase + suffix;
      counter++;
    }

    return name;

  },

  /**
   * Есть ли у фильтра значение, которое стоит показать в паспорте выборки
   */
  hasFilterValue(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.value !== undefined && filter.value !== null && filter.value !== "";
    }

    return filter.values && filter.values.length > 0;

  },

  /**
   * Текстовое представление фильтра для паспорта выборки
   */
  formatFilterForPassport(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.question + filter.operator + filter.value;
    }

    return filter.question + "=" + filter.values.join(", ");

  },

  // Словарь тем для детектора темы/тональности открытых комментариев.
  // triggers — по чему тема считается упомянутой (подстрокой, без учета
  // регистра; специально заданы основами слов без окончаний, чтобы
  // одна запись матчила все словоформы — например "бюрократ" matчит и
  // "бюрократия", и "бюрократии", и "бюрократический"). negative/positive —
  // маркеры тональности, которые ищутся не по всему комментарию, а только
  // в предложении(ях), где нашелся триггер (см. matchCommentThemes_).
  THEME_DICTIONARY_: [
    { theme: "Бюрократия/процессы",
      triggers: ["бюрократ", "процесс", "youtrack", "ютрек", "согласовани", "регламент", "трекать время", "трекинг"],
      negative: ["сложно", "долго", "мешает", "усложн", "перегруж", "хаос", "тяжело", "непонятно"],
      positive: ["упрости", "стало лучше", "устраива", "понятно", "хорошо налажен"] },
    { theme: "Корпоративы/общие мероприятия",
      triggers: ["корпоратив", "тимбилдинг"],
      negative: ["вернуть", "не хватает", "сократили", "мало", "отменили", "реже", "объединили"],
      positive: ["нравится", "отлично организован", "спасибо за"] },
    { theme: "Слёты/командировки (логистика)",
      triggers: ["слёт", "слет", "командировк", "размещени", "гостиниц", "билет"],
      negative: ["доплата", "за свой счёт", "мизерн", "одиночн", "неудобно"],
      positive: ["достаточно", "хорошо организован"] },
    { theme: "Зарплата/индексация",
      triggers: ["зарплат", "оклад", "индексаци", "13-я", "премия", "премиальн"],
      negative: ["не поспевает", "мало", "недоволен", "ниже рынка", "редко пересматр", "инфляц"],
      positive: ["устраива", "справедлив", "вовремя"] },
    { theme: "ДМС",
      triggers: ["дмс"],
      negative: ["плохо", "неудобно", "ограничен список", "слабое", "не работает", "узкий"],
      positive: ["хорошее", "устраива", "добавили"] },
    { theme: "Удалёнка/изоляция",
      triggers: ["удаленщик", "удалённ", "живого общения"],
      negative: ["не хватает", "изолирован", "редко видим", "забыт"],
      positive: ["достаточно", "хватает"] },
    { theme: "Компенсация спорта",
      triggers: ["спорт", "тренаж", "фитнес"],
      negative: ["нет", "хотелось бы", "не хватает"],
      positive: ["есть", "компенсир"] },
    { theme: "Мерч",
      triggers: ["мерч"],
      negative: ["плохой", "забыли", "редко", "не дошёл", "хреновый"],
      positive: ["классный", "качественный", "спасибо"] },
    { theme: "IT-ипотека/жильё",
      triggers: ["ипотек"],
      negative: ["нет возможности", "вернуть", "забрали", "льготн"],
      positive: [] },
    { theme: "Бытовые условия офиса",
      triggers: ["кондиционер", "вентиляц", "туалет", "столов", "кофемашин", "парковк", "душно", "шумно"],
      negative: ["сломан", "не работает", "тесно", "мало", "плохо"],
      positive: ["хорошо", "отремонтир"] },
    { theme: "Рабочая техника/оборудование",
      triggers: ["ноутбук", "компьютер", "монитор", "оперативн памят", "ядр"],
      negative: ["слаб", "старый", "не хватает", "маловато"],
      positive: ["норм", "хорошая"] },
    { theme: "Гибкость графика",
      triggers: ["4-дневк", "no-meeting", "гибкий график", "шестичасов"],
      negative: ["хотелось бы", "нет", "не хватает"],
      positive: ["есть", "устраива"] },
    { theme: "Обратная связь/1-on-1",
      triggers: ["обратн связь", "перфоманс ревью", "1 на 1", "фидбэк"],
      negative: ["редко", "не хватает", "непонятно", "формальн"],
      positive: ["хорошая", "регулярн"] },
    { theme: "Карьерный рост/грейды",
      triggers: ["карьерн рост", "грейд", "трек развития", "повышени"],
      negative: ["непрозрачн", "нет системы", "сложно"],
      positive: ["есть", "понятно"] },
    { theme: "Прозрачность стратегии",
      triggers: ["стратеги", "планы компании", "цели компании", "куда движ"],
      negative: ["непонятно", "не рассказывают", "нет информации"],
      positive: ["понятно", "рассказывают"] },
    { theme: "Доступ к инструментам (VPN/нейросети)",
      // "ии" исключен из триггеров: как подстрока он матчит почти любое
      // слово в родительном/предложном падеже ("компании", "экономии" и
      // т.п.), из-за чего тема ложно срабатывала на 74 из 514
      // комментариев практически без отношения к теме VPN/нейросетей —
      // обнаружено при ручной проверке словаря на реальных данных.
      triggers: ["впн", "нейросет", "ai"],
      negative: ["нет доступа", "самим искать"],
      positive: ["есть доступ"] },
    { theme: "Токсичность/культура критики",
      triggers: ["критик", "токсичн", "штыки"],
      negative: ["не воспринимают", "боятся"],
      positive: ["конструктивн", "открытость"] }
  ],

  // Мусорный остаток после вычитания всех известных чекбокс-вариантов из
  // "Ценишь в компании"/"Зоны роста компании" — пунктуация без смысла,
  // не свободный текст. Семантически пустые, но осмысленные фразы
  // ("ничего", "всё устраивает") сюда намеренно не входят: они не
  // заденут ни один триггер темы и вреда не несут, а фильтровать их
  // отдельным списком было бы гаданием по формулировкам.
  EMPTY_COMMENT_REMAINDERS_: ["", "-", ".", "\\-"],

  /**
   * Тексты для детектора тем/тональности: "Открытая ОС 1"/"Открытая ОС 2"
   * как есть, плюс свободный текст из "Ценишь в компании"/"Зоны роста
   * компании" — эти два вопроса в анкете являются чекбоксами С полем
   * "свой вариант" в той же ячейке (варианты и свой текст разделены тем
   * же ".," что и в Statistics.parseMultiAnswer_/calculateAnswerFrequencies),
   * поэтому сначала из ячейки вычитаются все части, совпадающие с
   * каталожным списком вариантов (см. extractCommentRemainder_), и в
   * список комментариев попадает только то, что осталось.
   *
   * Источник — reportData.filteredRows/headers (уже отфильтрованные под
   * текущий срез), а не reportData.distributions/topAnswers — эти два
   * вопроса нигде в стандартном конвейере отчета не собираются
   * (report:false/display:"❌" в Questions.gs), готового массива для них
   * нет.
   *
   * @param {Object} reportData
   * @returns {Array<string>}
   */
  buildCommentsForThemeDetection_(reportData) {

    const headers = reportData.headers;
    const rows = reportData.filteredRows;
    const comments = [];

    ["Открытая ОС 1", "Открытая ОС 2"].forEach(title => {

      const columnIndex = this.findQuestionColumnIndex_(headers, title);

      if (columnIndex === -1) {
        return;
      }

      rows.forEach(row => {

        const text = String(row[columnIndex] || "").trim();

        if (text) {
          comments.push(text);
        }

      });

    });

    Questions.getTopAnswerQuestions().forEach(question => {

      const columnIndex = this.findQuestionColumnIndex_(headers, question.title);

      if (columnIndex === -1) {
        return;
      }

      rows.forEach(row => {

        const remainder = this.extractCommentRemainder_(row[columnIndex], question.answers);

        if (remainder) {
          comments.push(remainder);
        }

      });

    });

    return comments;

  },

  /**
   * Индекс столбца по названию вопроса, без учета регистра/пробелов —
   * тот же способ сравнения заголовков, что и везде в Statistics.
   */
  findQuestionColumnIndex_(headers, title) {

    return headers.findIndex(header => Statistics.normalize_(header) === Statistics.normalize_(title));

  },

  /**
   * Части чекбокс-ячейки с полем "свой вариант" — та же сериализация,
   * что разбирает Statistics.parseMultiAnswer_ (разделитель ".," между
   * вариантами, срез висячей точки у каждой части). Отдельная копия, а
   * не вызов Statistics.parseMultiAnswer_ напрямую — это внутренний
   * (с подчеркиванием) метод Statistics, реализующий его собственный
   * разбор, а не общий API между модулями.
   */
  parseCheckboxCellParts_(raw) {

    const text = String(raw || "").trim();

    if (!text) {
      return [];
    }

    return text
      .split(/\.,\s*/)
      .map(part => part.trim().replace(/\.$/, "").trim())
      .filter(part => part.length > 0);

  },

  /**
   * Остаток ячейки чекбокс-вопроса после вычитания всех частей, которые
   * являются выбранными вариантами из канонического списка (question.answers,
   * см. Questions.parseAnswers_). Сравнение — не на точное равенство, а на
   * "часть начинается с канонического варианта" после нормализации
   * (регистр, пробелы): реальный текст чекбокса в ячейке — это полная
   * формулировка из формы ("Стабильность: официальное оформление,
   * своевременные выплаты зарплаты, оплачиваемые отпуска и пр"), а
   * каталог в Questions.gs хранит только ее сокращенный лейбл
   * ("Стабильность") — точное совпадение почти никогда не сработало бы
   * и оставляло бы полный чекбокс-текст в остатке.
   *
   * null, если после вычитания ничего значимого не осталось (все части
   * распознаны как чекбоксы, либо остаток — чистая пунктуация без
   * смысла, см. EMPTY_COMMENT_REMAINDERS_).
   *
   * @param {*} raw - сырое значение ячейки
   * @param {Array<string>} canonicalAnswers - question.answers
   * @returns {string|null}
   */
  extractCommentRemainder_(raw, canonicalAnswers) {

    const parts = this.parseCheckboxCellParts_(raw);

    if (parts.length === 0) {
      return null;
    }

    const normalizedCanonical = canonicalAnswers.map(answer => this.normalizeForCheckboxMatch_(answer));

    const leftover = parts.filter(part => {
      const normalizedPart = this.normalizeForCheckboxMatch_(part);
      return !normalizedCanonical.some(canonicalAnswer => normalizedPart.indexOf(canonicalAnswer) === 0);
    });

    const text = leftover.join(" ").trim();

    return this.EMPTY_COMMENT_REMAINDERS_.indexOf(text) === -1 ? text : null;

  },

  normalizeForCheckboxMatch_(text) {
    return String(text).trim().toLowerCase().replace(/\s+/g, " ");
  },

  /**
   * Темы и тональность, найденные в ОДНОМ комментарии — по одной записи
   * на тему (не на предложение и не на срабатывание маркера), см.
   * detectCommentThemes_ про смысл "одного вердикта на пару
   * комментарий+тема".
   *
   * "Окно" поиска маркеров тональности — не весь комментарий, а
   * объединение только тех предложений, где нашелся хотя бы один
   * триггер темы (предложения разделяются точками и переносами строк).
   * Если тема упомянута в нескольких предложениях одного комментария —
   * маркеры ищутся по объединению всех этих предложений сразу, и это
   * все равно один результат на тему, а не несколько.
   *
   * @param {string} comment
   * @returns {Array<{theme: string, tone: "negative"|"positive"|"mixed"|"neutral"}>}
   */
  matchCommentThemes_(comment) {

    const lowerSentences = comment
      .split(/[.\n]+/)
      .map(sentence => sentence.toLowerCase())
      .filter(sentence => sentence.trim().length > 0);

    const results = [];

    this.THEME_DICTIONARY_.forEach(entry => {

      const matchingSentences = lowerSentences.filter(sentence =>
        entry.triggers.some(trigger => sentence.indexOf(trigger.toLowerCase()) !== -1)
      );

      if (matchingSentences.length === 0) {
        return;
      }

      const window = matchingSentences.join(" ");

      const hasNegative = entry.negative.some(marker => window.indexOf(marker.toLowerCase()) !== -1);
      const hasPositive = entry.positive.some(marker => window.indexOf(marker.toLowerCase()) !== -1);

      const tone = hasNegative && hasPositive ? "mixed" : hasNegative ? "negative" : hasPositive ? "positive" : "neutral";

      results.push({ theme: entry.theme, tone: tone });

    });

    return results;

  },

  /**
   * Темы и тональность по списку комментариев — не читает reportData,
   * работает с любым переданным списком, поэтому подходит для любого
   * среза. Использует matchCommentThemes_ на каждом комментарии и
   * агрегирует результат по темам.
   *
   * Порог включения темы в результат — total > 1 (см. задачу): тема,
   * упомянутая ровно один раз во всем списке, отсекается как случайное
   * совпадение, а не сигнал.
   *
   * @param {Array<string>} comments
   * @returns {Array<{theme: string, negative: number, positive: number, mixed: number, neutral: number, total: number}>}
   *          отсортировано по total по убыванию
   */
  detectCommentThemes_(comments) {

    const totalsByTheme = {};

    comments.forEach(comment => {

      if (!comment) {
        return;
      }

      this.matchCommentThemes_(comment).forEach(match => {

        if (!totalsByTheme[match.theme]) {
          totalsByTheme[match.theme] = { negative: 0, positive: 0, mixed: 0, neutral: 0 };
        }

        totalsByTheme[match.theme][match.tone]++;

      });

    });

    return Object.keys(totalsByTheme)
      .map(theme => {

        const counts = totalsByTheme[theme];
        const total = counts.negative + counts.positive + counts.mixed + counts.neutral;

        return {
          theme: theme,
          negative: counts.negative,
          positive: counts.positive,
          mixed: counts.mixed,
          neutral: counts.neutral,
          total: total
        };

      })
      .filter(entry => entry.total > 1)
      .sort((a, b) => b.total - a.total);

  }

};
