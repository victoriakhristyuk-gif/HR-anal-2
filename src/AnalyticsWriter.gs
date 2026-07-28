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
   */
  dump_(sheet, header, rows, widths) {

    const table = [header].concat(rows);

    if (!table.length) return;

    // Все строки должны быть одной длины, иначе setValues упадет.
    const width = header.length;

    const normalized = table.map(row => {
      const copy = row.slice(0, width);
      while (copy.length < width) copy.push("");
      return copy.map(v => (v === null || v === undefined) ? "" : v);
    });

    sheet.getRange(1, 1, normalized.length, width).setValues(normalized);

    const headerRange = sheet.getRange(1, 1, 1, width);
    headerRange.setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);
    headerRange.setWrap(true).setVerticalAlignment("middle");

    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 42);

    (widths || []).forEach((w, i) => {
      if (w) sheet.setColumnWidth(i + 1, w);
    });

    return normalized.length;

  },

  writeFindings_(analytics, findings) {

    const sheet = this.sheet_(this.SHEETS.FINDINGS);

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

    this.dump_(sheet, ["Уровень", "Наблюдение", "Расшифровка"], rows, [110, 380, 700]);

    // Цвет уровня
    const colors = { "КРИТИЧНО": "#ffc7ce", "ВНИМАНИЕ": "#fcd5b4", "СПРАВОЧНО": "#ededed" };

    for (let i = 0; i < rows.length; i++) {
      const level = rows[i][0];
      if (colors[level]) {
        sheet.getRange(i + 2, 1).setBackground(colors[level]).setFontWeight("bold").setFontSize(9);
      }
    }

    sheet.getRange(2, 1, rows.length + 1, 3).setVerticalAlignment("top").setWrap(true);
    sheet.setHiddenGridlines(true);

  },

  writeTrafficLight_(analytics) {

    const sheet = this.sheet_(this.SHEETS.TRAFFIC);

    const header = [
      "Вопрос", "Группа", "Тип шкалы", "Значение", "Ед.", "Прошлый год", "Δ",
      "Значимость", "Уровень 0–100", "Статус", "Что означает статус",
      "Влияние на eNPS (r)", "База n", "Охват, %", "Δ охвата, п.п.", "Жёсткий негатив, %",
      "Затрудняюсь, n", "Затрудняюсь, %", "eNPS затруднившихся", "Критики затруднившихся, %"
    ];

    const rows = analytics.trafficLight
      .slice()
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map(entry => [
        entry.question,
        entry.group,
        entry.scaleKey,
        entry.value,
        entry.unit,
        entry.previous === undefined ? "" : entry.previous,
        entry.delta === undefined ? "" : entry.delta,
        entry.significanceNote || "",
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

    this.dump_(sheet, header, rows,
      [280, 120, 100, 80, 55, 90, 60, 150, 95, 100, 300, 110, 60, 75, 95, 110, 90, 90, 110, 130]);

    analytics.trafficLight
      .slice()
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .forEach((entry, i) => {
        if (entry.color) sheet.getRange(i + 2, 10).setBackground(entry.color).setFontWeight("bold");
      });

    sheet.setHiddenGridlines(true);

  },

  writeDrivers_(analytics) {

    const sheet = this.sheet_(this.SHEETS.DRIVERS);

    const gapByQuestion = {};
    analytics.gaps.forEach(gap => { gapByQuestion[gap.question] = gap; });

    const header = [
      "Вопрос", "Квадрант", "Уровень 0–100", "Влияние на eNPS (r)", "r с выгоранием",
      "r с уходом", "Промоутеры", "Критики", "Разрыв", "База n", "Предупреждение"
    ];

    const matrixByQuestion = {};
    analytics.correlationMatrix.forEach(row => { matrixByQuestion[row.question] = row; });

    const rows = analytics.drivers.rows.map(row => {

      const gap = gapByQuestion[row.question] || {};
      const matrix = matrixByQuestion[row.question] || {};

      return [
        row.question,
        row.quadrant,
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
      ["", "", "", "", "", "", "", "", "", "", ""],
      ["ГРАНИЦЫ КВАДРАНТОВ", "медиана влияния r = " + analytics.drivers.impactCut +
        ", средний уровень = " + analytics.drivers.levelCut, "", "", "", "", "", "", "", "", ""]
    ];

    this.dump_(sheet, header, rows.concat(cuts), [280, 140, 100, 110, 110, 95, 95, 85, 75, 60, 480]);

    const quadrantColors = {
      "ЧИНИТЬ ПЕРВЫМ": "#ffc7ce",
      "СЛЕДИТЬ": "#fcd5b4",
      "ДЕРЖАТЬ": "#c6efce",
      "ОК": "#ededed"
    };

    analytics.drivers.rows.forEach((row, i) => {
      const color = quadrantColors[row.quadrant];
      if (color) sheet.getRange(i + 2, 2).setBackground(color).setFontWeight("bold");
    });

    sheet.setHiddenGridlines(true);

  },

  writeSegments_(analytics) {

    const sheet = this.sheet_(this.SHEETS.SEGMENTS);

    const header = [
      "Разрез", "Группа", "n", "eNPS", "ДИ ±", "eNPS пр. год", "Δ eNPS",
      "Критики, %", "Выгорание, %", "Уход, %", "Отклонений (плохих)", "Отклонения от нормы компании", "Надёжность"
    ];

    const rows = [];

    analytics.segments.forEach(dimension => {

      const company = dimension.company;

      rows.push([
        dimension.dimension,
        "НОРМА КОМПАНИИ",
        company.n,
        company.enps,
        company.enpsMargin,
        "",
        "",
        company.detractors,
        company.burnoutRisk,
        company.leaveRisk,
        "",
        "Отклонением считается: eNPS ≥" + Norms.DEVIATION.enpsPoints +
          " п., доли ≥" + Norms.DEVIATION.sharePp + " п.п., средние ≥" + Norms.DEVIATION.ratingPoints + " балла",
        ""
      ]);

      dimension.segments.forEach(segment => {

        const deviationText = segment.deviations.length
          ? segment.deviations.map(d =>
              d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1) +
              (d.bad ? " ⚠" : "")).join(" · ")
          : "в пределах нормы";

        rows.push([
          "",
          segment.name,
          segment.n,
          segment.metrics.enps,
          segment.metrics.enpsMargin,
          segment.yearDelta ? segment.yearDelta.previous : "",
          segment.yearDelta ? segment.yearDelta.delta : "",
          segment.metrics.detractors,
          segment.metrics.burnoutRisk,
          segment.metrics.leaveRisk,
          segment.badCount,
          deviationText,
          segment.fragile
            ? "СИГНАЛ (n<" + Norms.FRAGILE_SEGMENT_SIZE + ", ДИ по eNPS ±" + segment.metrics.enpsMargin + ")"
            : "достаточно данных"
        ]);

      });

      rows.push(new Array(header.length).fill(""));

    });

    this.dump_(sheet, header, rows, [120, 300, 50, 70, 60, 90, 70, 80, 95, 80, 110, 520, 200]);

    rows.forEach((row, i) => {
      if (row[1] === "НОРМА КОМПАНИИ") {
        sheet.getRange(i + 2, 1, 1, header.length).setBackground("#ededed").setFontWeight("bold");
      } else if (row[10] !== "" && row[10] >= 2) {
        sheet.getRange(i + 2, 11).setBackground("#ffc7ce").setFontWeight("bold");
      }
    });

    sheet.getRange(2, 12, rows.length, 1).setWrap(true).setVerticalAlignment("top");
    sheet.setHiddenGridlines(true);

  },

  writeCohort_(analytics) {

    const sheet = this.sheet_(this.SHEETS.COHORT);

    if (!analytics.cohort) {
      sheet.getRange(1, 1).setValue("Данных прошлого года нет — сквозная когорта не строится.");
      return;
    }

    const cohort = analytics.cohort;

    const intro = [
      ["Размер когорты", cohort.info.size, "человек ответили оба года", "", "", "", "", ""],
      ["Подписанных анкет", cohort.info.signedNow + " / " + cohort.info.signedBefore,
        "текущий / прошлый год", "", "", "", "", ""],
      ["Отброшено дублей ключа", cohort.info.droppedDuplicates, "неоднозначное сопоставление", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""]
    ];

    if (cohort.enps) {
      intro.push(["eNPS когорты", cohort.enps.enpsBefore + " → " + cohort.enps.enpsNow,
        "Δ " + cohort.enps.delta + " п.", "подняли оценку: " + cohort.enps.up,
        "снизили: " + cohort.enps.down, "не изменили: " + cohort.enps.same, "", ""]);
      intro.push(["", "", "", "", "", "", "", ""]);
      intro.push(["ВАЖНО", "Уровень когорты читать нельзя — подписываются более лояльные. Читать только ИЗМЕНЕНИЕ.",
        "", "", "", "", "", ""]);
      intro.push(["", "", "", "", "", "", "", ""]);
    }

    const header = ["Вопрос", "Δ у одних и тех же людей", "n", "t", "Подняли", "Снизили", "Без изменений", "Вердикт"];

    const rows = (cohort.changes.rows || []).map(row => [
      row.question, row.meanDiff, row.n, row.t, row.up, row.down, row.same, row.verdict
    ]);

    const table = intro.concat([header]).concat(rows);

    sheet.getRange(1, 1, table.length, header.length).setValues(
      table.map(row => row.map(v => (v === null || v === undefined) ? "" : v))
    );

    const headerRow = intro.length + 1;
    sheet.getRange(headerRow, 1, 1, header.length)
      .setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);

    rows.forEach((row, i) => {
      if (cohort.changes.rows[i].significant) {
        sheet.getRange(headerRow + 1 + i, 1, 1, header.length)
          .setBackground(cohort.changes.rows[i].meanDiff < 0 ? "#ffc7ce" : "#c6efce");
      }
    });

    [280, 190, 60, 60, 80, 80, 110, 380].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
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
      "Листы: Выводы, Светофор, Драйверы, Отклонения срезов, Когорта.",
      ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("Ошибка", String(error && error.message ? error.message : error), ui.ButtonSet.OK);
  }

}
