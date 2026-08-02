/**
 * ==========================================================
 * Вывод аналитики на листы
 * ==========================================================
 *
 * Единственный модуль, который знает про SpreadsheetApp. Всё, что
 * выше, — чистые вычисления над массивами, их можно тестировать
 * без таблицы.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ. Всё пишется одним setValues на лист, а не
 * по ячейке. Apps Script тратит на каждое обращение к Range
 * заметное время, и построчная запись 40 строк уже ощутима,
 * а 400 — упирается в лимит выполнения.
 */

const AnalyticsWriter = {

  SHEETS: {
    FINDINGS: "Выводы",
    TRAFFIC: "Светофор",
    DRIVERS: "Драйверы",
    SEGMENTS: "Отклонения срезов",
    COHORT: "Когорта"
  },

  HEADER_BG: "#2e5c8a",

  /**
   * Точка входа: построить аналитику и разложить по листам.
   */
  run(sourceYear, previousYear, filters) {

    const analytics = AnalyticsService.build(sourceYear || "2026", previousYear || "2025", filters || []);
    const findings = AnalyticsService.findings(analytics);

    this.writeFindings_(analytics, findings);
    this.writeTrafficLight_(analytics);
    this.writeDrivers_(analytics);
    this.writeSegments_(analytics);
    this.writeCohort_(analytics);

    // Отдельный лист "Руководитель и команда" строится только по
    // ответам 2026 (обогащение "перформанс" — см. PerformanceDirectory.gs,
    // ManagerTeamReport.gs) — для другого sourceYear его строить не из чего.
    if ((sourceYear || "2026") === "2026") {
      ManagerTeamReport.write();
    }

    return analytics;

  },

  sheet_(name) {

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(name);

    if (sheet) {
      sheet.clear();
      sheet.clearConditionalFormatRules();
    } else {
      sheet = spreadsheet.insertSheet(name);
    }

    return sheet;

  },

  /**
   * Записать таблицу одним вызовом и оформить шапку.
   *
   * @param {Number} startRow - строка, с которой начинается таблица
   *   (по умолчанию 1). Листы расширенной аналитики печатают перед
   *   таблицей двухчастный заголовок и описание (Formatter.
   *   writeSheetIntro), поэтому сама таблица сдвинута вниз.
   * @param {Array<Array<String>>} headerNotes - [[индекс колонки
   *   (0-based), текст подсказки], ...] — подсказки при наведении на
   *   заголовок колонки (Formatter.note), текст берется из Glossary.
   */
  dump_(sheet, header, rows, widths, startRow, headerNotes) {

    startRow = startRow || 1;

    const table = [header].concat(rows);

    if (!table.length) return;

    // Все строки должны быть одной длины, иначе setValues упадет.
    const width = header.length;

    const normalized = table.map(row => {
      const copy = row.slice(0, width);
      while (copy.length < width) copy.push("");
      return copy.map(v => (v === null || v === undefined) ? "" : v);
    });

    sheet.getRange(startRow, 1, normalized.length, width).setValues(normalized);

    const headerRange = sheet.getRange(startRow, 1, 1, width);
    headerRange.setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);
    headerRange.setWrap(true).setVerticalAlignment("middle");

    sheet.setFrozenRows(startRow);
    sheet.setRowHeight(startRow, 42);

    (widths || []).forEach((w, i) => {
      if (w) sheet.setColumnWidth(i + 1, w);
    });

    (headerNotes || []).forEach(pair => {
      Formatter.note(sheet.getRange(startRow, pair[0] + 1), pair[1]);
    });

    return normalized.length;

  },

  writeFindings_(analytics, findings) {

    const sheet = this.sheet_(this.SHEETS.FINDINGS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Что заметили автоматические правила — сводка наблюдений",
      "Каждая строка — готовый вывод по одному из проверенных правил (значимость изменений, отклонения срезов, малые группы и т.д.). Подробности каждой методики — на соответствующем листе (Светофор, Драйверы, Отклонения срезов, Когорта).",
      3);

    const meta = analytics.meta;

    const rows = [
      ["", "Опрос " + meta.year + ": " + meta.n + " анкет" +
        (meta.hasPrevious ? " (" + meta.previousYear + ": " + meta.nPrevious + ")" : ""), ""],
      ["", "Построено " + Utilities.formatDate(meta.builtAt, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm"), ""],
      ["", "", ""]
    ];

    const labels = { critical: "КРИТИЧНО", warning: "ВНИМАНИЕ", info: "СПРАВОЧНО" };

    findings.forEach(finding => {
      rows.push([labels[finding.severity], finding.title, finding.text]);
    });

    this.dump_(sheet, ["Уровень", "Наблюдение", "Расшифровка"], rows, [110, 380, 700], startRow, [
      [0, "Насколько срочно реагировать. КРИТИЧНО — подтвержденная проблема, требует решения. " +
        "ВНИМАНИЕ — значимое изменение, стоит обсудить причины. СПРАВОЧНО — полезный контекст без немедленных действий."]
    ]);

    // Цвет уровня
    const colors = { "КРИТИЧНО": "#ffc7ce", "ВНИМАНИЕ": "#fcd5b4", "СПРАВОЧНО": "#ededed" };

    for (let i = 0; i < rows.length; i++) {
      const level = rows[i][0];
      if (colors[level]) {
        sheet.getRange(startRow + 1 + i, 1).setBackground(colors[level]).setFontWeight("bold").setFontSize(9);
      }
    }

    sheet.getRange(startRow + 1, 1, rows.length + 1, 3).setVerticalAlignment("top").setWrap(true);
    sheet.setHiddenGridlines(true);

  },

  writeTrafficLight_(analytics) {

    const sheet = this.sheet_(this.SHEETS.TRAFFIC);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Какой у вопросов статус и куда смотреть — светофор с проверкой значимости",
      "По каждому вопросу: текущий уровень относительно порогов компании, значимо ли изменение к прошлому году, связь с лояльностью (eNPS) и охват. Подсказки — на заголовках колонок, формулы и ограничения — в свернутом блоке под таблицей.",
      21);

    const sorted = analytics.trafficLight.slice().sort((a, b) => (a.level || 0) - (b.level || 0));

    const header = [
      "Вопрос", "Группа", "Тип шкалы", "Значение", "Ед.", "Прошлый год", "Δ",
      "Значимость", "Статус результата", "Уровень 0–100", "Статус", "Что означает статус",
      "Влияние на eNPS (r)", "База n", "Охват, %", "Δ охвата, п.п.", "Жёсткий негатив, %",
      "Затрудняюсь, n", "Затрудняюсь, %", "eNPS затруднившихся", "Критики затруднившихся, %"
    ];

    const statuses = sorted.map(entry => Glossary.reliabilityStatus({
      insufficientData: entry.n < Norms.FRAGILE_SEGMENT_SIZE,
      noComparisonData: entry.previous === undefined,
      negativeSignal: entry.status === Norms.STATUS.CRITICAL || (entry.significant && entry.delta < 0),
      weakSignal: entry.status === Norms.STATUS.WATCH
    }));

    const rows = sorted.map((entry, i) => [
      entry.question,
      entry.group,
      entry.scaleKey,
      entry.value,
      entry.unit,
      entry.previous === undefined ? "" : entry.previous,
      entry.delta === undefined ? "" : entry.delta,
      entry.significanceNote || "",
      statuses[i].label,
      entry.level,
      entry.status,
      entry.statusExplained,
      entry.rEnps === undefined ? "" : entry.rEnps,
      entry.n,
      entry.coveragePercent,
      entry.coverageDelta === undefined ? "" : entry.coverageDelta,
      entry.bottomShare === undefined ? "" : entry.bottomShare,
      entry.uncertainGroup ? entry.uncertainGroup.n : "",
      entry.uncertainGroup ? entry.uncertainGroup.percent : "",
      entry.uncertainGroup ? entry.uncertainGroup.enps : "",
      entry.uncertainGroup ? entry.uncertainGroup.criticsPercent : ""
    ]);

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows,
      [280, 120, 100, 80, 55, 90, 60, 150, 190, 95, 100, 300, 110, 60, 75, 95, 110, 90, 90, 110, 130],
      startRow, [
        [7, G.significance.what + " " + G.significance.howToRead],
        [8, "Итоговая надежность результата: значим ли эффект и достаточно ли данных, чтобы ему доверять."],
        [9, G.absoluteLevel.what + " " + G.absoluteLevel.howToRead],
        [12, G.correlation.what + " " + G.correlation.howToRead],
        [14, G.coverage.what + " " + G.coverage.howToRead],
        [16, G.bottomShare.what + " " + G.bottomShare.howToRead],
        [17, G.uncertainGroup.what + " " + G.uncertainGroup.howToRead]
      ]);

    sorted.forEach((entry, i) => {
      if (entry.color) sheet.getRange(startRow + 1 + i, 11).setBackground(entry.color).setFontWeight("bold");
      sheet.getRange(startRow + 1 + i, 9).setBackground(statuses[i].color).setFontWeight("bold");
    });

    const examples = {
      absoluteLevel: Glossary.EXAMPLE.absoluteLevel(sorted.find(e => e.status)),
      significance: Glossary.EXAMPLE.significance(sorted.find(e => e.previous !== undefined)),
      enpsConfidence: Glossary.EXAMPLE.enpsConfidence(sorted.find(e => e.type === "enps")),
      coverage: Glossary.EXAMPLE.coverage(sorted.find(e => e.coveragePercent !== null && e.coveragePercent !== undefined)),
      bottomShare: Glossary.EXAMPLE.bottomShare(sorted.find(e => e.bottomShare !== undefined)),
      uncertainGroup: Glossary.EXAMPLE.uncertainGroup(sorted.find(e => e.uncertainGroup)),
      correlation: Glossary.EXAMPLE.correlation(sorted.find(e => e.rEnps !== null && e.rEnps !== undefined))
    };

    const lastDataRow = startRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["absoluteLevel", "significance", "enpsConfidence", "coverage", "bottomShare", "uncertainGroup", "correlation"],
      examples);

    sheet.setHiddenGridlines(true);

  },

  writeDrivers_(analytics) {

    const sheet = this.sheet_(this.SHEETS.DRIVERS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "За что браться в первую очередь — матрица приоритетов",
      "Каждый вопрос — в одном из четырех квадрантов: сила связи с лояльностью (eNPS, выгорание, уход) против текущего уровня. Низкая оценка сама по себе не значит «важно чинить» — важно то, где низкий уровень сочетается с сильной связью.",
      12);

    const gapByQuestion = {};
    analytics.gaps.forEach(gap => { gapByQuestion[gap.question] = gap; });

    const header = [
      "Вопрос", "Квадрант", "Статус результата", "Уровень 0–100", "Влияние на eNPS (r)", "r с выгоранием",
      "r с уходом", "Промоутеры", "Критики", "Разрыв", "База n", "Предупреждение"
    ];

    const matrixByQuestion = {};
    analytics.correlationMatrix.forEach(row => { matrixByQuestion[row.question] = row; });

    const statuses = analytics.drivers.rows.map(row => Glossary.reliabilityStatus({
      insufficientData: row.n < Norms.FRAGILE_SEGMENT_SIZE,
      negativeSignal: row.quadrant === Drivers.QUADRANT.FIX_FIRST,
      weakSignal: row.quadrant === Drivers.QUADRANT.WATCH || !!row.note
    }));

    const rows = analytics.drivers.rows.map((row, i) => {

      const gap = gapByQuestion[row.question] || {};
      const matrix = matrixByQuestion[row.question] || {};

      return [
        row.question,
        row.quadrant,
        statuses[i].label,
        row.level,
        row.r,
        matrix.burnout === undefined ? "" : matrix.burnout,
        matrix.leave === undefined ? "" : matrix.leave,
        gap.promoterMean === undefined ? "" : gap.promoterMean,
        gap.detractorMean === undefined ? "" : gap.detractorMean,
        gap.gap === undefined ? "" : gap.gap,
        row.n,
        row.note || ""
      ];

    });

    const cuts = [
      new Array(header.length).fill(""),
      ["ГРАНИЦЫ КВАДРАНТОВ", "медиана влияния r = " + analytics.drivers.impactCut +
        ", средний уровень = " + analytics.drivers.levelCut].concat(new Array(header.length - 2).fill(""))
    ];

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows.concat(cuts),
      [280, 140, 190, 100, 110, 110, 95, 95, 85, 75, 60, 480], startRow, [
        [1, G.driversQuadrant.what + " " + G.driversQuadrant.howToRead],
        [2, "Итоговая надежность результата: подтвержден ли сигнал и достаточно ли данных, чтобы ему доверять."],
        [4, G.correlation.what + " " + G.correlation.howToRead],
        [5, G.correlationMatrix.what + " " + G.correlationMatrix.howToRead],
        [6, G.correlationMatrix.what + " " + G.correlationMatrix.howToRead],
        [9, G.promoterGap.what + " " + G.promoterGap.howToRead]
      ]);

    const quadrantColors = {
      "ЧИНИТЬ ПЕРВЫМ": "#ffc7ce",
      "СЛЕДИТЬ": "#fcd5b4",
      "ДЕРЖАТЬ": "#c6efce",
      "ОК": "#ededed"
    };

    analytics.drivers.rows.forEach((row, i) => {
      const color = quadrantColors[row.quadrant];
      if (color) sheet.getRange(startRow + 1 + i, 2).setBackground(color).setFontWeight("bold");
      sheet.getRange(startRow + 1 + i, 3).setBackground(statuses[i].color).setFontWeight("bold");
    });

    const corrRow = analytics.drivers.rows.find(row => row.r !== null && row.r !== undefined);
    const matrixRow = analytics.correlationMatrix.find(row =>
      (row.burnout !== null && row.burnout !== undefined) || (row.leave !== null && row.leave !== undefined));

    const examples = {
      driversQuadrant: Glossary.EXAMPLE.driversQuadrant(analytics.drivers.rows[0]),
      correlation: corrRow ? Glossary.EXAMPLE.correlation({ question: corrRow.question, rEnps: corrRow.r }) : null,
      correlationMatrix: Glossary.EXAMPLE.correlationMatrix(matrixRow),
      promoterGap: Glossary.EXAMPLE.promoterGap(analytics.gaps[0])
    };

    const lastDataRow = startRow + rows.length + cuts.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["driversQuadrant", "correlation", "correlationMatrix", "promoterGap"], examples);

    sheet.setHiddenGridlines(true);

  },

  writeSegments_(analytics) {

    const sheet = this.sheet_(this.SHEETS.SEGMENTS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Какие группы сотрудников заметно отличаются от компании — отклонения срезов",
      "Каждый срез (отдел, управление, город, стаж, формат работы, а за 2026 год — ещё соответствие ожиданиям, грейд и роль в отделе) сравнивается с нормой компании за этот же год. Находкой считается только группа с двумя и более согласованными отклонениями сразу — единичное отклонение может быть случайностью. Численность и явка (см. Headcount.gs) заполнены только для срезов «Отдел» и «Управление» и только за 2026 год.",
      17);

    const header = [
      "Разрез", "Группа", "n", "Численность", "Явка, %", "eNPS", "ДИ ±", "n пр. год", "eNPS пр. год", "Δ eNPS",
      "Критики, %", "Выгорание, %", "Уход, %", "Отклонений (плохих)", "Отклонения от нормы компании",
      "Надёжность", "Статус результата"
    ];

    const rows = [];
    const rowStatuses = [];
    const rowRenamedFrom = [];
    let deviationExampleSegment = null;
    let deviationExampleDimension = null;
    let reliabilityExampleSegment = null;
    let reliabilityExampleDimension = null;
    let fragileExampleSegment = null;
    let fragileExampleDimension = null;

    analytics.segments.forEach(dimension => {

      const company = dimension.company;

      rows.push([
        dimension.dimension,
        "НОРМА КОМПАНИИ",
        company.n,
        company.headcount !== undefined ? company.headcount : "",
        company.responseRatePercent !== undefined && company.responseRatePercent !== null ? company.responseRatePercent : "",
        company.enps,
        company.enpsMargin,
        "",
        "",
        "",
        company.detractors,
        company.burnoutRisk,
        company.leaveRisk,
        "",
        "Отклонением считается: eNPS ≥" + Norms.DEVIATION.enpsPoints +
          " п., доли ≥" + Norms.DEVIATION.sharePp + " п.п., средние ≥" + Norms.DEVIATION.ratingPoints + " балла",
        "",
        ""
      ]);
      rowStatuses.push(null);
      rowRenamedFrom.push(null);

      // "Соответствие ожиданиям"/"Грейд"/"Роль в отделе" существуют только
      // в 2026 — сравнения с прошлым годом для них в принципе нет (не
      // "данных не хватило", а "признака не было"), это стоит сказать явно,
      // а не полагаться на то, что читатель сам заметит пустые колонки.
      if (dimension.noHistory) {
        const note = new Array(header.length).fill("");
        note[14] = "Исторического сравнения нет: признак «" + dimension.dimension +
          "» отсутствует в данных 2025 (справочник «перформанс» есть только за 2026 год).";
        rows.push(note);
        rowStatuses.push(null);
        rowRenamedFrom.push(null);
      }

      dimension.segments.forEach(segment => {

        const deviationText = segment.deviations.length
          ? segment.deviations.map(d =>
              d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1) +
              (d.bad ? " ⚠" : "")).join(" · ")
          : "в пределах нормы";

        const smallBases = [];
        if (segment.fragile) smallBases.push("текущий год n=" + segment.n);
        if (segment.previousFragile) smallBases.push("прошлый год n=" + segment.previousN);

        let reliabilityText = smallBases.length
          ? "СИГНАЛ: малая база (" + smallBases.join("; ") + ")"
          : "достаточно данных";

        if (segment.metrics.enpsMargin !== null) {
          reliabilityText += ", ДИ текущего eNPS ±" + segment.metrics.enpsMargin;
        } else {
          reliabilityText += ", нет валидных ответов eNPS текущего года";
        }

        if (dimension.noHistory) {
          reliabilityText += "; сравнения с 2025 нет — признака не было в прошлом году";
        } else if (segment.previousN === 0) {
          reliabilityText += "; нет базы прошлого года";
        }

        if (segment.headcountUnreliable) {
          reliabilityText += "; явка " + segment.responseRatePercent + "% (> 100%) — источник численности требует проверки, явке доверять нельзя";
        } else if (segment.lowCoverage) {
          reliabilityText += "; явка " + segment.responseRatePercent + "% (< " + Norms.LOW_COVERAGE_THRESHOLD_PERCENT + "%) — низкий охват численности";
        }

        const status = Glossary.reliabilityStatus({
          insufficientData: segment.fragile || segment.metrics.enpsMargin === null,
          noComparisonData: dimension.noHistory,
          negativeSignal: segment.confirmed,
          weakSignal: segment.badCount === 1
        });

        rows.push([
          "",
          segment.name,
          segment.n,
          segment.headcount !== null ? segment.headcount : "",
          segment.responseRatePercent !== null ? segment.responseRatePercent : "",
          segment.metrics.enps,
          segment.metrics.enpsMargin,
          segment.previousN,
          segment.yearDelta ? segment.yearDelta.previous : "",
          segment.yearDelta ? segment.yearDelta.delta : "",
          segment.metrics.detractors,
          segment.metrics.burnoutRisk,
          segment.metrics.leaveRisk,
          segment.badCount,
          deviationText,
          reliabilityText,
          status.label
        ]);
        rowStatuses.push(status);
        rowRenamedFrom.push(segment.renamedFrom && segment.renamedFrom.length ? segment.renamedFrom : null);

        if (!deviationExampleSegment && segment.deviations.length) {
          deviationExampleSegment = segment;
          deviationExampleDimension = dimension.dimension;
        }
        if (!reliabilityExampleSegment) {
          reliabilityExampleSegment = segment;
          reliabilityExampleDimension = dimension.dimension;
        }
        if (!fragileExampleSegment && segment.fragile) {
          fragileExampleSegment = segment;
          fragileExampleDimension = dimension.dimension;
        }

      });

      rows.push(new Array(header.length).fill(""));
      rowStatuses.push(null);
      rowRenamedFrom.push(null);

    });

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows, [120, 300, 50, 90, 70, 70, 60, 75, 90, 70, 80, 95, 80, 110, 520, 260, 190],
      startRow, [
        [14, G.segmentDeviation.what + " " + G.segmentDeviation.howToRead],
        [15, G.sampleReliability.what + " " + G.sampleReliability.howToRead],
        [16, "Итоговая надежность результата: подтверждено ли отклонение и достаточно ли данных, чтобы ему доверять."]
      ]);

    rows.forEach((row, i) => {
      if (row[1] === "НОРМА КОМПАНИИ") {
        sheet.getRange(startRow + 1 + i, 1, 1, header.length).setBackground("#ededed").setFontWeight("bold");
      } else if (row[13] !== "" && row[13] >= 2) {
        sheet.getRange(startRow + 1 + i, 14).setBackground("#ffc7ce").setFontWeight("bold");
      }
      if (rowStatuses[i]) {
        sheet.getRange(startRow + 1 + i, 17).setBackground(rowStatuses[i].color).setFontWeight("bold");
      }
      if (rowRenamedFrom[i]) {
        Formatter.note(sheet.getRange(startRow + 1 + i, 2), "Ранее называлось: " + rowRenamedFrom[i].join(", "));
      }
    });

    sheet.getRange(startRow + 1, 15, rows.length, 2).setWrap(true).setVerticalAlignment("top");

    const reliabilitySegment = fragileExampleSegment || reliabilityExampleSegment;
    const reliabilityDimension = fragileExampleSegment ? fragileExampleDimension : reliabilityExampleDimension;

    const examples = {
      segmentDeviation: Glossary.EXAMPLE.segmentDeviation(deviationExampleSegment, deviationExampleDimension),
      sampleReliability: Glossary.EXAMPLE.sampleReliability(reliabilitySegment, reliabilityDimension)
    };

    const lastDataRow = startRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["segmentDeviation", "sampleReliability"], examples);

    sheet.setHiddenGridlines(true);

  },

  writeCohort_(analytics) {

    const sheet = this.sheet_(this.SHEETS.COHORT);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Что изменилось у тех же самых людей — сквозная когорта",
      "Сравнение не всей выборки, а только тех, кто отвечал на опрос оба года — это отделяет реальное изменение отношения от смены состава респондентов. Уровень по когорте читать нельзя (подписываются более лояльные), только направление изменения.",
      9);

    if (!analytics.cohort) {
      sheet.getRange(startRow, 1).setValue("Данных прошлого года нет — сквозная когорта не строится.");
      return;
    }

    const cohort = analytics.cohort;

    const intro = [
      ["Размер когорты", cohort.info.size, "человек ответили оба года", "", "", "", "", "", ""],
      ["Подписанных анкет", cohort.info.signedNow + " / " + cohort.info.signedBefore,
        "текущий / прошлый год", "", "", "", "", "", ""],
      ["Отброшено дублей ключа", cohort.info.droppedDuplicates, "неоднозначное сопоставление", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""]
    ];

    if (cohort.enps) {
      intro.push(["eNPS когорты", cohort.enps.enpsBefore + " → " + cohort.enps.enpsNow,
        "Δ " + cohort.enps.delta + " п.", "подняли оценку: " + cohort.enps.up,
        "снизили: " + cohort.enps.down, "не изменили: " + cohort.enps.same, "", "", ""]);
      intro.push(["", "", "", "", "", "", "", "", ""]);
      intro.push(["ВАЖНО", "Уровень когорты читать нельзя — подписываются более лояльные. Читать только ИЗМЕНЕНИЕ.",
        "", "", "", "", "", "", ""]);
      intro.push(["", "", "", "", "", "", "", "", ""]);
    }

    const header = ["Вопрос", "Δ у одних и тех же людей", "n", "t", "Статус результата",
      "Подняли", "Снизили", "Без изменений", "Вердикт"];

    const statuses = (cohort.changes.rows || []).map(row => Glossary.reliabilityStatus({
      insufficientData: row.n < Norms.FRAGILE_SEGMENT_SIZE,
      negativeSignal: row.significant && row.meanDiff < 0,
      weakSignal: false
    }));

    const rows = (cohort.changes.rows || []).map((row, i) => [
      row.question, row.meanDiff, row.n, row.t, statuses[i].label, row.up, row.down, row.same, row.verdict
    ]);

    const table = intro.concat([header]).concat(rows);

    sheet.getRange(startRow, 1, table.length, header.length).setValues(
      table.map(row => row.map(v => (v === null || v === undefined) ? "" : v))
    );

    const headerRow = startRow + intro.length;
    sheet.getRange(headerRow, 1, 1, header.length)
      .setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);

    const G = Glossary.ENTRIES;
    Formatter.note(sheet.getRange(headerRow, 4), G.cohortPairedTest.what + " " + G.cohortPairedTest.howToRead);
    Formatter.note(sheet.getRange(headerRow, 5),
      "Итоговая надежность результата: подтверждено ли изменение и достаточно ли пар в когорте, чтобы ему доверять.");

    rows.forEach((row, i) => {
      if (cohort.changes.rows[i].significant) {
        sheet.getRange(headerRow + 1 + i, 1, 1, header.length)
          .setBackground(cohort.changes.rows[i].meanDiff < 0 ? "#ffc7ce" : "#c6efce");
      }
      sheet.getRange(headerRow + 1 + i, 5).setBackground(statuses[i].color).setFontWeight("bold");
    });

    [280, 190, 60, 60, 190, 80, 80, 110, 380].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

    const compositionEntry = analytics.composition.find(entry => entry.shifts.length);

    const examples = {
      cohortPairedTest: Glossary.EXAMPLE.cohortPairedTest(
        (cohort.changes.rows || []).find(row => row.t !== null && row.t !== undefined)),
      compositionShift: Glossary.EXAMPLE.compositionShift(compositionEntry)
    };

    const lastDataRow = headerRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["cohortPairedTest", "compositionShift"], examples);

    sheet.setHiddenGridlines(true);

  }

};

/**
 * Пункт меню. Добавить вызов в существующий onOpen в Menu.gs:
 *
 *   .addItem('Расширенная аналитика', 'runAdvancedAnalytics')
 */
function runAdvancedAnalytics() {

  const ui = SpreadsheetApp.getUi();

  try {
    const analytics = AnalyticsWriter.run("2026", "2025", []);
    ui.alert("Готово",
      "Аналитика построена по " + analytics.meta.n + " анкетам.\n\n" +
      "Листы: Выводы, Светофор, Драйверы, Отклонения срезов, Когорта, Руководитель и команда.",
      ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("Ошибка", String(error && error.message ? error.message : error), ui.ButtonSet.OK);
  }

}
