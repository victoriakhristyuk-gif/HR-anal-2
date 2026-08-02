/**
 * ==========================================================
 * Математика: корреляции и проверка значимости
 * ==========================================================
 *
 * Модуль намеренно ничего не знает про вопросы, выборки и отчеты —
 * он работает только с массивами чисел. Это позволяет проверить его
 * отдельно и переиспользовать где угодно.
 *
 * ЗАЧЕМ ВООБЩЕ ЗНАЧИМОСТЬ. Без нее отчет обязательно соврет.
 * При n≈400 случайные колебания дают ±2–3 п.п. на долях. Если каждый
 * год объявлять «выросло на 2 пункта» / «упало на 3 пункта», половина
 * выводов будет про шум. Проверка значимости — это фильтр, который
 * отделяет сигнал от дрожания выборки.
 */

const MathStats = {

  /**
   * Оставить только позиции, где ОБА вектора не null.
   *
   * Обязательный шаг перед любой корреляцией: сравнивать можно только
   * пары ответов одного человека. Если по вопросу «Переговорки»
   * ответили 245 человек, а по eNPS — 418, корреляция считается по
   * тем 245, кто ответил на оба.
   */
  pairwise(a, b) {

    const x = [];
    const y = [];

    for (let i = 0; i < a.length; i++) {
      if (a[i] === null || b[i] === null) continue;
      if (a[i] === undefined || b[i] === undefined) continue;
      x.push(a[i]);
      y.push(b[i]);
    }

    return { x: x, y: y, n: x.length };

  },

  /**
   * Ранги со СРЕДНИМ рангом для связок (ties).
   *
   * Критично для опросных данных: в шкале из 4 делений связок
   * огромное количество (сотни людей с одним и тем же «скорее да»).
   * Если раздать им последовательные ранги вместо среднего,
   * коэффициент получится смещенным.
   *
   * Пример: значения [5, 4, 4, 3] → ранги [1, 2.5, 2.5, 4].
   */
  ranks(values) {

    const indexed = values.map((value, index) => ({ value: value, index: index }));

    indexed.sort((p, q) => p.value - q.value);

    const result = new Array(values.length);

    let i = 0;

    while (i < indexed.length) {

      let j = i;

      while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) {
        j++;
      }

      // Средний ранг для всей группы одинаковых значений.
      // Ранги 1-based, поэтому (i+1 + j+1) / 2.
      const averageRank = (i + j + 2) / 2;

      for (let k = i; k <= j; k++) {
        result[indexed[k].index] = averageRank;
      }

      i = j + 1;

    }

    return result;

  },

  /**
   * Коэффициент корреляции Пирсона.
   */
  pearson(x, y) {

    const n = x.length;

    if (n < 3) return null;

    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
    }

    const meanX = sumX / n;
    const meanY = sumY / n;

    let cov = 0;
    let varX = 0;
    let varY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    if (varX === 0 || varY === 0) return null;

    return cov / Math.sqrt(varX * varY);

  },

  /**
   * Корреляция Спирмена = корреляция Пирсона, посчитанная по рангам.
   *
   * ПОЧЕМУ СПИРМЕН, А НЕ ПИРСОН. Ответы опроса — порядковая шкала:
   * мы знаем, что «да» лучше, чем «скорее да», но не знаем, насколько.
   * Пирсон предполагает, что расстояния между делениями одинаковы,
   * и чувствителен к перекошенным распределениям — а у нас перекос
   * страшный (по половине вопросов 60–70% ответов это «5»).
   * Спирмен смотрит только на порядок и от этого не страдает.
   *
   * ЧТО СЧИТАТЬ ЗАМЕТНЫМ. Для опросных данных при n≈400:
   *   |r| < 0,10  — практически нет связи
   *   0,10–0,25   — слабая
   *   0,25–0,40   — умеренная, уже стоит внимания
   *   > 0,40      — сильная (для опросов это много)
   *
   * ГЛАВНОЕ ПРЕДУПРЕЖДЕНИЕ. Корреляция не причинность. В этих данных
   * «Переговорки» коррелируют с eNPS на 0,385 — но это эффект отбора:
   * вопрос заполняют только офисные сотрудники, а они лояльнее сами
   * по себе. Построенные переговорки eNPS не поднимут. Любой драйвер
   * с ограниченной базой ответов надо помечать как подозрительный
   * (см. Drivers.SELECTION_BIAS_RISK).
   *
   * @returns {Object|null} {r, n}
   */
  spearman(a, b) {

    const pair = this.pairwise(a, b);

    if (pair.n < 30) {
      return { r: null, n: pair.n, reason: "мало наблюдений (n < 30)" };
    }

    const r = this.pearson(this.ranks(pair.x), this.ranks(pair.y));

    return { r: r, n: pair.n };

  },

  /**
   * Среднее и дисперсия по вектору с пропусками.
   */
  describe(vector) {

    const values = vector.filter(v => v !== null && v !== undefined);
    const n = values.length;

    if (n === 0) {
      return { n: 0, mean: null, sd: null, variance: null };
    }

    const mean = values.reduce((s, v) => s + v, 0) / n;

    if (n === 1) {
      return { n: 1, mean: mean, sd: 0, variance: 0 };
    }

    // Несмещенная оценка дисперсии — делим на (n-1), не на n.
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);

    return { n: n, mean: mean, sd: Math.sqrt(variance), variance: variance };

  },

  /**
   * z-критерий для двух независимых долей.
   *
   * КОГДА ПРИМЕНЯТЬ: сравниваем долю позитива по вопросу между
   * двумя годами или между срезом и компанией.
   *
   * ФОРМУЛА:
   *   p = (x1 + x2) / (n1 + n2)                  — общая доля
   *   SE = sqrt( p * (1-p) * (1/n1 + 1/n2) )
   *   z  = (p1 - p2) / SE
   *
   * Значимо при |z| > 1,96 (это p < 0,05, то есть вероятность
   * получить такую разницу случайно меньше 5%).
   *
   * ПРИМЕР ИЗ ДАННЫХ 2026. «Атмосфера в отделе»: 99,2% → 96,7%.
   * Разница всего 2,5 п.п., выглядит пустяком. Но z = −2,51,
   * потому что при доле около 98% дисперсия крошечная — и это
   * единственное статистически значимое падение среди scale4.
   * А «Цели компании» упали на 4,2 п.п. (больше!), но z = −1,56,
   * потому что около 80% дисперсия куда выше. Без этого критерия
   * приоритеты были бы расставлены наоборот.
   */
  zTestProportions(x1, n1, x2, n2) {

    if (!n1 || !n2) return { z: null, significant: false };

    const p1 = x1 / n1;
    const p2 = x2 / n2;
    const p = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));

    if (se === 0) return { z: null, significant: false };

    const z = (p1 - p2) / se;

    return {
      z: z,
      diffPp: (p1 - p2) * 100,
      significant: Math.abs(z) > 1.96,
      strong: Math.abs(z) > 2.58
    };

  },

  /**
   * t-критерий Уэлча для двух независимых средних.
   *
   * КОГДА ПРИМЕНЯТЬ: сравниваем средний балл rating5-вопроса между
   * годами или между срезом и компанией.
   *
   * Уэлч, а не классический Стьюдент, потому что не требует равных
   * дисперсий и одинакового размера групп — а у нас группы всегда
   * разного размера (418 против 382, отдел из 10 против компании).
   *
   * ФОРМУЛА:
   *   SE = sqrt( s1²/n1 + s2²/n2 )
   *   t  = (m1 - m2) / SE
   *
   * При n больше 30 в каждой группе t сравнивается с 1,96 напрямую,
   * без возни со степенями свободы: разница с точным значением
   * в третьем знаке и на выводы не влияет.
   */
  welchTest(vectorA, vectorB) {
    return this.welchTestFromStats(this.describe(vectorA), this.describe(vectorB));
  },

  /**
   * То же самое, что welchTest, но принимает уже посчитанные {mean,
   * variance, n} вместо сырых векторов — для мест, где сохранять
   * векторы ответов ради одного теста избыточно (например,
   * ReportBuilder.buildDramaticChangesInput_, где уже есть готовые
   * mean/count по каждому году из Statistics.calculateAverageRatings).
   */
  welchTestFromStats(a, b) {

    if (!a || !b || a.n < 2 || b.n < 2) return { t: null, significant: false };

    const se = Math.sqrt(a.variance / a.n + b.variance / b.n);

    if (se === 0) return { t: null, significant: false };

    const t = (a.mean - b.mean) / se;

    return {
      t: t,
      diff: a.mean - b.mean,
      meanA: a.mean,
      meanB: b.mean,
      nA: a.n,
      nB: b.n,
      significant: Math.abs(t) > 1.96,
      strong: Math.abs(t) > 2.58
    };

  },

  /**
   * Парный t-критерий — для сквозной когорты.
   *
   * САМЫЙ ЧЕСТНЫЙ ИНСТРУМЕНТ ГОДОВОЙ ДИНАМИКИ. Обычное сравнение
   * годов путает два эффекта: реальное изменение настроений и смену
   * состава респондентов. Если в этом году ответило на 36 человек
   * больше и среди них выросла доля удаленщиков — часть «динамики»
   * объясняется просто другим составом.
   *
   * Парный тест берет только тех, кто ответил ОБА года, и смотрит
   * на разницу внутри каждого человека. Состав по определению
   * одинаковый, поэтому остается только настоящее изменение.
   *
   * ФОРМУЛА:
   *   d_i = x_i(2026) - x_i(2025)  — разность у каждого человека
   *   SE  = sd(d) / sqrt(n)
   *   t   = mean(d) / SE
   *
   * ПРИМЕР ИЗ ДАННЫХ 2026. По компании выгорание улучшилось с 22,0%
   * до 16,5%, z = −1,97, формально значимо. Но на когорте из 142
   * человек изменение +0,008 балла, то есть НОЛЬ. Вывод: улучшение
   * почти целиком композиционное. А «Корпоративы», наоборот, по всей
   * выборке просели незначимо (−0,09), но на когорте −0,21 при
   * t = −2,07 — это настоящее падение у одних и тех же людей.
   *
   * @param {Array<Number|null>} after
   * @param {Array<Number|null>} before - той же длины, тот же человек
   */
  pairedTest(after, before) {

    const diffs = [];

    for (let i = 0; i < after.length; i++) {
      if (after[i] === null || before[i] === null) continue;
      if (after[i] === undefined || before[i] === undefined) continue;
      diffs.push(after[i] - before[i]);
    }

    const stats = this.describe(diffs);

    if (stats.n < 10) {
      return { t: null, n: stats.n, significant: false, reason: "когорта меньше 10 человек" };
    }

    const se = stats.sd / Math.sqrt(stats.n);

    if (se === 0) {
      return { t: null, n: stats.n, meanDiff: 0, significant: false };
    }

    const t = stats.mean / se;

    return {
      t: t,
      n: stats.n,
      meanDiff: stats.mean,
      up: diffs.filter(d => d > 0).length,
      down: diffs.filter(d => d < 0).length,
      same: diffs.filter(d => d === 0).length,
      significant: Math.abs(t) > 1.96,
      strong: Math.abs(t) > 2.58
    };

  },

  /**
   * Доверительный интервал eNPS.
   *
   * eNPS = %промоутеров − %критиков. Это разность двух долей одной
   * мультиномиальной выборки, и у нее своя дисперсия — не такая, как
   * у обычной доли:
   *
   *   Var = (p + d) − (p − d)²        где p и d — доли в долях единицы
   *   SE  = sqrt(Var / n)
   *   ДИ  = eNPS ± 1,96 × SE × 100
   *
   * ЗАЧЕМ ЭТО НУЖНО. eNPS 2026 = +55,7 ± 5,9, eNPS 2025 = +58,6 ± 6,1.
   * Интервалы перекрываются почти полностью — значит, разница
   * в 2,9 пункта НЕ является падением, это шум. Без интервала отчет
   * объявил бы снижение лояльности, которого нет.
   *
   * И обратная сторона: у отдела из 10 человек интервал получается
   * ±30 пунктов. Изменение eNPS отдела с +50 до +10 при таком n
   * статистически неотличимо от случайности. Такие отделы можно
   * подсвечивать как сигнал, но нельзя объявлять фактом.
   */
  enpsConfidence(promoters, detractors, total) {

    if (!total) return { enps: null, margin: null };

    const p = promoters / total;
    const d = detractors / total;
    const variance = (p + d) - Math.pow(p - d, 2);

    return {
      enps: (p - d) * 100,
      margin: 1.96 * Math.sqrt(variance / total) * 100,
      n: total
    };

  },

  /**
   * Перекрываются ли доверительные интервалы двух eNPS.
   * Если да — говорить о динамике нельзя.
   *
   * Порог — совместная ошибка двух независимых интервалов
   * (sqrt(marginA² + marginB²)), а не (marginA + marginB) — точная
   * формула, а не приближение "к sqrt(2)", которое было верно только
   * при marginA ≈ marginB и занижало порог при сильно разных выборках.
   */
  enpsChangeIsReal(ciA, ciB) {

    if (ciA.enps === null || ciB.enps === null) return null;

    const gap = Math.abs(ciA.enps - ciB.enps);
    const jointMargin = Math.sqrt(ciA.margin * ciA.margin + ciB.margin * ciB.margin);

    return gap > jointMargin;

  },

  round(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return null;
    const k = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(value * k) / k;
  }

};
