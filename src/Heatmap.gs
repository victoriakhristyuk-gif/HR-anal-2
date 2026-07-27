/**
 * ==========================================================
 * Подсветка проблемных выборок в сводной аналитике
 * ==========================================================
 *
 * Для вопросов Да/Скорее да/Скорее нет/Нет (см. Questions.isYesNoScale)
 * в листе "Сводная аналитика" (Summary.gs) подсвечивает фон ячеек
 * распределения программно — не условным форматированием Sheets, — так,
 * чтобы среди выборок по одному вопросу были заметны только заметно
 * отстающие от лучшей выборки. Хорошие результаты никогда не
 * подсвечиваются, столбцы и строки не добавляются, проценты в ячейках
 * не меняются — трогается только заливка уже существующих ячеек.
 *
 * Модуль разделен на две независимые части:
 *   - recordRow()/recordSample_() — техническая часть: сохранить долю
 *     положительных ответов (Да + Скорее да) конкретной выборки как
 *     developer metadata на ее ячейке (тот же прием, что и у меток
 *     листов, см. Summary.SHEET_METADATA_KEY). Значение сохраняется на
 *     самой ячейке, а не парсится потом из отображаемого текста, и не
 *     хранится в отдельном служебном столбце — потому что в задаче
 *     явно запрещено добавлять столбцы.
 *   - classify_() — сама логика "кто отстает и насколько" (см. ниже).
 *     Это единственное место, которое нужно менять при переходе на
 *     другой алгоритм подсветки (например, статистический, на основе
 *     z-score вместо относительного ранга) — recordRow()/apply() не
 *     знают, как именно принимается решение, только что на входе
 *     выборки с percent/count, а на выходе — цвет или отсутствие
 *     заливки.
 *
 * Алгоритм classify_ (v1, для первой версии):
 *   1. Исключить нерепрезентативные выборки (n < MIN_SAMPLE_SIZE).
 *   2. Если разброс (max-min) среди оставшихся меньше MIN_RANGE п.п. —
 *      различия несущественны, подсветка не применяется вовсе.
 *   3. Иначе — ранжировать оставшиеся по отставанию от максимума
 *      относительно всего разброса (0 = лучшая выборка, 1 = худшая) и
 *      подсветить только нижние две трети шкалы: желтым — среднюю
 *      треть, красным — нижнюю. Лидер и близкие к нему выборки заливки
 *      не получают.
 */
const Heatmap = {

  MIN_SAMPLE_SIZE: 5,
  MIN_RANGE: 5, // п.п. — ниже этого разброса подсветка не применяется

  // Цвета уже используются в проекте с тем же смыслом: #fff2cc —
  // предупреждение (Formatter.formatWarningBanner), #f4cccc — красный
  // порог (Formatter.applyDeltaHighlighting). Зеленый не используется —
  // хорошие результаты остаются без заливки, а не подсвечиваются.
  COLOR_YELLOW: "#fff2cc",
  COLOR_RED: "#f4cccc",

  METADATA_KEY: "hranalytics_heatmap_positive",

  /**
   * Записать для каждой ячейки-распределения строки row ее долю
   * положительных ответов (Да + Скорее да) — только для вопросов
   * Да/Нет-шкалы, для остальных столбцов ничего не делает. Вызывается
   * Summary.update() сразу после того, как значения строки записаны на
   * лист.
   *
   * distributionsByQuestion — lookups.distributions из Summary.gs:
   * словарь "название вопроса -> уже посчитанные items"
   * (Statistics.calculateDistribution), тот же, из которого сама
   * ячейка получает отображаемый текст, — здесь он не пересчитывается,
   * а используется повторно.
   */
  recordRow(sheet, row, keyColumn, columns, distributionsByQuestion) {

    columns.forEach((column, index) => {

      if (column.kind !== "distribution") {
        return;
      }

      const question = this.findYesNoQuestion_(column.question);

      if (!question) {
        return;
      }

      const items = distributionsByQuestion[column.question];

      if (!items) {
        return;
      }

      const cell = sheet.getRange(row, keyColumn + 1 + index);
      this.recordSample_(cell, items);

    });

  },

  /**
   * Вопрос из каталога по названию, только если это Да/Нет-шкала —
   * для прочих вопросов подсветка не предусмотрена (см. заголовок
   * файла).
   */
  findYesNoQuestion_(title) {

    const question = Questions.getAll().find(q => q.title === title);

    return (question && Questions.isYesNoScale(question)) ? question : null;

  },

  /**
   * Доля положительных ответов (Да + Скорее да) и общее число
   * ответивших на вопрос (знаменатель, он же n для проверки
   * репрезентативности) — из уже посчитанного распределения, без
   * повторного обращения к сырым данным.
   */
  sumPositive_(items) {

    const byAnswer = {};
    items.forEach(item => { byAnswer[String(item.answer).trim().toLowerCase()] = item; });

    const positive = ["да", "скорее да"]
      .map(answer => byAnswer[answer])
      .filter(Boolean)
      .reduce((sum, item) => sum + item.count, 0);

    const total = items.reduce((sum, item) => sum + item.count, 0);

    return {
      percent: total ? Math.round(positive / total * 100) : 0,
      count: total
    };

  },

  /**
   * Сохранить {percent, count} на ячейке как developer metadata,
   * заменяя предыдущее значение (ячейка переиспользуется при каждой
   * пересборке отчета по той же выборке — см. Summary.findRow_).
   */
  recordSample_(cell, items) {

    this.clearMetadata_(cell);

    const sample = this.sumPositive_(items);

    cell.addDeveloperMetadata(this.METADATA_KEY, JSON.stringify(sample));

  },

  clearMetadata_(cell) {

    cell.getDeveloperMetadata().forEach(metadata => {
      if (metadata.getKey() === this.METADATA_KEY) {
        metadata.remove();
      }
    });

  },

  /**
   * Перечитать сводную и перекрасить все столбцы-распределения
   * Да/Нет — вызывается один раз после того, как очередная строка
   * записана и помечена (recordRow). Пересчет всегда идет по всему
   * столбцу целиком, а не только по новой строке: подсветка одной
   * выборки зависит от значений всех остальных выборок по этому же
   * вопросу, поэтому при появлении новой строки нужно пересмотреть
   * заливку всех уже существующих строк тоже.
   */
  apply(sheet, columns, keyColumn, firstDataRow) {

    const lastRow = sheet.getLastRow();

    if (lastRow < firstDataRow) {
      return;
    }

    const rowCount = lastRow - firstDataRow + 1;

    columns.forEach((column, index) => {

      if (column.kind !== "distribution" || !this.findYesNoQuestion_(column.question)) {
        return;
      }

      const col = keyColumn + 1 + index;
      const range = sheet.getRange(firstDataRow, col, rowCount, 1);

      const samples = this.readSamples_(sheet, col, firstDataRow, rowCount);
      const colors = this.classify_(samples);

      range.setBackgrounds(colors.map(color => [color || null]));

    });

  },

  /**
   * {percent, count} по каждой строке столбца, в порядке строк — из
   * developer metadata, сохраненной recordRow(). null для строк, для
   * которых значение почему-то не было сохранено (вопрос без данных
   * в этой выборке).
   */
  readSamples_(sheet, col, firstDataRow, rowCount) {

    const samples = [];

    for (let offset = 0; offset < rowCount; offset++) {

      const cell = sheet.getRange(firstDataRow + offset, col);
      const metadata = cell.getDeveloperMetadata().find(m => m.getKey() === this.METADATA_KEY);

      samples.push(metadata ? JSON.parse(metadata.getValue()) : null);

    }

    return samples;

  },

  /**
   * Алгоритм подсветки — см. описание в начале файла. samples и
   * возвращаемый массив цветов идут в одном порядке (по строкам
   * столбца); null в результате означает "без заливки".
   */
  classify_(samples) {

    const result = samples.map(() => null);

    const eligible = samples
      .map((sample, index) => ({ sample, index }))
      .filter(entry => entry.sample && entry.sample.count >= this.MIN_SAMPLE_SIZE);

    if (eligible.length === 0) {
      return result;
    }

    const values = eligible.map(entry => entry.sample.percent);
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const range = max - min;

    if (range < this.MIN_RANGE) {
      return result;
    }

    eligible.forEach(entry => {

      // 0 — на уровне лучшей выборки, 1 — на уровне худшей.
      const gapRatio = (max - entry.sample.percent) / range;

      if (gapRatio >= 2 / 3) {
        result[entry.index] = this.COLOR_RED;
      } else if (gapRatio >= 1 / 3) {
        result[entry.index] = this.COLOR_YELLOW;
      }

    });

    return result;

  }

};
