/**
 * ==========================================================
 * Построение отчета
 * ==========================================================
 */

const ReportBuilder = {

  // Порог нерепрезентативности выборки (UX-правило проекта, не
  // статистический расчет). При сравнении проверяется меньшая из
  // выборок 2026/2025 — именно она ограничивает надежность сравнения.
  SMALL_SAMPLE_THRESHOLD: 5,

  // UX-пороги для подсветки динамики (эвристика для визуального
  // выделения "заметных" изменений, НЕ статистическая значимость).
  // Значения относятся к предметной области отчета, поэтому живут
  // здесь, а не в Formatter — Formatter только умеет красить диапазон
  // по переданному порогу, не зная, откуда порог взялся.
  DELTA_THRESHOLD_RATING: 0.3,   // средние оценки (шкала 1-5), баллы
  DELTA_THRESHOLD_PERCENT: 5,    // eNPS/распределения/Top-5, п.п.

  // Ключ developer metadata, которым лист-отчет помечается сигнатурой
  // своих параметров построения (источник + сравнение + фильтры).
  // Позволяет находить "тот же" отчет независимо от его названия.
  REPORT_KEY_METADATA_KEY: "hranalytics_report_key",

  createReport(reportData, reportName, isCustomName) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reportKey = this.getReportKey_(reportData);
    const existingSheet = this.findReportSheetByKey_(ss, reportKey);

    // Если отчет с такими же параметрами уже существует — обновляем
    // его на месте (без удаления/пересоздания листа). Иначе создаем
    // новый лист с уникальным именем, не затрагивая прочие отчеты.
    const sheet = existingSheet || ss.insertSheet(this.getUniqueSheetName(ss, reportName));

    if (existingSheet) {
      // clear() не удаляет графики и не сбрасывает группировку строк —
      // без этого при повторной сборке графики накапливались бы, а
      // группировка либо превысила бы допустимую глубину, либо не
      // совпадала с новым содержимым.
      sheet.getCharts().forEach(chart => sheet.removeChart(chart));
      // ВРЕМЕННО отключено для диагностики зависания — resetRowGroups_
      // this.resetRowGroups_(sheet);
      sheet.clear();
      sheet.clearConditionalFormatRules();

      // Пользовательское название не участвует в поиске отчета (сигнатура
      // строится только по source/comparison/filters, см. getReportKey_),
      // но если оно задано и отличается от текущего — переименовываем лист.
      if (isCustomName && sheet.getName() !== reportName) {
        sheet.setName(this.getUniqueSheetName(ss, reportName, sheet));
      }
    } else {
      sheet.addDeveloperMetadata(this.REPORT_KEY_METADATA_KEY, reportKey);
    }

    Formatter.applyBaseFont(sheet.getRange("A1:F50"));
    Formatter.setColumnWidths(sheet, [320, 110, 110, 110, 110, 110]);

    // ctx.row — "курсор" текущей свободной строки. Каждый render-метод
    // дописывает свой блок начиная с ctx.row и сам сдвигает его дальше,
    // поэтому блоки верхней части листа можно переставлять местами, не
    // пересчитывая номера строк вручную.
    const ctx = { sheet: sheet, row: 1 };

    this.renderHeader_(ctx, reportData);
    this.renderPassport_(ctx, reportData);
    this.renderSampleWarning_(ctx, reportData);

    // Замораживаем строки заголовка/паспорта/предупреждения (без
    // хвостовой пустой строки-разделителя) — они остаются на виду при
    // прокрутке остальной, гораздо более длинной, части отчета.
    const frozenRows = ctx.row - 1;

    this.renderExecutiveSummary_(ctx, reportData);
    this.renderKeyIndicators_(ctx, reportData);
    this.renderDetailedAnalytics_(ctx, reportData);
    this.renderRawData_(ctx, reportData);

    Formatter.freezeHeader(sheet, frozenRows, 1);

    return sheet;

  },

  /**
   * Заголовок отчета: название + год источника, с пометкой о
   * включенном сравнении с 2025, если оно есть.
   */
  renderHeader_(ctx, reportData) {

    const sheet = ctx.sheet;
    const compareLabel = reportData.comparison ? " (сравнение с 2025)" : "";

    sheet.getRange(ctx.row, 1).setValue(
      "HR Analytics — " + reportData.source + compareLabel
    );
    Formatter.formatMainTitle(sheet.getRange(ctx.row, 1));

    ctx.row += 1;

  },

  /**
   * Паспорт выборки: источник, примененные фильтры, размер(ы) выборки.
   */
  renderPassport_(ctx, reportData) {

    const sheet = ctx.sheet;

    const activeFilters = reportData.filters
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.formatFilterForPassport(filter));

    const filtersText = activeFilters.length > 0
      ? activeFilters.join("; ")
      : "без фильтров";

    sheet.getRange(ctx.row, 1).setValue(
      "Источник: " + reportData.source + " · Фильтры: " + filtersText
    );
    ctx.row += 1;

    const sampleText = reportData.comparison
      ? "Размер выборки: 2026 — n=" + reportData.employees +
        "; 2025 — n=" + reportData.comparison.employees2025
      : "Размер выборки: n=" + reportData.employees;

    sheet.getRange(ctx.row, 1).setValue(sampleText);
    ctx.row += 1;

    ctx.row += 1; // пустая строка-разделитель

  },

  /**
   * Предупреждение о нерепрезентативной выборке (n < порога). Данные
   * при этом не скрываются — баннер только привлекает внимание.
   */
  renderSampleWarning_(ctx, reportData) {

    const sheet = ctx.sheet;

    const minSample = reportData.comparison
      ? Math.min(reportData.employees, reportData.comparison.employees2025)
      : reportData.employees;

    if (minSample >= this.SMALL_SAMPLE_THRESHOLD) {
      return;
    }

    const range = sheet.getRange(ctx.row, 1, 1, 3);

    range.setValue(
      "⚠ Выборка нерепрезентативна (n=" + minSample + " < " + this.SMALL_SAMPLE_THRESHOLD +
      ") — данные приведены, но интерпретируйте их с осторожностью"
    );
    Formatter.formatWarningBanner(range);

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

    sheet.getRange(ctx.row, 1).setValue("EXECUTIVE SUMMARY");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    sheet.getRange(ctx.row, 1).setValue(this.buildEnpsSummaryLine_(reportData));
    ctx.row += 1;

    const sortedDesc = reportData.averageRatings.slice().sort((a, b) => b.average - a.average);
    const sortedAsc = reportData.averageRatings.slice().sort((a, b) => a.average - b.average);

    sheet.getRange(ctx.row, 1).setValue(
      "Самые высокие показатели: " + this.formatRatingList_(sortedDesc.slice(0, 3))
    );
    ctx.row += 1;

    sheet.getRange(ctx.row, 1).setValue(
      "Самые низкие показатели: " + this.formatRatingList_(sortedAsc.slice(0, 3))
    );
    ctx.row += 1;

    if (reportData.comparison) {
      sheet.getRange(ctx.row, 1).setValue(this.buildDynamicsSummaryLine_(reportData));
      ctx.row += 1;
    }

    ctx.row += 1; // пустая строка-разделитель

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

    if (!reportData.comparison) {
      return "eNPS: " + enps;
    }

    const comparisonEnps = reportData.comparison.enps;

    if (comparisonEnps.delta === null || comparisonEnps.value2025 === null) {
      return "eNPS: " + enps + " (нет данных 2025 для сравнения)";
    }

    return "eNPS: " + enps + " (" + this.formatSignedDelta_(comparisonEnps.delta, " п.п.") +
      " к 2025: " + comparisonEnps.value2025 + ")";

  },

  /**
   * Строка "Динамика" для Executive Summary: eNPS + самые заметные
   * изменения средних оценок (выше UX-порога DELTA_THRESHOLD_RATING).
   * Если ни один вопрос порог не превышает — явный текст об этом,
   * а не подобранное "на всякий случай" значение.
   */
  buildDynamicsSummaryLine_(reportData) {

    const movers = reportData.comparison.averageRatings
      .filter(item => item.delta !== null && Math.abs(item.delta) >= this.DELTA_THRESHOLD_RATING)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (movers.length === 0) {
      return "Динамика: существенных изменений в средних оценках не выявлено";
    }

    const top = movers.slice(0, 3)
      .map(item => item.question + " " + this.formatSignedDelta_(item.delta, ""))
      .join("   ");

    return "Динамика: " + top;

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
   * Ключевые показатели: eNPS-карточка и ранжированный обзор всех
   * средних оценок — единственная "приборная панель" отчета. Дальше
   * идет только детальная аналитика по смысловым секциям анкеты
   * (следующие подэтапы).
   */
  renderKeyIndicators_(ctx, reportData) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue("КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    this.renderEnpsIndicator_(ctx, reportData);
    ctx.row += 1; // пустая строка-разделитель

    this.renderAverageOverview_(ctx, reportData);
    ctx.row += 1; // пустая строка-разделитель

  },

  /**
   * eNPS-карточка: промоутеры/нейтралы/критики и итог за 2026, плюс
   * итог 2025 и динамика, если сравнение включено. Разбивки
   * промоутеры/нейтралы/критики за 2025 сейчас нет в Comparison.gs —
   * решено пока показывать по 2025 только итоговое значение eNPS.
   */
  renderEnpsIndicator_(ctx, reportData) {

    const sheet = ctx.sheet;
    const enps = reportData.enps;
    const comparisonEnps = reportData.comparison ? reportData.comparison.enps : null;

    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Показатель");
    sheet.getRange(headerRow, 2).setValue("2026, кол-во");
    sheet.getRange(headerRow, 3).setValue("2026, %");

    if (comparisonEnps) {
      sheet.getRange(headerRow, 4).setValue("2025");
      sheet.getRange(headerRow, 6).setValue("Δ");
    }

    const width = comparisonEnps ? 6 : 3;
    Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const categoryRows = [
      { label: "eNPS — Промоутеры", count: enps.promoters, percent: enps.promotersPercent },
      { label: "eNPS — Нейтралы", count: enps.neutrals, percent: enps.neutralsPercent },
      { label: "eNPS — Критики", count: enps.detractors, percent: enps.detractorsPercent }
    ];

    categoryRows.forEach(item => {
      sheet.getRange(ctx.row, 1).setValue(item.label);
      sheet.getRange(ctx.row, 2).setValue(item.count);
      sheet.getRange(ctx.row, 3).setValue(item.percent + "%");
      ctx.row += 1;
    });

    const totalRow = ctx.row;

    sheet.getRange(totalRow, 1).setValue("eNPS — итог");
    sheet.getRange(totalRow, 2).setValue(enps.enps);
    Formatter.formatHighlightNumber(sheet.getRange(totalRow, 2));

    if (comparisonEnps) {

      sheet.getRange(totalRow, 4).setValue(
        comparisonEnps.value2025 !== null ? comparisonEnps.value2025 : "н/д"
      );

      if (comparisonEnps.delta !== null) {

        const deltaCell = sheet.getRange(totalRow, 6);
        deltaCell.setValue(comparisonEnps.delta);
        Formatter.applyDeltaNumberFormat(deltaCell, " п.п.");
        Formatter.applyDeltaHighlighting(sheet, deltaCell, this.DELTA_THRESHOLD_PERCENT);

      } else {
        sheet.getRange(totalRow, 6).setValue("н/д");
      }

    }

    ctx.row += 1;

    Formatter.addTableBorder(
      sheet.getRange(headerRow, 1, totalRow - headerRow + 1, width)
    );

  },

  /**
   * Обзор средних оценок: все rating5-вопросы, отсортированные по
   * убыванию (2026), с 2025 и динамикой при включенном сравнении, плюс
   * один горизонтальный график той же ранжированной выборки.
   */
  renderAverageOverview_(ctx, reportData) {

    const sheet = ctx.sheet;
    const hasComparison = !!reportData.comparison;
    const rows = this.buildAverageOverviewRows_(reportData);

    sheet.getRange(ctx.row, 1).setValue("Средние оценки — обзор");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    const headerRow = ctx.row;
    const width = hasComparison ? 4 : 2;

    sheet.getRange(headerRow, 1).setValue("Вопрос");
    sheet.getRange(headerRow, 2).setValue("2026");

    if (hasComparison) {
      sheet.getRange(headerRow, 3).setValue("2025");
      sheet.getRange(headerRow, 4).setValue("Δ");
    }

    Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const firstDataRow = ctx.row;
    const formatNullable = value => value !== null && value !== undefined ? value : "н/д";

    rows.forEach((item, index) => {

      const row = firstDataRow + index;

      sheet.getRange(row, 1).setValue(item.question);
      sheet.getRange(row, 2).setValue(formatNullable(item.value2026));

      if (hasComparison) {
        sheet.getRange(row, 3).setValue(formatNullable(item.value2025));
        sheet.getRange(row, 4).setValue(formatNullable(item.delta));
      }

    });

    if (rows.length === 0) {
      ctx.row = firstDataRow;
      return;
    }

    Formatter.addTableBorder(sheet.getRange(headerRow, 1, rows.length + 1, width));

    Formatter.applyColorScale(
      sheet,
      sheet.getRange(firstDataRow, 2, rows.length, 1),
      "#f4cccc", "#fff2cc", "#d9ead3"
    );

    if (hasComparison) {
      const deltaRange = sheet.getRange(firstDataRow, 4, rows.length, 1);
      Formatter.applyDeltaNumberFormat(deltaRange, "");
      Formatter.applyDeltaHighlighting(sheet, deltaRange, this.DELTA_THRESHOLD_RATING);
    }

    ctx.row = firstDataRow + rows.length + 1;

    this.insertAverageOverviewChart_(ctx, rows, firstDataRow, hasComparison);

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
   * Один горизонтальный график для ранжированного обзора средних
   * оценок — данные берутся из уже записанных на лист ячеек (та же
   * таблица), чтобы график и таблица гарантированно не расходились.
   */
  insertAverageOverviewChart_(ctx, rows, firstDataRow, hasComparison) {

    const sheet = ctx.sheet;
    const numColumns = hasComparison ? 3 : 2; // Вопрос + 2026[ + 2025]

    const dataRange = sheet.getRange(firstDataRow, 1, rows.length, numColumns);
    const chartHeight = Math.max(300, rows.length * 22);

    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(dataRange)
      .setOption("title", "Средние оценки" + (hasComparison ? " — 2026 vs 2025" : ""))
      .setOption("legend", { position: hasComparison ? "top" : "none" })
      .setOption("height", chartHeight)
      .setPosition(ctx.row, 1, 0, 0)
      .build();

    sheet.insertChart(chart);

    ctx.row += Math.ceil(chartHeight / 21) + 2;

  },

  /**
   * Детальная аналитика по смысловым секциям анкеты (ReportSections.gs).
   * Секции отличаются только составом вопросов и заголовком — поэтому
   * все шесть секций рендерятся одним и тем же методом (renderSection_),
   * а не отдельной функцией на каждую.
   */
  renderDetailedAnalytics_(ctx, reportData) {

    ReportSections.validate();

    const sheet = ctx.sheet;
    const hasComparison = !!reportData.comparison;
    const lookups = this.buildDetailLookups_(reportData);

    sheet.getRange(ctx.row, 1).setValue("ДЕТАЛЬНАЯ АНАЛИТИКА ПО СМЫСЛОВЫМ БЛОКАМ АНКЕТЫ");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;
    ctx.row += 1; // пустая строка-разделитель

    ReportSections.getSections().forEach(section => {
      this.renderSection_(ctx, section, lookups, hasComparison);
      ctx.row += 1; // разделитель между секциями
    });

  },

  /**
   * Быстрые словари "вопрос -> уже посчитанные данные" по названию —
   * без повторных расчетов, только группировка того, что уже есть в
   * reportData/reportData.comparison.
   */
  buildDetailLookups_(reportData) {

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
      comparisonAverages: comparisonAverages
    };

  },

  /**
   * Одна смысловая секция (например "Офис"): заголовок-саммари в виде
   * сворачиваемой группы, внутри — по очереди все вопросы секции.
   */
  renderSection_(ctx, section, lookups, hasComparison) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;

    sheet.getRange(ctx.row, 1).setValue(
      section.name + " — " + section.questions.length + " " +
      this.pluralizeRu_(section.questions.length, ["вопрос", "вопроса", "вопросов"])
    );
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
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
    const questionStartRow = ctx.row;

    sheet.getRange(ctx.row, 1).setValue(question.title);
    Formatter.formatLabel(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    if (question.average) {
      this.renderInlineAverage_(ctx, question, lookups, hasComparison);
    }

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

    const hasPercent = hasComparison || !isTopAnswers;

    this.renderAnswerTable_(ctx, items, hasComparison, hasPercent);

    const questionContentRows = ctx.row - 1 - questionStartRow;

    if (questionContentRows > 0) {
      Formatter.groupRows(sheet, questionStartRow + 1, questionContentRows, true);
    }

    ctx.row += 1; // разделитель между вопросами

  },

  /**
   * Строка со средней оценкой вопроса (только rating5) — то же
   * значение, что уже показано в "Средние оценки — обзор", здесь оно
   * повторяется для контекста внутри своей секции анкеты.
   */
  renderInlineAverage_(ctx, question, lookups, hasComparison) {

    const sheet = ctx.sheet;

    if (hasComparison) {

      const item = lookups.comparisonAverages[question.title];

      if (!item) {
        return;
      }

      const value2026 = item.value2026 !== null ? item.value2026 : "н/д";

      sheet.getRange(ctx.row, 1).setValue(
        item.delta !== null
          ? "Среднее: " + value2026 + " (2025: " + item.value2025 + ", " + this.formatSignedDelta_(item.delta, "") + ")"
          : "Среднее: " + value2026
      );

    } else {

      const item = lookups.averages[question.title];

      if (!item) {
        return;
      }

      sheet.getRange(ctx.row, 1).setValue("Среднее: " + item.average);

    }

    ctx.row += 1;

  },

  /**
   * Таблица "Ответ | 2026 кол-во | 2026 % | 2025 кол-во | 2025 % | Δ" —
   * общая для распределений и Топ-5, колонки процента/сравнения
   * появляются только если для них есть данные (hasPercent/hasComparison).
   */
  renderAnswerTable_(ctx, items, hasComparison, hasPercent) {

    const sheet = ctx.sheet;
    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Ответ");
    sheet.getRange(headerRow, 2).setValue("2026, кол-во");

    let width = 2;

    if (hasPercent) {
      sheet.getRange(headerRow, 3).setValue("2026, %");
      width = 3;
    }

    if (hasComparison) {
      sheet.getRange(headerRow, 4).setValue("2025, кол-во");
      if (hasPercent) {
        sheet.getRange(headerRow, 5).setValue("2025, %");
      }
      sheet.getRange(headerRow, 6).setValue("Δ");
      width = 6;
    }

    Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const firstDataRow = ctx.row;
    const formatNullable = value => value !== null && value !== undefined ? value : "н/д";

    items.forEach((item, index) => {

      const row = firstDataRow + index;

      sheet.getRange(row, 1).setValue(item.answer);
      sheet.getRange(row, 2).setValue(item.count2026);

      if (hasPercent) {
        sheet.getRange(row, 3).setValue(
          item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 + "%" : "н/д"
        );
      }

      if (hasComparison) {
        sheet.getRange(row, 4).setValue(formatNullable(item.count2025));
        if (hasPercent) {
          sheet.getRange(row, 5).setValue(
            item.percent2025 !== null && item.percent2025 !== undefined ? item.percent2025 + "%" : "н/д"
          );
        }
        sheet.getRange(row, 6).setValue(formatNullable(item.delta));
      }

    });

    if (items.length > 0) {

      Formatter.addTableBorder(sheet.getRange(headerRow, 1, items.length + 1, width));

      if (hasComparison) {
        const deltaRange = sheet.getRange(firstDataRow, 6, items.length, 1);
        Formatter.applyDeltaNumberFormat(deltaRange, " п.п.");
        Formatter.applyDeltaHighlighting(sheet, deltaRange, this.DELTA_THRESHOLD_PERCENT);
      }

    }

    ctx.row = firstDataRow + items.length;

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

    sheet.getRange(ctx.row, 1).setValue(
      "Сырые данные (" + rawHeaders.length + " " +
      this.pluralizeRu_(rawHeaders.length, ["столбец", "столбца", "столбцов"]) + ", " +
      rawRows.length + " " +
      this.pluralizeRu_(rawRows.length, ["строка", "строки", "строк"]) + ")"
    );
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    Formatter.formatSectionDivider(sheet.getRange(ctx.row, 1, 1, Math.max(rawHeaders.length, 1)));
    ctx.row += 1;

    const rawHeaderRow = ctx.row;

    sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length).setValues([rawHeaders]);
    Formatter.formatTableHeader(
      sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length)
    );
    ctx.row += 1;

    if (rawRows.length > 0) {

      sheet.getRange(rawHeaderRow + 1, 1, rawRows.length, rawHeaders.length).setValues(rawRows);

      Formatter.addTableBorder(
        sheet.getRange(rawHeaderRow, 1, rawRows.length + 1, rawHeaders.length)
      );

      ctx.row += rawRows.length;

    }

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

    const normalizedFilters = (reportData.filters || [])
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.normalizeFilterForKey_(filter))
      .sort((a, b) => a.question.localeCompare(b.question));

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
   * Полностью снять группировку строк листа (например, перед повторной
   * сборкой уже существующего отчета), чтобы новая группировка
   * создавалась с нуля и не накладывалась на старую.
   */
  resetRowGroups_(sheet) {

    const maxRows = sheet.getMaxRows();

    for (let row = 1; row <= maxRows; row++) {
      const depth = sheet.getRowGroupDepth(row);
      if (depth > 0) {
        sheet.getRange(row, 1).shiftRowGroupDepth(-depth);
      }
    }

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

  }

};