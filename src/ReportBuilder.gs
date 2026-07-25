/**
 * ==========================================================
 * Построение отчета
 * ==========================================================
 */

const ReportBuilder = {

  createReport(reportData, reportName) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Если лист уже существует — удаляем
    const oldSheet = ss.getSheetByName(reportName);
    if (oldSheet) {
      ss.deleteSheet(oldSheet);
    }

    const sheet = ss.insertSheet(reportName);

    // ==========================================================
    // Оформление
    // ==========================================================

    Formatter.applyBaseFont(sheet.getRange("A1:E50"));

    Formatter.formatMainTitle(sheet.getRange("A1"));

    Formatter.formatLabel(sheet.getRange("A2"));
    Formatter.formatLabel(sheet.getRange("A4"));
    Formatter.formatLabel(sheet.getRange("A6"));

    Formatter.setColumnWidths(sheet, [220, 350, null, 180, 180]);

    // ==========================================================
    // Заголовок
    // ==========================================================

    sheet.getRange("A1").setValue("HR Analytics");

    sheet.getRange("A2").setValue("Количество сотрудников:");
    sheet.getRange("B2").setValue(reportData.employees);

    sheet.getRange("A4").setValue("Источник:");
    sheet.getRange("B4").setValue(reportData.source);

    // ==========================================================
    // Паспорт выборки
    // ==========================================================

    sheet.getRange("A6").setValue("Паспорт выборки:");

    const passport = reportData.filters
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.formatFilterForPassport(filter));

    sheet.getRange("A7").setValue(passport.join("; "));

    // ==========================================================
    // Содержание
    // ==========================================================

    sheet.getRange("A9").setValue("Содержание");
    Formatter.formatSectionTitle(sheet.getRange("A9"));

    sheet.getRange("A10").setValue("eNPS");
    sheet.getRange("A11").setValue("Самые большие изменения");
    sheet.getRange("A12").setValue("Средние оценки");
    sheet.getRange("A13").setValue("Распределение ответов");
    sheet.getRange("A14").setValue("TOP-5 открытых ответов");
    sheet.getRange("A15").setValue("Сырые данные");

    // ==========================================================
    // eNPS
    // ==========================================================

    sheet.getRange("D1").setValue("eNPS");
    Formatter.formatSectionTitle(sheet.getRange("D1"));

    sheet.getRange("D3").setValue("Промоутеры");
    sheet.getRange("D4").setValue("Нейтралы");
    sheet.getRange("D5").setValue("Критики");

    sheet.getRange("E3").setValue(
      reportData.enps.promoters +
      " (" +
      reportData.enps.promotersPercent +
      "%)"
    );

    sheet.getRange("E4").setValue(
      reportData.enps.neutrals +
      " (" +
      reportData.enps.neutralsPercent +
      "%)"
    );

    sheet.getRange("E5").setValue(
      reportData.enps.detractors +
      " (" +
      reportData.enps.detractorsPercent +
      "%)"
    );

    sheet.getRange("D7").setValue("eNPS");
    Formatter.formatLabel(sheet.getRange("D7"));

    sheet.getRange("E7").setValue(reportData.enps.enps);
    Formatter.formatHighlightNumber(sheet.getRange("E7"));

    Formatter.addTableBorder(sheet.getRange("D3:E7"));

    // ==========================================================
    // Средние оценки
    // ==========================================================

    const averageStartRow = 17;

    sheet.getRange(averageStartRow, 1).setValue("Средние оценки");
    Formatter.formatSectionTitle(sheet.getRange(averageStartRow, 1));

    sheet.getRange(averageStartRow + 1, 1).setValue("Вопрос");
    sheet.getRange(averageStartRow + 1, 2).setValue("Среднее");

    Formatter.formatTableHeader(
      sheet.getRange(averageStartRow + 1, 1, 1, 2)
    );

    const averageRatings = reportData.averageRatings;

    averageRatings.forEach((item, index) => {
      const row = averageStartRow + 2 + index;
      sheet.getRange(row, 1).setValue(item.question);
      sheet.getRange(row, 2).setValue(item.average);
    });

    if (averageRatings.length > 0) {
      Formatter.addTableBorder(
        sheet.getRange(averageStartRow + 1, 1, averageRatings.length + 1, 2)
      );
    }

    // ==========================================================
    // Распределение ответов
    // ==========================================================

    let currentRow = averageStartRow + averageRatings.length + 3;

    reportData.distributions.forEach(distribution => {

      const question = distribution.question;

      // Для Города и Отдела показываем только реально
      // встретившиеся значения, для остальных — полный список
      const hideEmpty = question.title === "Город" || question.title === "Отдел";

      const items = hideEmpty
        ? distribution.items.filter(item => item.count > 0)
        : distribution.items;

      sheet.getRange(currentRow, 1).setValue(question.title);
      Formatter.formatSectionTitle(sheet.getRange(currentRow, 1));

      const headerRow = currentRow + 1;

      sheet.getRange(headerRow, 1).setValue("Ответ");
      sheet.getRange(headerRow, 2).setValue("Количество");
      sheet.getRange(headerRow, 3).setValue("Процент");

      Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, 3));

      items.forEach((item, index) => {
        const row = headerRow + 1 + index;
        sheet.getRange(row, 1).setValue(item.answer);
        sheet.getRange(row, 2).setValue(item.count);
        sheet.getRange(row, 3).setValue(item.percent + "%");
      });

      if (items.length > 0) {
        Formatter.addTableBorder(
          sheet.getRange(headerRow, 1, items.length + 1, 3)
        );
      }

      currentRow = headerRow + items.length + 2;

    });

    // ==========================================================
    // TOP-5 открытых ответов
    // ==========================================================

    reportData.topAnswers.forEach(topAnswer => {

      const question = topAnswer.question;
      const items = topAnswer.items;

      sheet.getRange(currentRow, 1).setValue(question.title);
      Formatter.formatSectionTitle(sheet.getRange(currentRow, 1));

      const headerRow = currentRow + 1;

      sheet.getRange(headerRow, 1).setValue("Ответ");
      sheet.getRange(headerRow, 2).setValue("Количество");

      Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, 2));

      items.forEach((item, index) => {
        const row = headerRow + 1 + index;
        sheet.getRange(row, 1).setValue(item.answer);
        sheet.getRange(row, 2).setValue(item.count);
      });

      if (items.length > 0) {
        Formatter.addTableBorder(
          sheet.getRange(headerRow, 1, items.length + 1, 2)
        );
      }

      currentRow = headerRow + items.length + 2;

    });

    // ==========================================================
    // Сырые данные
    // ==========================================================

    sheet.getRange(currentRow, 1).setValue("Сырые данные");
    Formatter.formatSectionTitle(sheet.getRange(currentRow, 1));

    const rawHeaders = reportData.headers;
    const rawRows = reportData.filteredRows;
    const rawHeaderRow = currentRow + 1;

    sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length).setValues([rawHeaders]);
    Formatter.formatTableHeader(
      sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length)
    );

    if (rawRows.length > 0) {

      sheet.getRange(
        rawHeaderRow + 1,
        1,
        rawRows.length,
        rawHeaders.length
      ).setValues(rawRows);

      Formatter.addTableBorder(
        sheet.getRange(rawHeaderRow, 1, rawRows.length + 1, rawHeaders.length)
      );

    }

    return sheet;

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