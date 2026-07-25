/**
 * ==========================================================
 * Оформление отчета
 * ==========================================================
 */

const Formatter = {

  /**
   * Базовый шрифт для всего отчета
   */
  applyBaseFont(range) {
    range.setFontFamily("Arial").setFontSize(10);
  },

  /**
   * Главный заголовок отчета (16 pt, жирный)
   */
  formatMainTitle(range) {
    range.setFontSize(16).setFontWeight("bold");
  },

  /**
   * Название раздела (13 pt, жирный)
   */
  formatSectionTitle(range) {
    range.setFontSize(13).setFontWeight("bold");
  },

  /**
   * Подпись-метка (жирный текст)
   */
  formatLabel(range) {
    range.setFontWeight("bold");
  },

  /**
   * Заголовок таблицы: жирный текст, светло-серый фон
   */
  formatTableHeader(range) {
    range
      .setFontWeight("bold")
      .setBackground("#f3f3f3");
  },

  /**
   * Крупное выделенное число (например, итоговый eNPS)
   */
  formatHighlightNumber(range) {
    range.setFontSize(18).setFontWeight("bold");
  },

  /**
   * Внешняя и внутренняя рамка таблицы
   */
  addTableBorder(range) {
    range.setBorder(true, true, true, true, true, true);
  },

  /**
   * Ширина столбцов листа.
   * widths[i] задает ширину столбца (i + 1); пропуск элемента
   * (null/undefined) оставляет ширину столбца по умолчанию.
   */
  setColumnWidths(sheet, widths) {
    widths.forEach((width, index) => {
      if (width) {
        sheet.setColumnWidth(index + 1, width);
      }
    });
  },

  /**
   * Заморозить верхние строки и левые столбцы листа (например, чтобы
   * заголовок/паспорт/exec summary оставались видны при прокрутке).
   */
  freezeHeader(sheet, rows, columns) {
    sheet.setFrozenRows(rows);
    sheet.setFrozenColumns(columns);
  },

  /**
   * Свернуть/сгруппировать диапазон строк (например, секцию анкеты
   * или отдельный вопрос внутри нее) в сворачиваемую группу.
   */
  groupRows(sheet, startRow, numRows, collapsed) {

    sheet.getRange(startRow, 1, numRows).shiftRowGroupDepth(1);

    if (collapsed) {
      const group = sheet.getRowGroup(startRow, 1);
      if (group) {
        group.collapse();
      }
    }

  },

  /**
   * Стиль баннера предупреждения (например, о нерепрезентативной
   * выборке) — бледно-желтый фон, жирный текст. Данные при этом не
   * скрываются, баннер только привлекает внимание.
   */
  formatWarningBanner(range) {
    range.setBackground("#fff2cc").setFontWeight("bold");
  },

  /**
   * Толстая верхняя граница — визуально отделяет крупный блок
   * (например, "Сырые данные") от всего, что расположено выше.
   */
  formatSectionDivider(range) {
    range.setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID_THICK);
  },

  /**
   * Цветовая шкала на диапазоне значений (например, средние оценки
   * 1-5 или проценты 0-100) — добавляется к уже существующим правилам
   * условного форматирования листа, не заменяя их.
   *
   * У ConditionalFormatRuleBuilder нет простого setGradientMidpoint(color)
   * (в отличие от Min/Max у него нет однозначного значения по умолчанию) —
   * средняя точка обязательно задается через setGradientMidpointWithValue
   * с явным типом интерполяции; берем 50% между минимумом и максимумом
   * диапазона.
   */
  applyColorScale(sheet, range, minColor, midColor, maxColor) {

    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(minColor)
      .setGradientMidpointWithValue(midColor, SpreadsheetApp.InterpolationType.PERCENT, "50")
      .setGradientMaxpoint(maxColor)
      .setRanges([range])
      .build();

    const rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);

  },

  /**
   * Подсветка ячеек динамики (Δ): зеленый фон при заметном росте,
   * красный при заметном снижении, без подсветки — если изменение
   * меньше порога. Порог передается вызывающей стороной (например,
   * ReportBuilder) — какой именно порог считать "заметным" для
   * конкретного показателя, это знание о предметной области отчета,
   * а не об оформлении.
   */
  applyDeltaHighlighting(sheet, range, threshold) {

    const positiveRule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(threshold)
      .setBackground("#d9ead3")
      .setFontColor("#274e13")
      .setRanges([range])
      .build();

    const negativeRule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThanOrEqualTo(-threshold)
      .setBackground("#f4cccc")
      .setFontColor("#990000")
      .setRanges([range])
      .build();

    const rules = sheet.getConditionalFormatRules();
    rules.push(positiveRule, negativeRule);
    sheet.setConditionalFormatRules(rules);

  },

  /**
   * Числовой формат для ячейки динамики: знак и стрелка (▲/▼/–)
   * встроены в формат самой ячейки, а не в текст — значение остается
   * числом (сортируется, к нему применимо условное форматирование
   * выше), но всегда читается со знаком и стрелкой, а не только по
   * цвету. suffix — необязательная подпись после числа (например
   * " п.п."), иначе используется как есть (например, для баллов).
   */
  applyDeltaNumberFormat(range, suffix) {

    const unit = suffix || "";

    range.setNumberFormat(
      '"▲ +"0.0"' + unit + '";"▼ "-0.0"' + unit + '";"– "0.0"' + unit + '"'
    );

  },

  /**
   * Компактный горизонтальный мини-бар в ячейке (вместо отдельного
   * графика на каждую строку таблицы) — например, для наглядности
   * средней оценки на шкале 0..max в общем обзоре средних.
   */
  setBarFormula(cell, value, max) {
    cell.setFormula('=SPARKLINE(' + value + ',{"charttype","bar";"max",' + max + '})');
  }

};