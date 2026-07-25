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
  }

};