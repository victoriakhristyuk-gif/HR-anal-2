/**
 * ==========================================================
 * Драйверы и матрица приоритетов
 * ==========================================================
 *
 * ОТВЕЧАЕТ НА ВОПРОС «за что браться первым». Светофор показывает,
 * где плохо. Но «плохо» не равно «важно»: мерч за достижения — худшая
 * оценка опроса (4,06), а связь с лояльностью у него слабая (0,232).
 * Вкладываться в него бессмысленно.
 *
 * ЛОГИКА В ДВА ИЗМЕРЕНИЯ:
 *   ось X — ВЛИЯНИЕ: корреляция вопроса с eNPS;
 *   ось Y — УРОВЕНЬ: где показатель стоит, приведенный к 0–100.
 *
 * Четыре квадранта:
 *   низкий уровень + высокое влияние → ЧИНИТЬ ПЕРВЫМ (максимум отдачи)
 *   высокий уровень + высокое влияние → ДЕРЖАТЬ (это опора, не сломать)
 *   низкий уровень + низкое влияние  → СЛЕДИТЬ (само по себе не тянет)
 *   высокий уровень + низкое влияние → ОК (не трогать)
 *
 * Границы квадрантов — не жесткие цифры, а МЕДИАНА влияния и СРЕДНИЙ
 * уровень по всем вопросам текущего года. Это делает матрицу
 * самонастраивающейся: она всегда показывает относительные приоритеты
 * внутри года, а не сравнение с чужим бенчмарком.
 */

const Drivers = {

  QUADRANT: {
    FIX_FIRST: "ЧИНИТЬ ПЕРВЫМ",
    KEEP: "ДЕРЖАТЬ",
    WATCH: "СЛЕДИТЬ",
    OK: "ОК"
  },

  /**
   * Вопросы, у которых высокая корреляция с eNPS почти наверняка
   * является ЭФФЕКТОМ ОТБОРА, а не причинной связью.
   *
   * Механика: на эти вопросы отвечают не все. «Переговорки» оценивают
   * только те, кто бывает в офисе; «Корпоративы» — только те, кто на
   * них ходит. Такие сотрудники вовлеченнее по определению, поэтому
   * корреляция ловит не «переговорки повышают лояльность», а
   * «лояльные чаще бывают в офисе».
   *
   * Признак, по которому это ловится автоматически: база ответов
   * заметно меньше общего размера выборки (см. SELECTION_BIAS_COVERAGE).
   */
  SELECTION_BIAS_COVERAGE: 0.80,

  /**
   * Построить таблицу драйверов.
   *
   * @param {Object} vectors - {заголовок вопроса: числовой вектор}
   * @param {Array<Object>} questions
   * @param {Array<Number|null>} enpsVector
   * @param {Number} sampleSize
   */
  build(vectors, questions, enpsVector, sampleSize) {

    const rows = [];

    questions.forEach(question => {

      if (question.type === "enps" || question.type === "text") return;

      const vector = vectors[question.title];

      if (!vector) return;

      const correlation = MathStats.spearman(vector, enpsVector);
      const stats = MathStats.describe(vector);

      if (stats.n === 0) return;

      const level = Norms.normalizeLevel(
        stats.mean,
        Scoring.minFor(question),
        Scoring.maxFor(question)
      );

      const coverageRatio = sampleSize ? stats.n / sampleSize : 1;

      rows.push({
        question: question.title,
        group: question.group,
        type: question.type,
        mean: MathStats.round(stats.mean, 2),
        level: MathStats.round(level, 1),
        r: MathStats.round(correlation.r, 3),
        n: correlation.n,
        coverageRatio: MathStats.round(coverageRatio, 2),
        selectionBiasRisk: coverageRatio < this.SELECTION_BIAS_COVERAGE
      });

    });

    const impactCut = this.median_(rows.map(row => row.r).filter(v => v !== null));
    const levelCut = this.mean_(rows.map(row => row.level).filter(v => v !== null));

    rows.forEach(row => {
      row.quadrant = this.quadrant_(row, impactCut, levelCut);
      row.note = this.note_(row, impactCut, levelCut);
    });

    // Сначала то, что чинить первым, внутри — от самого низкого уровня.
    const order = [this.QUADRANT.FIX_FIRST, this.QUADRANT.WATCH, this.QUADRANT.KEEP, this.QUADRANT.OK];

    rows.sort((a, b) => {
      const byQuadrant = order.indexOf(a.quadrant) - order.indexOf(b.quadrant);
      if (byQuadrant !== 0) return byQuadrant;
      return (a.level || 0) - (b.level || 0);
    });

    return {
      rows: rows,
      impactCut: MathStats.round(impactCut, 3),
      levelCut: MathStats.round(levelCut, 1)
    };

  },

  quadrant_(row, impactCut, levelCut) {

    if (row.r === null || row.level === null) return this.QUADRANT.WATCH;

    const highImpact = row.r >= impactCut;
    const lowLevel = row.level < levelCut;

    if (lowLevel && highImpact) return this.QUADRANT.FIX_FIRST;
    if (!lowLevel && highImpact) return this.QUADRANT.KEEP;
    if (lowLevel) return this.QUADRANT.WATCH;

    return this.QUADRANT.OK;

  },

  note_(row, impactCut, levelCut) {

    const notes = [];

    if (row.selectionBiasRisk && row.r !== null && row.r >= impactCut) {
      notes.push("ОСТОРОЖНО: отвечали только " + Math.round(row.coverageRatio * 100) +
        "% выборки — высокая корреляция может быть эффектом отбора, а не причиной");
    }

    // Вопрос с очень низким уровнем попадает в приоритет даже при
    // влиянии чуть ниже медианы: абсолютная слабость сама по себе
    // является поводом. Иначе худший вопрос опроса может выпасть
    // из приоритетов только потому, что не дотянул до медианы r.
    if (row.quadrant === this.QUADRANT.WATCH && row.level !== null && row.level < levelCut - 8) {
      notes.push("уровень заметно ниже среднего по компании — поднять в приоритет вручную");
    }

    return notes.join(". ");

  },

  /**
   * Разрыв между промоутерами и критиками по каждому вопросу.
   *
   * ДОПОЛНЯЕТ КОРРЕЛЯЦИЮ, а не дублирует. Корреляция описывает связь
   * по всей выборке; разрыв показывает, чем конкретно недовольные
   * отличаются от довольных. Иногда они расходятся: у «Целей компании»
   * корреляция средняя (0,277), но разрыв большой (0,89 балла) —
   * потому что провал сосредоточен именно в группе критиков, а среди
   * остальных вопрос ровный. Такие вещи корреляция размывает.
   *
   * Читается прямо: «критики ставят целям компании 2,39 из 4,
   * промоутеры 3,28».
   */
  promoterDetractorGap(vectors, questions, enpsVector) {

    const isPromoter = enpsVector.map(v => Scoring.enpsCategory(v) === "promoters");
    const isDetractor = enpsVector.map(v => Scoring.enpsCategory(v) === "detractors");

    return questions
      .filter(q => q.type !== "enps" && q.type !== "text")
      .map(question => {

        const vector = vectors[question.title];

        if (!vector) return null;

        const promoters = vector.filter((v, i) => isPromoter[i]);
        const detractors = vector.filter((v, i) => isDetractor[i]);

        const p = MathStats.describe(promoters);
        const d = MathStats.describe(detractors);

        if (p.mean === null || d.mean === null) return null;

        return {
          question: question.title,
          promoterMean: MathStats.round(p.mean, 2),
          detractorMean: MathStats.round(d.mean, 2),
          gap: MathStats.round(p.mean - d.mean, 2),
          nPromoters: p.n,
          nDetractors: d.n,
          // При малом числе критиков разрыв неустойчив.
          fragile: d.n < 20
        };

      })
      .filter(row => row !== null)
      .sort((a, b) => b.gap - a.gap);

  },

  /**
   * Корреляционная матрица «каждый вопрос против ключевых целей».
   *
   * Целей три, и они образуют единый контур риска:
   *   eNPS ← лояльность
   *   Выгорание ← состояние
   *   Смена работы ← намерение уйти
   *
   * Смотреть надо все три сразу. Показатель, который тянет только
   * eNPS, — это про имидж. Показатель, который тянет выгорание и
   * намерение уйти, — это про удержание, и он дороже.
   */
  correlationMatrix(vectors, questions, targets) {

    return questions
      .filter(q => q.type !== "text")
      .map(question => {

        const vector = vectors[question.title];

        if (!vector) return null;

        const row = { question: question.title, group: question.group };

        Object.keys(targets).forEach(key => {

          if (targets[key] === vector) {
            row[key] = null;
            return;
          }

          const c = MathStats.spearman(vector, targets[key]);
          row[key] = MathStats.round(c.r, 3);
          row[key + "_n"] = c.n;

        });

        return row;

      })
      .filter(row => row !== null);

  },

  median_(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  mean_(values) {
    if (!values.length) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

};
