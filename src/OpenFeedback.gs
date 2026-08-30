/**
 * ==========================================================
 * Разметка тональности на листе "открытая ОС"
 * ==========================================================
 *
 * Лист создается и наполняется вручную (текст комментариев в столбцах
 * "Открытая ОС 1"/"Открытая ОС 2" + произвольные доп. столбцы). Этот
 * модуль пересобирает лист: убирает строки без содержательного ответа
 * (пропуски, "нет"/"нет ответа", одни точки/тире), дописывает столбцы
 * "Тональность" и "Темы", заливает строки цветом по тону и
 * сортирует их: негатив → смешанно → нейтрально → позитив.
 *
 * Идемпотентно: столбцы "Тональность"/"Темы" от предыдущего запуска
 * распознаются по заголовку и пересчитываются заново, а не дублируются.
 *
 * Маркеры тона и словарь тем не дублируются здесь отдельно — берутся
 * из ReportBuilder.THEME_DICTIONARY_ (единственный источник, вычитанный
 * вручную на реальных данных, см. ReportBuilder.gs). Темы — прямой
 * результат ReportBuilder.matchCommentThemes_ на объединенном тексте
 * комментария. Тон — та же логика маркеров, что и в matchCommentThemes_
 * (вычитание сработавших негативных маркеров перед поиском позитивных),
 * но по всему тексту комментария целиком, а не по предложениям одной
 * темы — здесь нужен один общий вердикт на комментарий, а не на
 * пару комментарий+тема.
 */

const OpenFeedback = {

  SHEET_NAME: "открытая ОС",
  COMMENT_COLUMNS: ["Открытая ОС 1", "Открытая ОС 2"],
  TONE_HEADER: "Тональность",
  THEMES_HEADER: "Темы",

  TONE_ORDER_: ["negative", "mixed", "neutral", "positive"],

  TONE_LABELS_: {
    negative: "Негатив",
    mixed: "Смешанно",
    neutral: "Нейтрально",
    positive: "Позитив"
  },

  TONE_COLORS_: {
    negative: "#f4cccc",
    mixed: "#fff2cc",
    neutral: "#f3f3f3",
    positive: "#d9ead3"
  },

  // Ответы без содержания: пропуски, чистая пунктуация, типовые "нет"/
  // "нет ответа" в разных написаниях. Сравнение — по нормализованному
  // тексту (регистр, пробелы, обрамляющая пунктуация убраны), поэтому
  // "Нет.", "нет ответа", "  -  " и т.п. распознаются тем же набором.
  EMPTY_ANSWER_SET_: [
    "", "-", "--", ".", "..", "...", "нет", "нету", "нет ответа", "без ответа",
    "не указано", "n/a", "na", "no", "no comment", "нет комментариев", "затрудняюсь ответить"
  ],

  markersCache_: null,

  /** Пул негативных/позитивных маркеров из всех тем словаря, без дублей. */
  markers_() {

    if (this.markersCache_) {
      return this.markersCache_;
    }

    const negative = [];
    const positive = [];

    ReportBuilder.THEME_DICTIONARY_.forEach(entry => {
      entry.negative.forEach(marker => negative.push(marker.toLowerCase()));
      entry.positive.forEach(marker => positive.push(marker.toLowerCase()));
    });

    this.markersCache_ = {
      negative: Array.from(new Set(negative)),
      positive: Array.from(new Set(positive))
    };

    return this.markersCache_;

  },

  normalizeAnswer_(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—.,;:!?]+|[\s\-–—.,;:!?]+$/g, "");
  },

  isEmptyAnswer_(text) {
    return this.EMPTY_ANSWER_SET_.indexOf(this.normalizeAnswer_(text)) !== -1;
  },

  /**
   * Тон целого комментария — маркеры matchCommentThemes_, но по всему
   * тексту, без разбиения на предложения и без привязки к теме.
   */
  detectTone_(text) {

    const lower = text.toLowerCase();
    const markers = this.markers_();

    const hasNegative = markers.negative.some(marker => lower.indexOf(marker) !== -1);

    const withoutNegative = markers.negative.reduce((acc, marker) => {
      return lower.indexOf(marker) !== -1 ? acc.split(marker).join(" ") : acc;
    }, lower);

    const hasPositive = markers.positive.some(marker => withoutNegative.indexOf(marker) !== -1);

    return hasNegative && hasPositive ? "mixed" : hasNegative ? "negative" : hasPositive ? "positive" : "neutral";

  },

  /** Темы из словаря, найденные в комментарии, без тональности — просто список названий. */
  detectThemeTags_(text) {
    const themes = ReportBuilder.matchCommentThemes_(text).map(match => match.theme);
    return Array.from(new Set(themes)).join(", ");
  },

  findColumnIndex_(headers, title) {
    return headers.findIndex(header => Statistics.normalize_(header) === Statistics.normalize_(title));
  },

  /** Пункт меню: разметить, залить, отсортировать лист "открытая ОС". */
  analyze() {

    const ui = SpreadsheetApp.getUi();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);

    if (!sheet) {
      ui.alert('Лист "' + this.SHEET_NAME + '" не найден.');
      return;
    }

    const values = sheet.getDataRange().getValues();

    if (values.length < 2) {
      ui.alert('На листе "' + this.SHEET_NAME + '" нет строк с данными.');
      return;
    }

    const headers = values[0];
    const commentColumnIndexes = this.COMMENT_COLUMNS
      .map(title => this.findColumnIndex_(headers, title))
      .filter(index => index !== -1);

    if (commentColumnIndexes.length === 0) {
      ui.alert('Не найдены столбцы с текстом комментария (' + this.COMMENT_COLUMNS.join(', ') + ').');
      return;
    }

    // Столбцы предыдущего запуска (если есть) исключаются из "базовых"
    // колонок — пересчитываются заново, а не переносятся как есть.
    const toneColumnIndex = this.findColumnIndex_(headers, this.TONE_HEADER);
    const themesColumnIndex = this.findColumnIndex_(headers, this.THEMES_HEADER);
    const excludedIndexes = [toneColumnIndex, themesColumnIndex].filter(index => index !== -1);

    const baseColumnIndexes = headers.map((_, index) => index).filter(index => excludedIndexes.indexOf(index) === -1);
    const baseHeaders = baseColumnIndexes.map(index => headers[index]);

    const records = values.slice(1)
      .map(row => {

        const text = commentColumnIndexes
          .map(index => String(row[index] || "").trim())
          .filter(part => part.length > 0)
          .join(" ");

        return { row, text };

      })
      .filter(record => !this.isEmptyAnswer_(record.text))
      .map(record => ({
        base: baseColumnIndexes.map(index => record.row[index]),
        tone: this.detectTone_(record.text),
        themes: this.detectThemeTags_(record.text)
      }));

    records.sort((a, b) => this.TONE_ORDER_.indexOf(a.tone) - this.TONE_ORDER_.indexOf(b.tone));

    sheet.clear();

    const columnCount = baseHeaders.length + 2;
    const outputHeaders = baseHeaders.concat([this.TONE_HEADER, this.THEMES_HEADER]);

    sheet.getRange(1, 1, 1, columnCount).setValues([outputHeaders]).setFontWeight("bold");

    if (records.length > 0) {

      const outputRows = records.map(record => record.base.concat([this.TONE_LABELS_[record.tone], record.themes]));
      const bodyRange = sheet.getRange(2, 1, outputRows.length, columnCount);
      bodyRange.setValues(outputRows);

      const backgrounds = records.map(record => new Array(columnCount).fill(this.TONE_COLORS_[record.tone]));
      bodyRange.setBackgrounds(backgrounds);

    }

    ui.alert('Готово: содержательных ответов — ' + records.length + ' (пропуски и "нет ответа" убраны).');

  }

};

function runOpenFeedbackAnalysis() {
  OpenFeedback.analyze();
}
