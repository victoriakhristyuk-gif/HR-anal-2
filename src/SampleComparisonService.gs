/**
 * ==========================================================
 * Сравнение 2-4 произвольных выборок одного источника
 * ==========================================================
 *
 * Обобщение исходной идеи (сравнение ровно двух срезов A/B одного
 * источника) на 2-4 среза сразу. Год один и тот же для всех срезов,
 * поэтому year-зависимые справочники (Headcount, DepartmentAliases)
 * резолвятся одинаково для всех — сложность сравнения РАЗНЫХ листов/лет
 * здесь не нужна (см. Comparison.gs/ReportService.gs).
 *
 * Значения (eNPS, средние оценки, распределения) считаются один раз на
 * выборку через computeReportMetrics_ — это то же самое, что и раньше.
 * Статистическая значимость различий (HR-002) по-прежнему считается
 * только между ДВУМЯ выборками за раз (z-test/Уэлч — двухвыборочные
 * тесты), поэтому для значимости здесь считаются ВСЕ попарные сравнения
 * (до 6 пар при 4 выборках), каждая — обычным Comparison.build без
 * изменений в нем самом. Топ-5 открытых вопросов — исключение: набор
 * вариантов не фиксирован катлогом (в отличие от distributions/
 * averageRatings), поэтому объединяется явно по всем выборкам сразу
 * (mergeTopAnswers_), а не попарно.
 */

const SAMPLE_COMPARISON_LETTERS = ["A", "B", "C", "D"];

const SampleComparisonService = {

  /**
   * Построить лист сравнения 2-4 срезов source. filtersList/namesList —
   * массивы одинаковой длины (namesList может быть короче/содержать
   * пустые строки — тогда подпись строится из фильтров, см. resolveLabel_).
   */
  compareMany(source, filtersList, namesList) {

    if (!filtersList || filtersList.length < 2) {
      throw new Error("Нужно минимум две выборки для сравнения.");
    }

    if (filtersList.length > SAMPLE_COMPARISON_LETTERS.length) {
      throw new Error("Сравнение поддерживает не более " + SAMPLE_COMPARISON_LETTERS.length + " выборок.");
    }

    const survey = loadEnrichedSurveyData_(source, true);

    const filteredRows = filtersList.map(filters =>
      FilterEngine.applyFilters(survey.data, survey.headers, filters, source)
    );

    filteredRows.forEach((rows, index) => {
      if (rows.length === 0) {
        throw new Error(
          "Выборка " + SAMPLE_COMPARISON_LETTERS[index] + " пуста при заданных фильтрах — сравнение невозможно."
        );
      }
    });

    const headcounts = filteredRows.map((rows, index) =>
      calculateResponseRateForYear_(source, { rows: rows }, filtersList[index]).headcount
    );

    const metrics = filteredRows.map((rows, index) =>
      computeReportMetrics_(source, rows, survey.headers, headcounts[index])
    );

    const labels = filtersList.map((filters, index) => this.resolveLabel_((namesList || [])[index], filters));

    // Все попарные сравнения i<j — до 6 пар при 4 выборках. Значения
    // (delta/significant) переиспользуют Comparison.build как есть;
    // сами величины (для колонок по каждой выборке) берутся из metrics
    // напрямую, без обращения к comparison (см. SampleComparisonBuilder).
    const pairs = [];

    for (let i = 0; i < filteredRows.length; i++) {
      for (let j = i + 1; j < filteredRows.length; j++) {

        const comparison = Comparison.build(
          { employees: filteredRows[i].length, enps: metrics[i].enps, averageRatings: metrics[i].averageRatings },
          { employees: filteredRows[j].length, enps: metrics[j].enps, averageRatings: metrics[j].averageRatings },
          metrics[i].distributions,
          metrics[j].distributions,
          metrics[i].topAnswerFrequencies,
          metrics[j].topAnswerFrequencies,
          headcounts[i],
          headcounts[j]
        );

        pairs.push({ i: i, j: j, comparison: comparison });

      }
    }

    const topAnswers = this.mergeTopAnswers_(metrics);

    const sheet = SampleComparisonBuilder.renderMany({
      source: source,
      labels: labels,
      filtersList: filtersList,
      employees: filteredRows.map(rows => rows.length),
      headcounts: headcounts,
      metrics: metrics,
      pairs: pairs,
      topAnswers: topAnswers
    });

    return {
      sheetName: sheet.getName(),
      labels: labels,
      employees: filteredRows.map(rows => rows.length)
    };

  },

  /** Пользовательская подпись выборки или, если не задана, — сгенерированная по фильтрам. */
  resolveLabel_(customName, filters) {

    const trimmed = (customName || "").trim();

    return trimmed.length > 0 ? trimmed : ReportBuilder.generateReportName(filters);

  },

  /**
   * Слить Топ-5 открытых вопросов сразу по ВСЕМ выборкам. В отличие от
   * distributions/averageRatings, набор вариантов Топ-5 не фиксирован
   * общим каталогом — он выбирается по частоте в КАЖДОЙ выборке
   * отдельно (Statistics.selectTopAnswers), поэтому итоговый список
   * вариантов — объединение top-5 (по count) каждой выборки, как и в
   * Comparison.compareTopAnswerItems, только не для пары, а для всех
   * выборок сразу.
   */
  mergeTopAnswers_(metrics) {

    const questions = metrics[0].topAnswerFrequencies.map(entry => entry.question);

    return questions.map((question, qIndex) => {

      const perSampleFrequencies = metrics.map(m => m.topAnswerFrequencies[qIndex].frequencies);

      const byAnswerPerSample = perSampleFrequencies.map(freq => {
        const map = {};
        freq.items.forEach(item => { map[item.answer] = item; });
        return map;
      });

      const seenAnswers = {};
      const orderedAnswers = [];

      perSampleFrequencies.forEach(freq => {
        freq.items
          .slice()
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .forEach(item => {
            if (!seenAnswers[item.answer]) {
              seenAnswers[item.answer] = true;
              orderedAnswers.push(item.answer);
            }
          });
      });

      const items = orderedAnswers.map(answer => {

        const values = byAnswerPerSample.map((map, sampleIndex) => {
          const item = map[answer];
          const validCount = perSampleFrequencies[sampleIndex].validCount;
          const count = item ? item.count : 0;
          return {
            count: count,
            percent: validCount > 0 ? Math.round(count / validCount * 100) : null
          };
        });

        return { answer: answer, values: values };

      });

      // Крупные варианты (по сумме count по всем выборкам) — сверху.
      items.sort((a, b) =>
        b.values.reduce((sum, v) => sum + v.count, 0) - a.values.reduce((sum, v) => sum + v.count, 0)
      );

      return { question: question, items: items };

    });

  }

};
