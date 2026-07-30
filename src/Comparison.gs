/**
 * ==========================================================
 * Сравнение выборки 2026 с 2025
 * ==========================================================
 *
 * Не пересчитывает статистику самостоятельно и вообще не обращается ни
 * к Statistics, ни к сырым строкам выборок: получает уже готовые
 * показатели обоих годов (посчитанные один раз в ReportService по двум
 * выборкам, отфильтрованным одним и тем же FilterEngine.applyFilters) и
 * только сопоставляет их между собой.
 */

const Comparison = {

  /**
   * Собрать сравнительные данные.
   *
   * Ничего не считает по сырым строкам — на вход приходят только уже
   * готовые показатели обоих годов, посчитанные ReportService через
   * Statistics: eNPS и средние оценки (stats2026/stats2025),
   * распределения по каждому вопросу из Questions.getDistributionQuestions()
   * и полные частоты ответов вопросов Топ-5. Здесь они только
   * сопоставляются между годами.
   *
   * Раньше eNPS и средние оценки пересчитывались прямо здесь, хотя за
   * текущий год вызывающая сторона уже посчитала ровно то же самое —
   * это был лишний полный проход по данным каждого года.
   *
   * @param {Object} stats2026 - {employees, enps, averageRatings}
   * @param {Object} stats2025 - {employees, enps, averageRatings}
   * @param {Array<Object>} distributions2026
   * @param {Array<Object>} distributions2025
   * @param {Array<Object>} topAnswerFrequencies2026 - {question, frequencies: {items, validCount}}
   * @param {Array<Object>} topAnswerFrequencies2025
   */
  build(stats2026, stats2025, distributions2026, distributions2025, topAnswerFrequencies2026, topAnswerFrequencies2025) {

    return {
      employees2026: stats2026.employees,
      employees2025: stats2025.employees,
      enps: this.compareENPS(stats2026.enps, stats2025.enps),
      averageRatings: this.compareAverageRatings(stats2026.averageRatings, stats2025.averageRatings),
      distributions: this.compareDistributions(distributions2026 || [], distributions2025 || []),
      topAnswers: this.compareTopAnswers(topAnswerFrequencies2026 || [], topAnswerFrequencies2025 || [])
    };

  },

  /**
   * Разница eNPS в процентных пунктах. Если в одном из годов нет ни
   * одного ответа — значение и динамика не подставляются нулем, а
   * остаются null.
   */
  compareENPS(enps2026, enps2025) {

    const value2026 = enps2026.total > 0 ? enps2026.enps : null;
    const value2025 = enps2025.total > 0 ? enps2025.enps : null;

    return {
      value2026: value2026,
      value2025: value2025,
      delta: (value2026 !== null && value2025 !== null)
        ? value2026 - value2025
        : null,
      categories: this.compareEnpsCategories_(enps2026, enps2025)
    };

  },

  /**
   * Разбивка eNPS (промоутеры/нейтралы/критики) по годам — количество,
   * % (null, если в этом году нет ни одного валидного ответа, по той
   * же схеме, что и compareDistributionItems) и дельта в процентных
   * пунктах. Не пересчитывает eNPS — только сопоставляет уже готовые
   * enps2026/enps2025 от Statistics.calculateENPS.
   */
  compareEnpsCategories_(enps2026, enps2025) {

    return ["promoters", "neutrals", "detractors"].map(category => {

      const percentKey = category + "Percent";

      const percent2026 = enps2026.total > 0 ? enps2026[percentKey] : null;
      const percent2025 = enps2025.total > 0 ? enps2025[percentKey] : null;

      return {
        category: category,
        count2026: enps2026[category],
        percent2026: percent2026,
        count2025: enps2025[category],
        percent2025: percent2025,
        delta: (percent2026 !== null && percent2025 !== null)
          ? percent2026 - percent2025
          : null
      };

    });

  },

  /**
   * Арифметическая разница средних оценок по каждому вопросу.
   * Сопоставление вопросов — по названию (question), т.к. Statistics
   * возвращает их в порядке каталога Questions для каждого года
   * независимо.
   */
  compareAverageRatings(ratings2026, ratings2025) {

    const byQuestion2025 = {};
    ratings2025.forEach(item => { byQuestion2025[item.question] = item; });

    return ratings2026.map(item2026 => {

      const item2025 = byQuestion2025[item2026.question];

      const value2026 = item2026.count > 0 ? item2026.average : null;
      const value2025 = (item2025 && item2025.count > 0) ? item2025.average : null;

      return {
        question: item2026.question,
        value2026: value2026,
        value2025: value2025,
        delta: (value2026 !== null && value2025 !== null)
          ? +(value2026 - value2025).toFixed(2)
          : null
      };

    });

  },

  /**
   * Сопоставить распределения ответов по каждому аналитическому вопросу.
   * Вопросы сопоставляются по названию (question.title) — тот же список
   * вопросов и тот же порядок вариантов ответа используется для обоих
   * годов (задается Statistics.getDistributionOrder_/Questions), поэтому
   * порядок вариантов не пересортировывается и не зависит от частоты.
   */
  compareDistributions(distributions2026, distributions2025) {

    const byQuestionTitle2025 = {};
    distributions2025.forEach(d => { byQuestionTitle2025[d.question.title] = d; });

    return distributions2026.map(d2026 => {

      const d2025 = byQuestionTitle2025[d2026.question.title];

      return {
        question: d2026.question,
        items: this.compareDistributionItems(
          d2026.items,
          d2025 ? d2025.items : [],
          d2026.question.title
        )
      };

    });

  },

  /**
   * К 2026 году несколько отделов были переименованы (и один вариант
   * ответа 2025 года содержал опечатку) — реальные орг. изменения, не
   * ошибка загрузки данных. Statistics.calculateDistribution считает
   * распределение 2025 года по тому же фиксированному каталогу
   * question.answers, что и 2026 (см. Statistics.getDistributionOrder_),
   * и молча отбрасывает значения, которых там нет — поэтому старое
   * название нужно привести к новому ДО расчета распределения, иначе
   * сравнение по "Отделу" (Состав выборки) считало бы старый отдел
   * пропавшим, а новый — появившимся с нуля. Используется только
   * ReportService при подсчете distributions2025 для сравнения годов —
   * сама filteredData2025 (сырые данные, фильтры, eNPS/средние оценки
   * 2025) не трогается, здесь применяется только к копии строк.
   *
   * Таблица алиасов вынесена в DepartmentAliases (справочник
   * оргструктуры) — здесь только применение к строкам одного года.
   */
  remapDepartmentRows_(rows, headers) {

    const columnIndex = headers.findIndex(
      header => Statistics.normalize_(header) === Statistics.normalize_("Отдел")
    );

    if (columnIndex === -1) {
      return rows;
    }

    return rows.map(row => {

      const canonicalAnswer = DepartmentAliases.canonicalize(row[columnIndex]);

      if (canonicalAnswer === row[columnIndex]) {
        return row;
      }

      const newRow = row.slice();
      newRow[columnIndex] = canonicalAnswer;
      return newRow;

    });

  },

  /**
   * Сопоставить варианты ответа одного вопроса между годами.
   *
   * Процент каждого года считается Statistics.calculateDistribution
   * относительно валидных ответов именно этого года (пропуски уже
   * исключены на этом этапе) — здесь только используется готовый
   * "percent". Если по году нет ни одного валидного ответа на вопрос
   * (сумма count по всем вариантам = 0), percent и динамика для этого
   * года выводятся как null, а не как фиктивный 0%.
   *
   * Вариант ответа, отсутствующий в данных одного из годов, все равно
   * присутствует в результате (со значением count 0 для этого года) —
   * т.к. оба года считаются по одному и тому же вопросу/каталогу
   * вариантов ответа.
   *
   * Для вопроса "Отдел" (questionTitle) каждая строка получает
   * renamedFrom — известные прежние названия этого отдела
   * (DepartmentAliases), т.е. примечание о переименовании. Для
   * остальных вопросов — всегда пустой массив.
   */
  compareDistributionItems(items2026, items2025, questionTitle) {

    const total2026 = items2026.reduce((sum, item) => sum + item.count, 0);
    const total2025 = items2025.reduce((sum, item) => sum + item.count, 0);

    const isDepartmentQuestion = Statistics.normalize_(questionTitle) === Statistics.normalize_("Отдел");

    const byAnswer2025 = {};
    items2025.forEach(item => { byAnswer2025[item.answer] = item; });

    return items2026.map(item2026 => {

      const item2025 = byAnswer2025[item2026.answer];

      const count2026 = item2026.count;
      const count2025 = item2025 ? item2025.count : 0;

      const percent2026 = total2026 > 0 ? item2026.percent : null;
      const percent2025 = total2025 > 0 ? (item2025 ? item2025.percent : 0) : null;

      return {
        answer: item2026.answer,
        count2026: count2026,
        percent2026: percent2026,
        count2025: count2025,
        percent2025: percent2025,
        delta: (percent2026 !== null && percent2025 !== null)
          ? percent2026 - percent2025
          : null,
        renamedFrom: isDepartmentQuestion ? DepartmentAliases.getAliasesFor(item2026.answer) : []
      };

    });

  },

  /**
   * Сопоставить Топ-5 открытых вопросов с множественным выбором
   * ("Ценишь в компании", "Зоны роста компании") между годами.
   * Вопросы сопоставляются по названию (question.title).
   */
  compareTopAnswers(topAnswerFrequencies2026, topAnswerFrequencies2025) {

    const byQuestionTitle2025 = {};
    topAnswerFrequencies2025.forEach(entry => { byQuestionTitle2025[entry.question.title] = entry; });

    return topAnswerFrequencies2026.map(entry2026 => {

      const entry2025 = byQuestionTitle2025[entry2026.question.title];

      return {
        question: entry2026.question,
        items: this.compareTopAnswerItems(
          entry2026.frequencies,
          entry2025 ? entry2025.frequencies : { items: [], validCount: 0 },
          5
        )
      };

    });

  },

  /**
   * Сопоставить полные (неусеченные) частоты одного Топ-5 вопроса между
   * годами. Сначала считаются проценты и динамика для ВСЕХ вариантов,
   * встретившихся хотя бы в одном году (один вариант может выбираться несколькими
   * респондентами одновременно — знаменатель "validCount" это количество
   * респондентов с непустым ответом на вопрос, как и в исходном
   * Statistics.selectTopAnswers/calculateAnswerFrequencies, а не сумма
   * выборов). Итоговый Топ-5 — это объединение top-5 по 2026 и top-5 по
   * 2025 (по count), чтобы вариант, выпавший из топа одного года из-за
   * ограничения в 5 позиций, не пропадал из сравнения.
   */
  compareTopAnswerItems(frequencies2026, frequencies2025, limit) {

    const items2026 = frequencies2026.items;
    const items2025 = frequencies2025.items;

    const validCount2026 = frequencies2026.validCount;
    const validCount2025 = frequencies2025.validCount;

    const byAnswer2026 = {};
    items2026.forEach(item => { byAnswer2026[item.answer] = item; });

    const byAnswer2025 = {};
    items2025.forEach(item => { byAnswer2025[item.answer] = item; });

    const allAnswers = [];
    const seen = {};

    items2026.forEach(item => {
      if (!seen[item.answer]) {
        seen[item.answer] = true;
        allAnswers.push(item.answer);
      }
    });

    items2025.forEach(item => {
      if (!seen[item.answer]) {
        seen[item.answer] = true;
        allAnswers.push(item.answer);
      }
    });

    const compared = allAnswers.map(answer => {

      const item2026 = byAnswer2026[answer];
      const item2025 = byAnswer2025[answer];

      const count2026 = item2026 ? item2026.count : 0;
      const count2025 = item2025 ? item2025.count : 0;

      const percent2026 = validCount2026 > 0 ? Math.round(count2026 / validCount2026 * 100) : null;
      const percent2025 = validCount2025 > 0 ? Math.round(count2025 / validCount2025 * 100) : null;

      return {
        answer: answer,
        count2026: count2026,
        percent2026: percent2026,
        count2025: count2025,
        percent2025: percent2025,
        delta: (percent2026 !== null && percent2025 !== null)
          ? percent2026 - percent2025
          : null
      };

    });

    const top2026Answers = items2026
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(item => item.answer);

    const top2025Answers = items2025
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(item => item.answer);

    const unionAnswers = {};
    top2026Answers.forEach(answer => { unionAnswers[answer] = true; });
    top2025Answers.forEach(answer => { unionAnswers[answer] = true; });

    return compared
      .filter(item => unionAnswers[item.answer])
      .sort((a, b) => b.count2026 - a.count2026);

  }

};
