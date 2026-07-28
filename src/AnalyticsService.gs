/**
 * ==========================================================
 * Сервис аналитики — сборка всех расчетов
 * ==========================================================
 *
 * Оркестратор. Сам ничего не считает: только вызывает Scoring,
 * MathStats, Norms, Drivers, Segments, Cohort в правильном порядке
 * и складывает результат в один объект, который потом рисует
 * AnalyticsWriter.
 *
 * ПОРЯДОК ВАЖЕН. Каждый шаг опирается на предыдущий:
 *   1. Загрузка и фильтрация      → сырые строки
 *   2. Кодирование в числа        → векторы (нужны всем дальше)
 *   3. Базовые агрегаты           → средние, доли, охват, eNPS
 *   4. Сравнение с прошлым годом  → дельты + значимость
 *   5. Сквозная когорта           → очистка динамики от состава
 *   6. Светофор                   → статусы
 *   7. Корреляции и драйверы      → приоритеты
 *   8. Срезы                      → отклонения
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ. Векторы считаются ОДИН раз и переиспользуются
 * везде. Полный проход по 418 строкам × 42 столбцам — миллисекунды,
 * но при 30 вопросах × 4 разреза × 20 групп наивный пересчет дал бы
 * тысячи проходов и упёрся бы в лимит времени Apps Script.
 */

const AnalyticsService = {

  /**
   * @param {String} sourceYear - '2026'
   * @param {String} previousYear - '2025'
   * @param {Array<Object>} filters - те же фильтры, что в buildReport
   */
  build(sourceYear, previousYear, filters) {

    filters = filters || [];

    // ---------- 1. Данные ----------

    const survey = loadSurveyData(sourceYear, true);
    const headers = survey.headers;
    const rows = FilterEngine.applyFilters(survey.data, headers, filters);

    let previousRows = [];
    let hasPrevious = false;

    try {
      const previousSurvey = loadSurveyData(previousYear, true);
      previousRows = FilterEngine.applyFilters(previousSurvey.data, previousSurvey.headers, filters);
      hasPrevious = true;
    } catch (error) {
      hasPrevious = false;
    }

    const questions = Questions.getAll().filter(q => q.report);

    // ---------- 2. Кодирование ----------

    const vectors = {};
    const previousVectors = {};

    questions.forEach(question => {
      vectors[question.title] = Scoring.vector(rows, headers, question);
      if (hasPrevious) {
        previousVectors[question.title] = Scoring.vector(previousRows, headers, question);
      }
    });

    const enpsQuestion = questions.find(q => q.type === "enps");
    const enpsVector = enpsQuestion ? vectors[enpsQuestion.title] : [];

    // ---------- 3–6. Светофор по каждому вопросу ----------

    const trafficLight = this.trafficLight_(
      questions, vectors, previousVectors, rows, previousRows, headers, hasPrevious
    );

    // ---------- 5. Когорта ----------

    let cohort = null;

    if (hasPrevious) {

      const matched = Cohort.build(rows, previousRows, headers);

      cohort = {
        info: matched,
        enps: Cohort.enpsChange(matched, headers, questions),
        changes: Cohort.changes(matched, headers, questions)
      };

    }

    // ---------- 7. Драйверы ----------

    const drivers = Drivers.build(vectors, questions, enpsVector, rows.length);

    const gaps = Drivers.promoterDetractorGap(vectors, questions, enpsVector);

    const matrix = Drivers.correlationMatrix(vectors, questions, {
      enps: enpsVector,
      burnout: vectors["Выгорание"] || [],
      leave: vectors["Смена работы"] || []
    });

    // ---------- 8. Срезы ----------

    const dimensions = [
      { title: "Формат работы", normalizer: null },
      { title: "Стаж", normalizer: null },
      { title: "Город", normalizer: Segments.cityNormalizer() },
      { title: "Отдел", normalizer: null }
    ];

    const segments = dimensions.map(dimension => Segments.analyze(
      rows, headers, questions, dimension.title,
      {
        normalizer: dimension.normalizer,
        previousRows: hasPrevious ? previousRows : null
      }
    ));

    const composition = hasPrevious
      ? dimensions.map(dimension => ({
          dimension: dimension.title,
          shifts: Segments.compositionShift(rows, previousRows, headers, dimension.title, dimension.normalizer)
            .filter(shift => shift.material)
        })).filter(entry => entry.shifts.length)
      : [];

    return {
      meta: {
        year: sourceYear,
        previousYear: previousYear,
        hasPrevious: hasPrevious,
        n: rows.length,
        nPrevious: previousRows.length,
        filters: filters,
        builtAt: new Date()
      },
      trafficLight: trafficLight,
      cohort: cohort,
      drivers: drivers,
      gaps: gaps,
      correlationMatrix: matrix,
      segments: segments,
      composition: composition
    };

  },

  /**
   * Светофор: для каждого вопроса — уровень, статус, динамика,
   * значимость динамики, охват и связь с eNPS.
   *
   * Ключевая часть — выбор ПРАВИЛЬНОЙ метрики под тип вопроса:
   *   rating5  → среднее (в баллах);
   *   scale4   → доля позитива (в процентах);
   *   риски    → доля негатива (в процентах, направление обратное);
   *   eNPS     → пункты.
   * Сравнивать их между собой можно только через normalizeLevel.
   */
  trafficLight_(questions, vectors, previousVectors, rows, previousRows, headers, hasPrevious) {

    const enpsQuestion = questions.find(q => q.type === "enps");
    const enpsVector = enpsQuestion ? vectors[enpsQuestion.title] : [];

    return questions.map(question => {

      if (question.type === "text" || question.type === "single") return null;

      const vector = vectors[question.title];
      const previousVector = hasPrevious ? previousVectors[question.title] : null;

      const scaleKey = Norms.scaleKeyFor(question);
      const stats = MathStats.describe(vector);

      if (stats.n === 0) return null;

      const entry = {
        question: question.title,
        group: question.group,
        subgroup: question.subgroup,
        type: question.type,
        scaleKey: scaleKey,
        n: stats.n,
        mean: MathStats.round(stats.mean, 2),
        level: MathStats.round(
          Norms.normalizeLevel(stats.mean, Scoring.minFor(question), Scoring.maxFor(question)), 1
        )
      };

      // --- Основной показатель и его динамика ---

      if (question.type === "enps") {

        const valid = vector.filter(v => v !== null);
        const ci = MathStats.enpsConfidence(
          valid.filter(v => v >= 9).length,
          valid.filter(v => v <= 6).length,
          valid.length
        );

        entry.value = MathStats.round(ci.enps, 1);
        entry.margin = MathStats.round(ci.margin, 1);
        entry.unit = "пунктов";

        if (previousVector) {

          const previousValid = previousVector.filter(v => v !== null);
          const previousCi = MathStats.enpsConfidence(
            previousValid.filter(v => v >= 9).length,
            previousValid.filter(v => v <= 6).length,
            previousValid.length
          );

          entry.previous = MathStats.round(previousCi.enps, 1);
          entry.delta = MathStats.round(ci.enps - previousCi.enps, 1);
          entry.significant = MathStats.enpsChangeIsReal(ci, previousCi);
          entry.significanceNote = entry.significant
            ? "изменение выходит за доверительный интервал"
            : "в пределах погрешности (ДИ ±" + entry.margin + "), динамики нет";

        }

      } else if (scaleKey === "burnoutRisk" || scaleKey === "leaveRisk") {

        const bad = vector.filter(v => v !== null && v <= 2).length;
        const valid = stats.n;

        entry.value = MathStats.round(bad / valid * 100, 1);
        entry.unit = "%";

        if (previousVector) {

          const previousValid = previousVector.filter(v => v !== null);
          const previousBad = previousValid.filter(v => v <= 2).length;

          const test = MathStats.zTestProportions(bad, valid, previousBad, previousValid.length);

          entry.previous = MathStats.round(previousBad / previousValid.length * 100, 1);
          entry.delta = MathStats.round(entry.value - entry.previous, 1);
          entry.z = MathStats.round(test.z, 2);
          entry.significant = test.significant;
          entry.significanceNote = test.significant
            ? "значимо (z=" + entry.z + ")"
            : "в пределах погрешности";

        }

        // Группа «затрудняюсь ответить» исключена из value/valid выше
        // (Norms.RISK_DENOMINATOR = "answered"), но не должна пропадать
        // из отчета — см. Norms.uncertainGroupStats.
        entry.uncertainGroup = Norms.uncertainGroupStats(
          Scoring.uncertainMask(rows, headers, question), valid, enpsVector
        );

      } else if (question.type === "rating5") {

        entry.value = entry.mean;
        entry.unit = "балла";

        if (previousVector) {

          const test = MathStats.welchTest(vector, previousVector);

          entry.previous = MathStats.round(test.meanB, 2);
          entry.delta = MathStats.round(test.diff, 2);
          entry.t = MathStats.round(test.t, 2);
          entry.significant = test.significant;
          entry.significanceNote = test.significant
            ? "значимо (t=" + entry.t + ")"
            : "в пределах погрешности";

        }

      } else {

        // scale4 — доля позитива
        const share = Scoring.positiveShare(vector, 3);

        entry.value = MathStats.round(share.percent, 1);
        entry.unit = "%";
        entry.bottomShare = MathStats.round(Scoring.bottomShare(vector, 1).percent, 1);

        if (previousVector) {

          const previousShare = Scoring.positiveShare(previousVector, 3);
          const test = MathStats.zTestProportions(
            share.positive, share.valid, previousShare.positive, previousShare.valid
          );

          entry.previous = MathStats.round(previousShare.percent, 1);
          entry.delta = MathStats.round(entry.value - entry.previous, 1);
          entry.z = MathStats.round(test.z, 2);
          entry.significant = test.significant;
          entry.significanceNote = test.significant
            ? "значимо (z=" + entry.z + ")"
            : "в пределах погрешности";

        }

      }

      // --- Статус ---

      entry.status = Norms.status(entry.value, scaleKey);
      entry.statusExplained = Norms.explain(entry.status, scaleKey);
      entry.color = Norms.COLORS[entry.status];

      // --- Охват ---

      const coverage = Scoring.coverage(rows, headers, question);

      entry.coveragePercent = MathStats.round(coverage.coveredPercent, 1);
      entry.notCovered = coverage.notCovered;

      if (hasPrevious && coverage.coveredPercent !== null) {

        const previousCoverage = Scoring.coverage(previousRows, headers, question);

        if (previousCoverage.coveredPercent !== null) {
          entry.coverageDelta = MathStats.round(
            coverage.coveredPercent - previousCoverage.coveredPercent, 1
          );
        }

      }

      // --- Влияние на eNPS ---

      entry.rEnps = null;

      if (question.type !== "enps") {
        const correlation = MathStats.spearman(vector, enpsVector);
        entry.rEnps = MathStats.round(correlation.r, 3);
      }

      // --- Норма для срезов ---

      entry.normForSegments = entry.value;

      return entry;

    }).filter(entry => entry !== null);

  },

  /**
   * Автоматические наблюдения — то, что стоит вынести в текст отчета.
   *
   * Это не «искусственный интеллект», а набор явных правил. Каждое
   * правило соответствует ошибке, которую иначе совершил бы читатель
   * отчета. Правила намеренно консервативны: лучше промолчать, чем
   * объявить шум находкой.
   */
  findings(analytics) {

    const findings = [];

    // 1. Динамика eNPS: не объявлять то, что внутри погрешности
    const enpsEntry = analytics.trafficLight.find(e => e.type === "enps");

    if (enpsEntry && enpsEntry.delta !== undefined && enpsEntry.delta !== null) {

      if (!enpsEntry.significant) {
        findings.push({
          severity: "info",
          title: "Динамики eNPS нет",
          text: "eNPS " + enpsEntry.value + " против " + enpsEntry.previous + " в прошлом году. " +
            "Разница " + enpsEntry.delta + " укладывается в доверительный интервал ±" + enpsEntry.margin +
            ". Объявлять рост или падение нельзя."
        });
      }

    }

    // 2. Значимые изменения по вопросам
    analytics.trafficLight
      .filter(entry => entry.significant && entry.delta !== undefined && entry.type !== "enps")
      .forEach(entry => {
        findings.push({
          severity: entry.delta < 0 ? "warning" : "info",
          title: (entry.delta < 0 ? "Значимое снижение: " : "Значимый рост: ") + entry.question,
          text: entry.previous + " " + entry.unit + " → " + entry.value + " " + entry.unit +
            " (" + entry.significanceNote + "). " + entry.statusExplained
        });
      });

    // 3. Расхождение общей выборки и когорты — эффект состава
    if (analytics.cohort && analytics.cohort.changes.rows) {

      analytics.cohort.changes.rows
        .filter(row => row.significant)
        .forEach(row => {

          const overall = analytics.trafficLight.find(e => e.question === row.question);

          const hidden = overall && !overall.significant;

          findings.push({
            severity: row.meanDiff < 0 ? "warning" : "info",
            title: "Когорта: " + row.question + " " + (row.meanDiff > 0 ? "+" : "") + row.meanDiff,
            text: row.verdict + " (n=" + row.n + ", t=" + row.t + "). " +
              (hidden ? "По всей выборке это изменение НЕ видно — общая цифра его маскирует." : "Подтверждается и по всей выборке.")
          });

        });

    }

    // 4. Критичные вопросы
    analytics.trafficLight
      .filter(entry => entry.status === Norms.STATUS.CRITICAL)
      .forEach(entry => {
        findings.push({
          severity: "critical",
          title: "Критичный уровень: " + entry.question,
          text: entry.value + " " + entry.unit + ", " + entry.statusExplained +
            (entry.rEnps ? ". Связь с eNPS r=" + entry.rEnps : "")
        });
      });

    // 5. Ножницы: высокая связь с eNPS при падающем охвате
    analytics.trafficLight
      .filter(entry => entry.rEnps !== null && entry.rEnps >= 0.30 &&
                       entry.coverageDelta !== undefined && entry.coverageDelta <= -3)
      .forEach(entry => {
        findings.push({
          severity: "warning",
          title: "Сужается охват сильного драйвера: " + entry.question,
          text: "Оценка " + entry.value + " " + entry.unit + " при связи с eNPS r=" + entry.rEnps +
            ", но охват изменился на " + entry.coverageDelta + " п.п. и составляет " +
            entry.coveragePercent + "%. Оценка считается только по пользующимся и маскирует сужение воронки."
        });
      });

    // 6. Подтвержденные проблемные срезы
    analytics.segments.forEach(dimension => {

      dimension.segments
        .filter(segment => segment.confirmed)
        .slice(0, 5)
        .forEach(segment => {

          const bad = segment.deviations.filter(d => d.bad)
            .map(d => d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1))
            .join(", ");

          findings.push({
            severity: segment.fragile ? "warning" : "critical",
            title: "Срез с отклонениями: " + segment.name + " (" + dimension.dimension + ", n=" + segment.n + ")",
            text: bad + ". " + (segment.fragile
              ? "n<" + Norms.FRAGILE_SEGMENT_SIZE + " — читать как сигнал для точечной проверки, не как факт."
              : "Размер группы достаточен для вывода.")
          });

        });

    });

    // 7. Эффект состава выборки
    analytics.composition.forEach(entry => {

      const text = entry.shifts
        .map(shift => shift.name + " " + shift.sharePercentBefore + "% → " + shift.sharePercentNow + "% (" +
          (shift.shiftPp > 0 ? "+" : "") + shift.shiftPp + " п.п.)")
        .join("; ");

      findings.push({
        severity: "info",
        title: "Сдвиг состава выборки: " + entry.dimension,
        text: text + ". Часть годовой динамики может объясняться этим сдвигом, а не изменением настроений. " +
          "Проверять по сквозной когорте."
      });

    });

    // 8. Группа «затрудняюсь ответить» по риск-вопросам не должна молча
    // исчезать из отчета (см. Norms.RISK_DENOMINATOR). Находка нужна,
    // только если группа заметная по размеру И реально хуже нормы —
    // иначе это будет шум в каждом отчете, поскольку группа есть почти
    // всегда, но обычно она маленькая или ничем не хуже компании.
    const companyEnps = enpsEntry ? enpsEntry.value : null;
    const companyCritics = analytics.segments.length ? analytics.segments[0].company.detractors : null;

    analytics.trafficLight
      .filter(entry => (entry.scaleKey === "burnoutRisk" || entry.scaleKey === "leaveRisk") &&
                       entry.uncertainGroup && entry.uncertainGroup.percent >= 5)
      .forEach(entry => {

        const group = entry.uncertainGroup;

        const criticsDeviation = Norms.deviation(group.criticsPercent, companyCritics, "share", "Критики затруднившихся");
        const enpsDeviation = Norms.deviation(group.enps, companyEnps, "enps", "eNPS затруднившихся");

        const criticsBad = criticsDeviation && criticsDeviation.diff > 0;
        const enpsBad = enpsDeviation && enpsDeviation.diff < 0;

        if (!criticsBad && !enpsBad) return;

        findings.push({
          severity: "warning",
          title: "Затрудняюсь ответить: " + entry.question,
          text: "Группа «затрудняюсь ответить» — " + group.n + " человек (" + group.percent +
            "% от ответивших по шкале и затруднившихся), eNPS " + group.enps +
            ", критиков " + group.criticsPercent + "%. Она исключена из расчета «" + entry.question +
            "» (Norms.RISK_DENOMINATOR = \"answered\") и требует внимания отдельно."
        });

      });

    const order = { critical: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    return findings;

  }

};
