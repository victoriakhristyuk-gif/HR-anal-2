/**
 * ==========================================================
 * Рендер листа сравнения 2-4 выборок
 * ==========================================================
 *
 * Не полноценный отчет (см. ReportBuilder.createReport) — только те
 * разделы, которые дает SampleComparisonService.compareMany: eNPS,
 * средние оценки по вопросам, распределения ответов, Топ-5 открытых
 * вопросов. Каждая таблица строится в две части:
 *   1. значения по каждой выборке (A, B, C, D — сколько задано);
 *   2. дельты между КАЖДОЙ парой выборок (до 6 колонок при 4 выборках),
 *      со звездочкой у статистически значимых различий (HR-002,
 *      Comparison.build/MathStats) — кроме Топ-5, где значимость не
 *      считается и не считалась раньше (см. Comparison.compareTopAnswerItems).
 */

const SampleComparisonBuilder = {

  /**
   * Ширина листа (в столбцах) зависит от числа выборок: по одному
   * столбцу-значению на каждую + по одному столбцу-дельте на каждую пару.
   */
  computeContentColumns_(sampleCount) {
    const pairCount = sampleCount * (sampleCount - 1) / 2;
    return 1 + sampleCount + pairCount; // 1 — колонка подписи строки
  },

  buildPairIndex_(pairs) {

    const index = {};

    pairs.forEach(pair => {
      index[pair.i + "-" + pair.j] = pair.comparison;
    });

    return index;

  },

  renderMany(data) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const baseName = ReportBuilder.sanitizeSheetName("Сравнение • " + data.labels.join(" vs "));
    const sheet = ss.insertSheet(ReportBuilder.getUniqueSheetName(ss, baseName));

    const sampleCount = data.labels.length;
    const contentColumns = this.computeContentColumns_(sampleCount);

    Formatter.applyReportBaseFont(sheet.getRange(1, 1, 300, contentColumns));
    const widths = [220];
    for (let i = 0; i < sampleCount; i++) widths.push(100);
    for (let i = 0; i < sampleCount * (sampleCount - 1) / 2; i++) widths.push(95);
    Formatter.setColumnWidths(sheet, widths);

    const ctx = { sheet: sheet, row: 1, columns: contentColumns, sampleCount: sampleCount };

    this.renderHeader_(ctx, data);
    this.renderPassport_(ctx, data);
    const frozenRows = ctx.row - 1;

    this.renderEnpsSection_(ctx, data);
    this.renderAverageRatingsSection_(ctx, data);
    this.renderDistributionsSection_(ctx, data);
    this.renderTopAnswersSection_(ctx, data);

    Formatter.freezeHeader(sheet, frozenRows, 1);

    return sheet;

  },

  letterFor_(index) {
    return SAMPLE_COMPARISON_LETTERS[index];
  },

  renderHeader_(ctx, data) {
    const range = ctx.sheet.getRange(ctx.row, 1, 1, ctx.columns);
    range.setValue("Сравнение выборок: " + data.labels.join(" vs "));
    Formatter.formatReportMainTitle(ctx.sheet, range);
    ctx.row += 1;
  },

  renderPassport_(ctx, data) {

    const sheet = ctx.sheet;

    const describeFilters = filters => {
      const active = (filters || [])
        .filter(filter => ReportBuilder.hasFilterValue(filter))
        .map(filter => ReportBuilder.formatFilterForPassport(filter));
      return active.length > 0 ? active.join("; ") : "без фильтров";
    };

    const sourceLine = Formatter.wrapTextRow(sheet, ctx.row, ctx.columns);
    sourceLine.setValue("Источник: Ответы " + data.source);
    sourceLine.setFontColor(Formatter.MUTED_TEXT_COLOR);
    ctx.row += 1;

    data.labels.forEach((label, index) => {
      const headcount = data.headcounts[index];
      const line = Formatter.wrapTextRow(sheet, ctx.row, ctx.columns);
      line.setValue(
        "Выборка " + this.letterFor_(index) + " (" + label + "): " +
        describeFilters(data.filtersList[index]) +
        " · n=" + data.employees[index] +
        (headcount !== null && headcount !== undefined ? ", приглашены=" + headcount : "")
      );
      line.setFontColor(Formatter.MUTED_TEXT_COLOR);
      ctx.row += 1;
    });

    ctx.row += 1; // пустая строка-разделитель

  },

  renderSectionTitle_(ctx, title) {
    const range = ctx.sheet.getRange(ctx.row, 1, 1, ctx.columns);
    range.setValue(title);
    Formatter.formatSectionTitle(ctx.sheet, range);
    ctx.row += 1;
  },

  /** Заголовок таблицы: подпись строки + одна колонка на выборку + одна на каждую пару. */
  renderTableHeader_(ctx, data, rowLabel) {

    const headers = [rowLabel];

    for (let i = 0; i < ctx.sampleCount; i++) {
      headers.push(this.letterFor_(i) + ": " + data.labels[i]);
    }

    for (let i = 0; i < ctx.sampleCount; i++) {
      for (let j = i + 1; j < ctx.sampleCount; j++) {
        headers.push("Δ " + this.letterFor_(i) + "-" + this.letterFor_(j));
      }
    }

    ctx.sheet.getRange(ctx.row, 1, 1, headers.length).setValues([headers]);
    Formatter.formatReportTableHeader(ctx.sheet.getRange(ctx.row, 1, 1, headers.length));
    ctx.row += 1;

  },

  /** "Δ +5* " — звездочка только когда значимость известна и true. */
  formatPairDelta_(delta, significant) {
    if (delta === null || delta === undefined) return "н/д";
    const rounded = Math.round(delta * 100) / 100;
    const sign = rounded > 0 ? "+" : "";
    const star = significant === true ? "*" : "";
    return sign + rounded + star;
  },

  /** Пишет одну строку таблицы: rowLabel + sampleValues[] + pairCells[]. Возвращает диапазон дельт. */
  writeTableRow_(ctx, rowIndex, rowLabel, sampleValues, pairCells) {

    const row = [rowLabel].concat(sampleValues).concat(pairCells);
    const range = ctx.sheet.getRange(ctx.row, 1, 1, row.length);
    range.setValues([row]);
    Formatter.applyZebraStripe(range, rowIndex);

    ctx.row += 1;

  },

  renderEnpsSection_(ctx, data) {

    this.renderSectionTitle_(ctx, "eNPS");
    this.renderTableHeader_(ctx, data, "");

    const pairIndex = this.buildPairIndex_(data.pairs);

    const pairCellsForEnps = () => {
      const cells = [];
      for (let i = 0; i < ctx.sampleCount; i++) {
        for (let j = i + 1; j < ctx.sampleCount; j++) {
          const comparison = pairIndex[i + "-" + j].enps;
          cells.push(this.formatPairDelta_(comparison.delta, comparison.significant));
        }
      }
      return cells;
    };

    const enpsValues = data.metrics.map(m => m.enps.total > 0 ? m.enps.enps : "н/д");
    this.writeTableRow_(ctx, 0, "eNPS", enpsValues, pairCellsForEnps());

    const categoryLabels = { promoters: "Промоутеры", neutrals: "Нейтралы", detractors: "Критики" };

    ["promoters", "neutrals", "detractors"].forEach((category, index) => {

      const values = data.metrics.map(m =>
        m.enps.total > 0 ? m.enps[category + "Percent"] + "%" : "н/д"
      );

      const cells = [];
      for (let i = 0; i < ctx.sampleCount; i++) {
        for (let j = i + 1; j < ctx.sampleCount; j++) {
          const categoryComparison = pairIndex[i + "-" + j].enps.categories.find(c => c.category === category);
          cells.push(this.formatPairDelta_(categoryComparison.delta, categoryComparison.significant));
        }
      }

      this.writeTableRow_(ctx, index + 1, categoryLabels[category], values, cells);

    });

    ctx.row += 1;

  },

  renderAverageRatingsSection_(ctx, data) {

    this.renderSectionTitle_(ctx, "Средние оценки по вопросам");
    this.renderTableHeader_(ctx, data, "Вопрос");

    const pairIndex = this.buildPairIndex_(data.pairs);
    const questionCount = data.metrics[0].averageRatings.length;

    for (let k = 0; k < questionCount; k++) {

      const question = data.metrics[0].averageRatings[k].question;

      const values = data.metrics.map(m => m.averageRatings[k].count > 0 ? m.averageRatings[k].average : "н/д");

      const cells = [];
      for (let i = 0; i < ctx.sampleCount; i++) {
        for (let j = i + 1; j < ctx.sampleCount; j++) {
          const item = pairIndex[i + "-" + j].averageRatings[k];
          cells.push(this.formatPairDelta_(item.delta, item.significant));
        }
      }

      this.writeTableRow_(ctx, k, question, values, cells);

    }

    ctx.row += 1;

  },

  /** count/percent одной выборки для строки распределения/Топ-5. */
  formatCountPercent_(count, percent) {
    return percent === null || percent === undefined ? count + " (н/д)" : count + " (" + percent + "%)";
  },

  renderDistributionsSection_(ctx, data) {

    this.renderSectionTitle_(ctx, "Распределения ответов");

    const pairIndex = this.buildPairIndex_(data.pairs);
    const distributionsCount = data.metrics[0].distributions.length;

    for (let qIndex = 0; qIndex < distributionsCount; qIndex++) {

      const question = data.metrics[0].distributions[qIndex].question;

      const labelRange = ctx.sheet.getRange(ctx.row, 1, 1, ctx.columns);
      labelRange.setValue(question.title);
      Formatter.formatLabel(ctx.sheet, labelRange);
      ctx.row += 1;

      this.renderTableHeader_(ctx, data, "Вариант");

      const itemCount = data.metrics[0].distributions[qIndex].items.length;

      // Знаменатель "нет ответов вовсе" считается на уровне выборки/вопроса
      // (а не на уровне варианта) — как и в Comparison.compareDistributionItems.
      const totalsBySample = data.metrics.map(m =>
        m.distributions[qIndex].items.reduce((sum, item) => sum + item.count, 0)
      );

      for (let a = 0; a < itemCount; a++) {

        const answer = data.metrics[0].distributions[qIndex].items[a].answer;

        const values = data.metrics.map((m, sIndex) => {
          const item = m.distributions[qIndex].items[a];
          return totalsBySample[sIndex] > 0
            ? this.formatCountPercent_(item.count, item.percent)
            : this.formatCountPercent_(item.count, null);
        });

        const cells = [];
        for (let i = 0; i < ctx.sampleCount; i++) {
          for (let j = i + 1; j < ctx.sampleCount; j++) {
            const item = pairIndex[i + "-" + j].distributions[qIndex].items[a];
            cells.push(this.formatPairDelta_(item.delta, item.significant));
          }
        }

        this.writeTableRow_(ctx, a, answer, values, cells);

      }

      ctx.row += 1;

    }

  },

  renderTopAnswersSection_(ctx, data) {

    if (!data.topAnswers.length) return;

    this.renderSectionTitle_(ctx, "Топ-5 открытых вопросов");

    data.topAnswers.forEach(entry => {

      const labelRange = ctx.sheet.getRange(ctx.row, 1, 1, ctx.columns);
      labelRange.setValue(entry.question.title);
      Formatter.formatLabel(ctx.sheet, labelRange);
      ctx.row += 1;

      // Заголовок без колонок дельт-звездочек значимости — Топ-5 не
      // проверяется на значимость нигде в проекте (см. модуль-докстринг).
      const headers = ["Вариант"];
      for (let i = 0; i < ctx.sampleCount; i++) headers.push(this.letterFor_(i) + ": " + data.labels[i]);
      for (let i = 0; i < ctx.sampleCount; i++) {
        for (let j = i + 1; j < ctx.sampleCount; j++) headers.push("Δ, п.п. " + this.letterFor_(i) + "-" + this.letterFor_(j));
      }
      ctx.sheet.getRange(ctx.row, 1, 1, headers.length).setValues([headers]);
      Formatter.formatReportTableHeader(ctx.sheet.getRange(ctx.row, 1, 1, headers.length));
      ctx.row += 1;

      entry.items.forEach((item, index) => {

        const values = item.values.map(v => this.formatCountPercent_(v.count, v.percent));

        const cells = [];
        for (let i = 0; i < ctx.sampleCount; i++) {
          for (let j = i + 1; j < ctx.sampleCount; j++) {
            const a = item.values[i].percent;
            const b = item.values[j].percent;
            cells.push(a !== null && b !== null ? this.formatPairDelta_(a - b, null) : "н/д");
          }
        }

        this.writeTableRow_(ctx, index, item.answer, values, cells);

      });

    });

  }

};
