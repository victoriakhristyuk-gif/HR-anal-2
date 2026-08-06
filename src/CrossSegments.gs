/**
 * ==========================================================
 * Связи между срезами перформанса
 * ==========================================================
 *
 * ЗАЧЕМ. Segments.gs считает каждый срез («Грейд», «Соответствие
 * ожиданиям», «Роль в отделе») НЕЗАВИСИМО против общей нормы компании.
 * Это не показывает, связаны ли сами срезы между собой — например,
 * действительно ли руководители отделов сконцентрированы в старших
 * грейдах, или высокий грейд заметно чаще идет с «Превышает ожидания».
 * Этот модуль строит попарные связи между тремя срезами, доступными
 * только для 2026 года (обогащение справочником «перформанс» —
 * см. PerformanceDirectory.gs).
 *
 * ПОЧЕМУ НЕ SPEARMAN. Значения «Грейд» и «Соответствие ожиданиям» —
 * открытый текст без зафиксированного в коде порядка (см.
 * MathStats.cramersV). Ранговая корреляция потребовала бы придумать
 * порядок категорий, которого в системе не существует — это была бы
 * подгонка, а не измерение. Поэтому связь между измерениями считается
 * V Крамера (MathStats.cramersV), а не Spearman/Pearson.
 *
 * ПЕРЕИСПОЛЬЗОВАНИЕ. Разбивка на группы и подсчет метрик группы —
 * Segments.splitBy/Segments.metricsFor, те же функции, что использует
 * обычный анализ срезов. CrossSegments не дублирует эту логику, а
 * применяет ее дважды (сначала по dimA, затем по dimB внутри каждой
 * группы dimA) — получается двумерная сетка вместо одномерной.
 */

const CrossSegments = {

  /**
   * Три среза, доступные только для 2026 года (см. AnalyticsService.build).
   * Порядок задает порядок попарных сочетаний ниже.
   */
  DIMENSIONS: ["Соответствие ожиданиям", "Грейд", "Роль в отделе"],

  /**
   * Все уникальные (неупорядоченные) пары измерений из DIMENSIONS.
   */
  pairs_() {

    const result = [];

    for (let i = 0; i < this.DIMENSIONS.length; i++) {
      for (let j = i + 1; j < this.DIMENSIONS.length; j++) {
        result.push([this.DIMENSIONS[i], this.DIMENSIONS[j]]);
      }
    }

    return result;

  },

  /**
   * Значения одного измерения, выровненные построчно с rows (null —
   * пропуск). Использует тот же поиск колонки по нормализованному
   * заголовку, что Segments.splitBy, но без специальных случаев
   * "Отдел"/"Управление" — они трем срезам этого модуля не нужны.
   */
  valuesFor_(rows, headers, dimensionTitle) {

    const target = Segments.normalizeKey_(dimensionTitle);
    const columnIndex = headers.findIndex(h => Segments.normalizeKey_(h) === target);

    if (columnIndex === -1) return rows.map(() => null);

    return rows.map(row => {
      const raw = row[columnIndex];
      if (raw === "" || raw === null || raw === undefined) return null;
      return String(raw).trim();
    });

  },

  /**
   * Двумерная кросс-таблица метрик: сначала делим на группы по dimA
   * (Segments.splitBy), затем каждую группу — по dimB. Пустые ячейки
   * (нет ни одной строки с этим сочетанием) не попадают в cells.
   *
   * @returns {{dimA, dimB, rowLabels: Array<String>, colLabels: Array<String>,
   *   cells: Array<{a, b, metrics, fragile}>}}
   */
  crossTab(rows, headers, questions, dimA, dimB) {

    const bucketsA = Segments.splitBy(rows, headers, dimA);
    const rowLabels = Object.keys(bucketsA);

    const colLabelSet = {};
    const cells = [];

    rowLabels.forEach(labelA => {

      const bucketsB = Segments.splitBy(bucketsA[labelA], headers, dimB);

      Object.keys(bucketsB).forEach(labelB => {

        colLabelSet[labelB] = true;

        const cellRows = bucketsB[labelB];
        const metrics = Segments.metricsFor(cellRows, headers, questions);

        cells.push({
          a: labelA,
          b: labelB,
          metrics: metrics,
          fragile: cellRows.length < Norms.FRAGILE_SEGMENT_SIZE
        });

      });

    });

    return {
      dimA: dimA,
      dimB: dimB,
      rowLabels: rowLabels,
      colLabels: Object.keys(colLabelSet),
      cells: cells
    };

  },

  /**
   * Связь между двумя измерениями (V Крамера) по ВСЕЙ выборке rows
   * (без учета текущих фильтров группировки — это связь на уровне
   * всей отфильтрованной выборки отчета, не одной ячейки).
   *
   * @returns {{v, chi2, n}|null} null, если данных недостаточно
   *   (см. MathStats.cramersV)
   */
  association(rows, headers, dimA, dimB) {

    const valuesA = this.valuesFor_(rows, headers, dimA);
    const valuesB = this.valuesFor_(rows, headers, dimB);

    const result = MathStats.cramersV(valuesA, valuesB);

    if (!result) return null;

    return { v: result.v, chi2: result.chi2, n: result.n };

  },

  /**
   * Все попарные связи между DIMENSIONS. Пара пропускается целиком,
   * если хотя бы одно из двух измерений пусто во всей выборке (нет
   * ни одного непустого значения) — типично значит, что справочник
   * «перформанс» недоступен (см. loadEnrichedSurveyData_ мягкий
   * fallback), и строить кросс-таблицу не из чего.
   *
   * @returns {Array<{dimA, dimB, crossTab, association}>}
   */
  analyzeAll(rows, headers, questions) {

    return this.pairs_()
      .filter(pair => {
        const valuesA = this.valuesFor_(rows, headers, pair[0]);
        const valuesB = this.valuesFor_(rows, headers, pair[1]);
        return valuesA.some(v => v !== null) && valuesB.some(v => v !== null);
      })
      .map(pair => ({
        dimA: pair[0],
        dimB: pair[1],
        crossTab: this.crossTab(rows, headers, questions, pair[0], pair[1]),
        association: this.association(rows, headers, pair[0], pair[1])
      }));

  },

  /**
   * crossTab() в виде СЕТКИ [rowLabel][colLabel] → cell, а не плоского
   * списка — нужна для матричного вывода "Грейд × Соответствие
   * ожиданиям" на листе "Связи срезов" (в отличие от analyzeAll(),
   * который дает построчный список для перебора всех пар измерений).
   */
  matrixFor_(crossTab) {

    const grid = {};

    crossTab.cells.forEach(cell => {
      if (!grid[cell.a]) grid[cell.a] = {};
      grid[cell.a][cell.b] = cell;
    });

    return {
      dimA: crossTab.dimA,
      dimB: crossTab.dimB,
      rowLabels: crossTab.rowLabels,
      colLabels: crossTab.colLabels,
      grid: grid
    };

  },

  /**
   * Вопросы анкеты с наибольшим разбросом средних между группами ОДНОГО
   * среза ("Грейд" или "Соответствие ожиданиям") — переиспользует
   * segment.metrics.means, уже посчитанный Segments.analyze для точечных
   * отклонений на листе "Отклонения срезов" (никакого нового прохода по
   * строкам). Группа учитывается по вопросу, только если у нее есть хотя
   * бы одна валидная оценка (means[title].n > 0, как в Segments.metricsFor).
   * Вопрос пропускается, если валидных групп меньше двух — разброс
   * посчитать не из чего.
   *
   * @param {Object|null} dimensionResult - элемент analytics.segments
   *   (результат Segments.analyze) для нужного среза, либо null
   * @param {Array<Object>} questions
   * @param {Number} limit - сколько вопросов вернуть (по убыванию разброса)
   * @returns {Array<{question, spread, maxGroup, maxValue, minGroup, minValue}>}
   */
  topQuestionDifferences(dimensionResult, questions, limit) {

    if (!dimensionResult || !dimensionResult.segments.length) return [];

    const titles = questions
      .filter(q => q.report && q.type !== "text" && q.type !== "single" && q.type !== "enps")
      .map(q => q.title);

    const results = [];

    titles.forEach(title => {

      const points = dimensionResult.segments
        .map(segment => (segment.metrics.means[title] && segment.metrics.means[title].n > 0)
          ? { group: segment.name, mean: segment.metrics.means[title].mean }
          : null)
        .filter(point => point !== null);

      if (points.length < 2) return;

      const max = points.reduce((a, b) => (b.mean > a.mean ? b : a));
      const min = points.reduce((a, b) => (b.mean < a.mean ? b : a));

      if (max.group === min.group) return;

      results.push({
        question: title,
        spread: MathStats.round(max.mean - min.mean, 2),
        maxGroup: max.group,
        maxValue: max.mean,
        minGroup: min.group,
        minValue: min.mean
      });

    });

    return results
      .sort((a, b) => b.spread - a.spread)
      .slice(0, limit || 8);

  },

  /**
   * Чем каждая группа среза ("Грейд"/"Соответствие ожиданиям") отличается
   * от НОРМЫ КОМПАНИИ — переиспользует segment.deviations, уже
   * посчитанные Segments.analyze (те же отклонения, что в колонке
   * "Отклонения от нормы компании" листа "Отклонения срезов"), просто
   * сортирует по величине |diff| и ограничивает список для компактного
   * блока выводов. Норма компании (а не "другие группы" попарно) — та же
   * база сравнения, что и во всем остальном отчете (см. Segments.gs).
   */
  groupInsights(dimensionResult, limit) {

    if (!dimensionResult) return [];

    return dimensionResult.segments.map(segment => {

      const top = segment.deviations
        .slice()
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, limit || 4);

      return {
        dimension: dimensionResult.dimension,
        group: segment.name,
        n: segment.n,
        top: top,
        text: top.length
          ? top.map(d => d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1) +
              (d.bad ? " ⚠" : "")).join(" · ")
          : "в пределах нормы компании"
      };

    });

  },

  /**
   * Сводка для листа "Связи срезов": общие показатели компании,
   * сравнение по грейдам/эффективности, матрица "Грейд × Соответствие
   * ожиданиям", вопросы с наибольшими различиями между группами и
   * выводы по каждой группе. Ничего не пересчитывает заново —
   * переиспользует company/segments срезов "Грейд"/"Соответствие
   * ожиданиям"/"Отдел", уже построенных AnalyticsService.build →
   * Segments.analyze (тот же принцип "не дублировать", что и у
   * остального CrossSegments — см. заголовок файла).
   *
   * @param {Array<Array>} rows
   * @param {Array<String>} headers
   * @param {Array<Object>} questions
   * @param {Array<Object>} segments - analytics.segments (все срезы)
   * @returns {Object}
   */
  overview(rows, headers, questions, segments) {

    const gradeDimension = segments.find(d => d.dimension === "Грейд") || null;
    const performanceDimension = segments.find(d => d.dimension === "Соответствие ожиданиям") || null;
    // Реальная штатная численность компании — только у "Отдел"/"Управление"/
    // "Группа команд" (см. Segments.analyze/Headcount.gs); срезы
    // "Грейд"/"Соответствие ожиданиям" считают явку от другого знаменателя
    // (справочник "перформанс"), поэтому для ОБЩЕЙ явки компании берем
    // именно "Отдел".
    const departmentDimension = segments.find(d => d.dimension === "Отдел") || null;

    const companyMetrics = Segments.metricsFor(rows, headers, questions);

    const company = Object.assign({}, companyMetrics, {
      headcount: departmentDimension ? departmentDimension.company.headcount : undefined,
      responseRatePercent: departmentDimension ? departmentDimension.company.responseRatePercent : undefined
    });

    const gradeValues = this.valuesFor_(rows, headers, "Грейд");
    const performanceValues = this.valuesFor_(rows, headers, "Соответствие ожиданиям");
    const hasMatrixData = gradeValues.some(v => v !== null) && performanceValues.some(v => v !== null);

    const matrix = hasMatrixData
      ? this.matrixFor_(this.crossTab(rows, headers, questions, "Грейд", "Соответствие ожиданиям"))
      : null;

    return {
      company: company,
      gradeComparison: gradeDimension,
      performanceComparison: performanceDimension,
      matrix: matrix,
      gradeQuestionDifferences: this.topQuestionDifferences(gradeDimension, questions, 8),
      performanceQuestionDifferences: this.topQuestionDifferences(performanceDimension, questions, 8),
      gradeInsights: this.groupInsights(gradeDimension, 4),
      performanceInsights: this.groupInsights(performanceDimension, 4)
    };

  }

};
