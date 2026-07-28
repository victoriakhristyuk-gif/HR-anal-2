/**
 * ==========================================================
 * Срезы и поиск отклонений
 * ==========================================================
 *
 * ЗАЧЕМ. Общая цифра по компании почти всегда врет в обе стороны.
 * Выгорание 16,5% выглядит терпимо — но за ним прячутся Набережные
 * Челны с 40,9% и три отдела с 35–40%. Это примерно 78 человек
 * с двойной нормой, полностью замаскированных средним.
 *
 * ПРИНЦИП. Норма — это НЕ абстрактное «хорошо», а показатель самой
 * компании за текущий год. Каждый срез сравнивается с ней, и в отчет
 * попадает только то, что вышло за DEVIATION-пороги. Отчет, который
 * печатает все срезы подряд, никто не читает; отчет, который печатает
 * только отклонения, читают.
 *
 * ЗАЩИТА ОТ ЛОЖНЫХ НАХОДОК. Чем мельче срез, тем легче случайно
 * получить «отклонение». Поэтому:
 *   – группы меньше MIN_SEGMENT_SIZE не показываются вообще;
 *   – группы меньше FRAGILE_SEGMENT_SIZE помечаются как сигнал;
 *   – при переборе десятков срезов часть «находок» случайна по
 *     определению (проблема множественных сравнений) — поэтому срез
 *     считается настоящим, только если отклонений НЕСКОЛЬКО и они
 *     согласованы между собой.
 */

const Segments = {

  /**
   * Показатели, по которым срезы сравниваются с нормой.
   * Порядок задает порядок колонок в отчете.
   */
  METRICS: [
    { key: "enps",        label: "eNPS",                    kind: "enps",   goodDirection: "up" },
    { key: "detractors",  label: "Критики, %",              kind: "share",  goodDirection: "down" },
    { key: "burnoutRisk", label: "Выгорание рег./пост., %", kind: "share",  goodDirection: "down" },
    { key: "leaveRisk",   label: "Думают об уходе, %",      kind: "share",  goodDirection: "down" }
  ],

  /**
   * Разбить выборку по значению одного профильного вопроса.
   *
   * @param {Array<Array>} rows
   * @param {Array<String>} headers
   * @param {String} questionTitle - «Отдел», «Стаж», «Город», «Формат работы»
   * @param {Function} [normalizer] - приведение значения к группе
   * @returns {Object} {значение: массив строк}
   */
  splitBy(rows, headers, questionTitle, normalizer) {

    const target = String(questionTitle).trim().toLowerCase();
    const columnIndex = headers.findIndex(h => String(h).trim().toLowerCase() === target);

    if (columnIndex === -1) return {};

    const buckets = {};

    rows.forEach(row => {

      let value = row[columnIndex];

      if (value === "" || value === null || value === undefined) return;

      value = normalizer ? normalizer(String(value).trim()) : String(value).trim();

      if (!value) return;

      if (!buckets[value]) buckets[value] = [];

      buckets[value].push(row);

    });

    return buckets;

  },

  /**
   * Нормализатор для свободного текстового поля «Город».
   *
   * В данных 2026 поле заполнялось вручную: 66 вариантов написания,
   * включая «Ростов-на-Дону» и «Ростов на Дону» по отдельности,
   * «удалённо», «перемещаюсь» и четыре ответа «-». Без склейки
   * получается 60 групп по одному человеку, из которых ни одна
   * не проходит MIN_SEGMENT_SIZE, и география выпадает из анализа
   * целиком.
   *
   * ПРАВИЛЬНОЕ РЕШЕНИЕ — закрытый список в анкете на следующий год.
   * Пока его нет, работает эта склейка.
   */
  cityNormalizer(majorCities) {

    const major = majorCities || [
      "Курган", "Санкт-Петербург", "Тюмень", "Набережные Челны",
      "Екатеринбург", "Казань", "Челябинск", "Москва"
    ];

    const majorLower = major.map(c => c.toLowerCase());

    return function (value) {

      const lower = value.toLowerCase();
      const index = majorLower.indexOf(lower);

      if (index !== -1) return major[index];

      if (/удал|перемещ/i.test(value)) return "Удалённо (город не указан)";
      if (value === "-" || value === "—" || /^друго/i.test(value)) return "Не указан";

      return "Прочие города";

    };

  },

  /**
   * Показатели одной группы.
   */
  metricsFor(rows, headers, questions) {

    const byTitle = {};
    questions.forEach(q => { byTitle[q.title] = q; });

    const enpsQuestion = questions.find(q => q.type === "enps");
    const burnoutQuestion = byTitle["Выгорание"];
    const leaveQuestion = byTitle["Смена работы"];

    const result = { n: rows.length };

    if (enpsQuestion) {

      const vector = Scoring.vector(rows, headers, enpsQuestion);
      const valid = vector.filter(v => v !== null);
      const promoters = valid.filter(v => v >= 9).length;
      const detractors = valid.filter(v => v <= 6).length;

      const ci = MathStats.enpsConfidence(promoters, detractors, valid.length);

      result.enps = MathStats.round(ci.enps, 1);
      result.enpsMargin = MathStats.round(ci.margin, 1);
      result.detractors = valid.length ? MathStats.round(detractors / valid.length * 100, 1) : null;
      result.enpsBase = valid.length;

    }

    if (burnoutQuestion) {
      result.burnoutRisk = this.riskShare_(rows, headers, burnoutQuestion, 2);
    }

    if (leaveQuestion) {
      result.leaveRisk = this.riskShare_(rows, headers, leaveQuestion, 2);
    }

    // Средние по всем шкальным вопросам — для точечных отклонений.
    result.means = {};

    questions.forEach(question => {

      if (question.type === "text" || question.type === "single" || question.type === "enps") return;

      const stats = MathStats.describe(Scoring.vector(rows, headers, question));

      if (stats.n > 0) {
        result.means[question.title] = { mean: MathStats.round(stats.mean, 2), n: stats.n };
      }

    });

    return result;

  },

  /**
   * Доля «плохих» ответов: балл не выше порога.
   * Шкалы приведены к «больше = лучше», поэтому риск — это низ шкалы.
   */
  riskShare_(rows, headers, question, maxBadScore) {

    const vector = Scoring.vector(rows, headers, question);
    const valid = vector.filter(v => v !== null);

    if (!valid.length) return null;

    return MathStats.round(valid.filter(v => v <= maxBadScore).length / valid.length * 100, 1);

  },

  /**
   * Полный анализ одного разреза: все группы + их отклонения от нормы.
   *
   * @param {Array<Array>} rows - вся выборка (она же норма)
   * @param {Array<String>} headers
   * @param {Array<Object>} questions
   * @param {String} dimension - по какому вопросу режем
   * @param {Object} options - {normalizer, previousRows, keyQuestions}
   */
  analyze(rows, headers, questions, dimension, options) {

    options = options || {};

    const company = this.metricsFor(rows, headers, questions);
    const buckets = this.splitBy(rows, headers, dimension, options.normalizer);

    const previousBuckets = options.previousRows
      ? this.splitBy(options.previousRows, headers, dimension, options.normalizer)
      : {};

    // Вопросы, по которым ищем точечные отклонения средних.
    // Прогонять все 30 бессмысленно: отчет утонет. Берем ключевые.
    const keyQuestions = options.keyQuestions || ["ЗП", "Задачи 2", "Возможности роста", "Цели компании", "ОС от руководителя"];

    const segments = [];

    Object.keys(buckets).forEach(name => {

      const group = buckets[name];

      if (group.length < Norms.MIN_SEGMENT_SIZE) return;

      const metrics = this.metricsFor(group, headers, questions);
      const deviations = [];

      // 1. Отклонения по риск-метрикам и eNPS
      this.METRICS.forEach(metric => {

        const deviation = Norms.deviation(
          metrics[metric.key],
          company[metric.key],
          metric.kind,
          metric.label
        );

        if (!deviation) return;

        const isBad = metric.goodDirection === "up"
          ? deviation.diff < 0
          : deviation.diff > 0;

        deviation.bad = isBad;
        deviations.push(deviation);

      });

      // 2. Точечные отклонения средних по ключевым вопросам
      keyQuestions.forEach(title => {

        const segmentMean = metrics.means[title] ? metrics.means[title].mean : null;
        const companyMean = company.means[title] ? company.means[title].mean : null;

        const deviation = Norms.deviation(segmentMean, companyMean, "rating", title);

        if (!deviation) return;

        deviation.bad = deviation.diff < 0;
        deviations.push(deviation);

      });

      // 3. Динамика к прошлому году — только если обе базы достаточны
      let yearDelta = null;
      const previousGroup = previousBuckets[name];

      if (previousGroup && previousGroup.length >= Norms.MIN_SEGMENT_SIZE) {

        const previousMetrics = this.metricsFor(previousGroup, headers, questions);

        if (previousMetrics.enps !== null && metrics.enps !== null) {

          const delta = metrics.enps - previousMetrics.enps;

          yearDelta = {
            previous: previousMetrics.enps,
            previousN: previousGroup.length,
            delta: MathStats.round(delta, 1),
            // Изменение считается заметным, только если превышает
            // сумму половин доверительных интервалов обоих годов.
            meaningful: Math.abs(delta) > (metrics.enpsMargin + previousMetrics.enpsMargin) / 2
          };

        }

      }

      segments.push({
        dimension: dimension,
        name: name,
        n: group.length,
        metrics: metrics,
        deviations: deviations,
        badCount: deviations.filter(d => d.bad).length,
        yearDelta: yearDelta,
        fragile: group.length < Norms.FRAGILE_SEGMENT_SIZE,
        // Срез считается настоящей проблемой, только если плохих
        // отклонений НЕСКОЛЬКО. Одно отклонение при переборе десятков
        // групп — ожидаемая случайность, а не находка.
        confirmed: deviations.filter(d => d.bad).length >= 2
      });

    });

    segments.sort((a, b) => {
      if (b.badCount !== a.badCount) return b.badCount - a.badCount;
      return (a.metrics.enps || 0) - (b.metrics.enps || 0);
    });

    return { dimension: dimension, company: company, segments: segments };

  },

  /**
   * Проверка на эффект состава выборки.
   *
   * ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ПЕРЕД ЛЮБЫМ ВЫВОДОМ О ДИНАМИКЕ.
   * Если между годами заметно изменилась структура респондентов,
   * часть «динамики» объясняется составом, а не настроениями.
   *
   * В данных 2026: доля удаленных выросла с 37,4% до 41,4%, офисных
   * упала с 29,6% до 24,6%. Офисные при этом лояльнее (eNPS +61
   * против +54). Значит, часть снижения общего eNPS — арифметика
   * состава, а не ухудшение отношения.
   */
  compositionShift(rowsNow, rowsBefore, headers, dimension, normalizer) {

    const now = this.splitBy(rowsNow, headers, dimension, normalizer);
    const before = this.splitBy(rowsBefore, headers, dimension, normalizer);

    const names = {};
    Object.keys(now).forEach(k => { names[k] = true; });
    Object.keys(before).forEach(k => { names[k] = true; });

    return Object.keys(names).map(name => {

      const shareNow = (now[name] ? now[name].length : 0) / rowsNow.length * 100;
      const shareBefore = (before[name] ? before[name].length : 0) / rowsBefore.length * 100;

      return {
        name: name,
        sharePercentNow: MathStats.round(shareNow, 1),
        sharePercentBefore: MathStats.round(shareBefore, 1),
        shiftPp: MathStats.round(shareNow - shareBefore, 1),
        // Сдвиг больше 3 п.п. уже способен заметно двигать общие цифры.
        material: Math.abs(shareNow - shareBefore) >= 3
      };

    }).sort((a, b) => Math.abs(b.shiftPp) - Math.abs(a.shiftPp));

  }

};
