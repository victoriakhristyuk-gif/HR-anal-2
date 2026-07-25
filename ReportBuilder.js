/**
 * ==========================================================
 * Построение отчета
 * ==========================================================
 */

const ReportBuilder = {

  createReport(reportData, reportName) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Удаляем старый лист, если существует
    const oldSheet = ss.getSheetByName(reportName);
    if (oldSheet) {
      ss.deleteSheet(oldSheet);
    }

    const sheet = ss.insertSheet(reportName);

    // ==========================================================
    // Базовое оформление
    // ==========================================================
    Formatter.applyBaseFont(sheet.getRange("A1:E50"));
    Formatter.formatMainTitle(sheet.getRange("A1"));
    Formatter.formatLabel(sheet.getRange("A2"));
    Formatter.formatLabel(sheet.getRange("A4"));
    Formatter.formatLabel(sheet.getRange("A6"));
    Formatter.setColumnWidths(sheet, [220, 350, null, 180, 180]);

    // ==========================================================
    // Переменная для текущей строки (всё строим последовательно)
    // ==========================================================
    let row = 1;

    // ---- Заголовок ----
    sheet.getRange(row, 1).setValue("HR Analytics");
    Formatter.formatMainTitle(sheet.getRange(row, 1));
    row += 2;

    // ---- Предупреждение, если менее 5 ответов ----
    if (reportData.employees < 5 && reportData.employees > 0) {
      const warningRow = row;
      sheet.getRange(warningRow, 1).setValue("⚠️ В выборке менее пяти ответов. Результаты могут быть нерепрезентативными.");
      sheet.getRange(warningRow, 1).setFontColor("#ff0000");
      sheet.getRange(warningRow, 1).setFontWeight("bold");
      sheet.getRange(warningRow, 1).setFontSize(10);
      // Объединяем ячейки для читаемости (от A до E, например)
      sheet.getRange(warningRow, 1, 1, 5).merge();
      row += 2; // пустая строка после предупреждения
    }

    // ---- Количество сотрудников ----
    sheet.getRange(row, 1).setValue("Количество сотрудников:");
    sheet.getRange(row, 2).setValue(reportData.employees);
    row += 2;

    // ---- Источник ----
    sheet.getRange(row, 1).setValue("Источник:");
    sheet.getRange(row, 2).setValue(reportData.source);
    row += 2;

    // ---- Паспорт выборки ----
    sheet.getRange(row, 1).setValue("Паспорт выборки:");
    const passport = reportData.filters
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.formatFilterForPassport(filter));
    sheet.getRange(row, 2).setValue(passport.join("; "));
    row += 2;

    // ---- Содержание ----
    sheet.getRange(row, 1).setValue("Содержание");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row++;
    const contentItems = ["eNPS"];
    if (reportData.comparison) {
      contentItems.push("Самые большие изменения");
    }
    contentItems.push("Средние оценки", "Распределение ответов", "TOP-5 открытых ответов", "Сырые данные");
    contentItems.forEach(item => {
      sheet.getRange(row, 1).setValue(item);
      row++;
    });
    row++; // пустая строка после содержания

    // ---- eNPS ----
    const enpsStartRow = row;
    sheet.getRange(row, 1).setValue("eNPS");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row += 2;

    if (reportData.comparison) {
      // Сравнительная таблица
      const enps2025 = reportData.enps2025;
      const enps2026 = reportData.enps2026;

      sheet.getRange(row, 1).setValue("Показатель");
      sheet.getRange(row, 2).setValue("2025");
      sheet.getRange(row, 3).setValue("2026");
      sheet.getRange(row, 4).setValue("Δ");
      Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 4));
      row++;

      const labels = ["eNPS", "Промоутеры", "Нейтралы", "Критики"];
      const values2025 = [enps2025.enps, enps2025.promoters, enps2025.neutrals, enps2025.detractors];
      const values2026 = [enps2026.enps, enps2026.promoters, enps2026.neutrals, enps2026.detractors];

      labels.forEach((label, idx) => {
        sheet.getRange(row, 1).setValue(label);
        sheet.getRange(row, 2).setValue(values2025[idx]);
        sheet.getRange(row, 3).setValue(values2026[idx]);
        const delta = values2026[idx] - values2025[idx];
        const deltaCell = sheet.getRange(row, 4);
        deltaCell.setValue(delta);
        if (delta > 0) deltaCell.setFontColor("#00aa00");
        else if (delta < 0) deltaCell.setFontColor("#ff0000");
        else deltaCell.setFontColor("#000000");
        row++;
      });

      const tableStart = enpsStartRow + 2;
      const tableEnd = row - 1;
      Formatter.addTableBorder(sheet.getRange(tableStart, 1, tableEnd - tableStart + 1, 4));

    } else {
      const enps = reportData.enps;
      sheet.getRange(row, 1).setValue("Промоутеры");
      sheet.getRange(row, 2).setValue(enps.promoters + " (" + enps.promotersPercent + "%)");
      row++;
      sheet.getRange(row, 1).setValue("Нейтралы");
      sheet.getRange(row, 2).setValue(enps.neutrals + " (" + enps.neutralsPercent + "%)");
      row++;
      sheet.getRange(row, 1).setValue("Критики");
      sheet.getRange(row, 2).setValue(enps.detractors + " (" + enps.detractorsPercent + "%)");
      row++;
      sheet.getRange(row, 1).setValue("eNPS");
      Formatter.formatLabel(sheet.getRange(row, 1));
      sheet.getRange(row, 2).setValue(enps.enps);
      Formatter.formatHighlightNumber(sheet.getRange(row, 2));
      row++;
      const tableStart = enpsStartRow + 2;
      const tableEnd = row - 1;
      Formatter.addTableBorder(sheet.getRange(tableStart, 1, tableEnd - tableStart + 1, 2));
    }

    row++; // пустая строка после eNPS

    // ---- Самые большие изменения (только для 2026) ----
    if (reportData.comparison) {
      sheet.getRange(row, 1).setValue("Самые большие изменения");
      Formatter.formatSectionTitle(sheet.getRange(row, 1));
      row += 2;

      const changes = reportData.ratingChanges;

      const renderChangeTable = (title, items, headerRow) => {
        sheet.getRange(row, 1).setValue(title);
        Formatter.formatLabel(sheet.getRange(row, 1));
        row++;

        sheet.getRange(row, 1).setValue("Вопрос");
        sheet.getRange(row, 2).setValue("2025");
        sheet.getRange(row, 3).setValue("2026");
        sheet.getRange(row, 4).setValue("Изменение");
        Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 4));
        row++;

        if (items.length === 0) {
          sheet.getRange(row, 1).setValue("Нет данных");
          row++;
        } else {
          items.forEach(item => {
            sheet.getRange(row, 1).setValue(item.question);
            sheet.getRange(row, 2).setValue(item.avg2025.toFixed(2));
            sheet.getRange(row, 3).setValue(item.avg2026.toFixed(2));
            const deltaCell = sheet.getRange(row, 4);
            deltaCell.setValue(item.change.toFixed(2));
            if (item.change > 0) deltaCell.setFontColor("#00aa00");
            else if (item.change < 0) deltaCell.setFontColor("#ff0000");
            else deltaCell.setFontColor("#000000");
            row++;
          });
        }

        const startRow = headerRow + 1;
        const endRow = row - 1;
        Formatter.addTableBorder(sheet.getRange(startRow, 1, endRow - startRow + 1, 4));
        row++;
      };

      const improvementsStart = row;
      renderChangeTable("Улучшения (топ-3)", changes.improvements, improvementsStart);
      const deteriorationsStart = row;
      renderChangeTable("Ухудшения (топ-3)", changes.deteriorations, deteriorationsStart);

      row++;
    }

    // ---- Средние оценки ----
    const avgStartRow = row;
    sheet.getRange(row, 1).setValue("Средние оценки");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row += 2;

    if (reportData.comparison) {
      const avg2025 = reportData.avg2025;
      const avg2026 = reportData.avg2026;

      sheet.getRange(row, 1).setValue("Вопрос");
      sheet.getRange(row, 2).setValue("2025");
      sheet.getRange(row, 3).setValue("2026");
      sheet.getRange(row, 4).setValue("Δ");
      Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 4));
      row++;

      const maxLen = Math.max(avg2025.length, avg2026.length);
      for (let i = 0; i < maxLen; i++) {
        const item2025 = avg2025[i] || { question: "", average: 0 };
        const item2026 = avg2026[i] || { question: "", average: 0 };
        let question = item2025.question || item2026.question;
        let avg5 = item2025.average || 0;
        let avg6 = item2026.average || 0;
        if (item2025.question && item2026.question && item2025.question !== item2026.question) {
          const found = avg2026.find(a => a.question === item2025.question);
          if (found) {
            avg6 = found.average;
            question = item2025.question;
          } else {
            question = item2025.question || item2026.question;
          }
        }
        if (!question) continue;
        sheet.getRange(row, 1).setValue(question);
        sheet.getRange(row, 2).setValue(avg5.toFixed(2));
        sheet.getRange(row, 3).setValue(avg6.toFixed(2));
        const delta = avg6 - avg5;
        const deltaCell = sheet.getRange(row, 4);
        deltaCell.setValue(delta.toFixed(2));
        if (delta > 0) deltaCell.setFontColor("#00aa00");
        else if (delta < 0) deltaCell.setFontColor("#ff0000");
        else deltaCell.setFontColor("#000000");
        row++;
      }

      const tableStart = avgStartRow + 2;
      const tableEnd = row - 1;
      Formatter.addTableBorder(sheet.getRange(tableStart, 1, tableEnd - tableStart + 1, 4));

    } else {
      const averageRatings = reportData.averageRatings;
      sheet.getRange(row, 1).setValue("Вопрос");
      sheet.getRange(row, 2).setValue("Среднее");
      Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 2));
      row++;

      averageRatings.forEach(item => {
        sheet.getRange(row, 1).setValue(item.question);
        sheet.getRange(row, 2).setValue(item.average);
        row++;
      });

      const tableStart = avgStartRow + 2;
      const tableEnd = row - 1;
      if (averageRatings.length > 0) {
        Formatter.addTableBorder(sheet.getRange(tableStart, 1, tableEnd - tableStart + 1, 2));
      }
    }

    row++; // пустая строка

    // ---- Распределение ответов ----
    const distStartRow = row;
    sheet.getRange(row, 1).setValue("Распределение ответов");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row += 2;

    if (reportData.comparison) {
      const dist2025 = reportData.distributions2025;
      const dist2026 = reportData.distributions2026;

      for (let i = 0; i < dist2025.length; i++) {
        const question = dist2025[i].question;
        const items2025 = dist2025[i].items;
        const items2026 = dist2026[i].items;

        const hideEmpty = question.title === "Город" || question.title === "Отдел";

        const map2025 = {};
        items2025.forEach(item => { map2025[item.answer] = item.percent; });
        const map2026 = {};
        items2026.forEach(item => { map2026[item.answer] = item.percent; });

        const allAnswers = [];
        const seen = {};
        question.answers.forEach(ans => {
          if (!seen[ans]) {
            seen[ans] = true;
            allAnswers.push(ans);
          }
        });
        Object.keys(map2025).forEach(ans => {
          if (!seen[ans]) {
            seen[ans] = true;
            allAnswers.push(ans);
          }
        });
        Object.keys(map2026).forEach(ans => {
          if (!seen[ans]) {
            seen[ans] = true;
            allAnswers.push(ans);
          }
        });

        let filteredAnswers = allAnswers;
        if (hideEmpty) {
          filteredAnswers = allAnswers.filter(ans => {
            const count2025 = items2025.find(item => item.answer === ans)?.count || 0;
            const count2026 = items2026.find(item => item.answer === ans)?.count || 0;
            return (count2025 + count2026) > 0;
          });
        }

        sheet.getRange(row, 1).setValue(question.title);
        Formatter.formatSectionTitle(sheet.getRange(row, 1));
        row++;

        sheet.getRange(row, 1).setValue("Ответ");
        sheet.getRange(row, 2).setValue("2025");
        sheet.getRange(row, 3).setValue("2026");
        sheet.getRange(row, 4).setValue("Δ");
        Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 4));
        row++;

        filteredAnswers.forEach(ans => {
          const p2025 = map2025[ans] || 0;
          const p2026 = map2026[ans] || 0;
          const delta = p2026 - p2025;
          sheet.getRange(row, 1).setValue(ans);
          sheet.getRange(row, 2).setValue(p2025 + "%");
          sheet.getRange(row, 3).setValue(p2026 + "%");
          const deltaCell = sheet.getRange(row, 4);
          deltaCell.setValue(delta + "%");
          if (delta > 0) deltaCell.setFontColor("#00aa00");
          else if (delta < 0) deltaCell.setFontColor("#ff0000");
          else deltaCell.setFontColor("#000000");
          row++;
        });

        const startRowTable = row - filteredAnswers.length - 1;
        const endRowTable = row - 1;
        if (filteredAnswers.length > 0) {
          Formatter.addTableBorder(sheet.getRange(startRowTable, 1, endRowTable - startRowTable + 1, 4));
        }
        row++;
      }

    } else {
      const distributions = reportData.distributions || [];
      distributions.forEach(distribution => {
        const question = distribution.question;
        const hideEmpty = question.title === "Город" || question.title === "Отдел";
        const items = hideEmpty
          ? distribution.items.filter(item => item.count > 0)
          : distribution.items;

        sheet.getRange(row, 1).setValue(question.title);
        Formatter.formatSectionTitle(sheet.getRange(row, 1));
        row++;

        sheet.getRange(row, 1).setValue("Ответ");
        sheet.getRange(row, 2).setValue("Количество");
        sheet.getRange(row, 3).setValue("Процент");
        Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 3));
        row++;

        items.forEach(item => {
          sheet.getRange(row, 1).setValue(item.answer);
          sheet.getRange(row, 2).setValue(item.count);
          sheet.getRange(row, 3).setValue(item.percent + "%");
          row++;
        });

        if (items.length > 0) {
          const startRowTable = row - items.length - 1;
          const endRowTable = row - 1;
          Formatter.addTableBorder(sheet.getRange(startRowTable, 1, endRowTable - startRowTable + 1, 3));
        }
        row++;
      });
    }

    row++; // дополнительная пустая строка

    // ---- TOP-5 открытых ответов ----
    const topStartRow = row;
    sheet.getRange(row, 1).setValue("TOP-5 открытых ответов");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row += 2;

    const topAnswers = reportData.topAnswers || [];
    topAnswers.forEach(topAnswer => {
      const question = topAnswer.question;
      const items = topAnswer.items;

      sheet.getRange(row, 1).setValue(question.title);
      Formatter.formatSectionTitle(sheet.getRange(row, 1));
      row++;

      sheet.getRange(row, 1).setValue("Ответ");
      sheet.getRange(row, 2).setValue("Количество");
      Formatter.formatTableHeader(sheet.getRange(row, 1, 1, 2));
      row++;

      items.forEach(item => {
        sheet.getRange(row, 1).setValue(item.answer);
        sheet.getRange(row, 2).setValue(item.count);
        row++;
      });

      if (items.length > 0) {
        const startRowTable = row - items.length - 1;
        const endRowTable = row - 1;
        Formatter.addTableBorder(sheet.getRange(startRowTable, 1, endRowTable - startRowTable + 1, 2));
      }
      row++;
    });

    row++;

    // ---- Сырые данные ----
    sheet.getRange(row, 1).setValue("Сырые данные");
    Formatter.formatSectionTitle(sheet.getRange(row, 1));
    row += 2;

    const rawHeaders = reportData.headers;
    const rawRows = reportData.filteredRows;

    sheet.getRange(row, 1, 1, rawHeaders.length).setValues([rawHeaders]);
    Formatter.formatTableHeader(sheet.getRange(row, 1, 1, rawHeaders.length));
    row++;

    if (rawRows.length > 0) {
      sheet.getRange(row, 1, rawRows.length, rawHeaders.length).setValues(rawRows);
      Formatter.addTableBorder(sheet.getRange(row - 1, 1, rawRows.length + 1, rawHeaders.length));
    }

    return sheet;
  },

  hasFilterValue(filter) {
    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.value !== undefined && filter.value !== null && filter.value !== "";
    }
    return filter.values && filter.values.length > 0;
  },

  formatFilterForPassport(filter) {
    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.question + filter.operator + filter.value;
    }
    return filter.question + "=" + filter.values.join(", ");
  }

};