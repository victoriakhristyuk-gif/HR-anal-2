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

  // Кэш company-wide (без фильтров) сборки на время одного выполнения
  // скрипта — только для buildCached_ ниже. Публичный build() его не
  // трогает и всегда считает заново (нужен AnalyticsWriter с любыми
  // фильтрами). Ключ — "sourceYear|previousYear".
  _cache_: {},

  /**
   * Company-wide (без фильтров) аналитика, посчитанная не более одного
   * раза за выполнение скрипта. Нужна SegmentContext: BatchReports может
   * вызвать buildReport в цикле по десятку значений одного фильтра, и
   * без кэша company-wide срезы (векторизация + 8 измерений) пересчитывались
   * бы заново на каждой итерации ради одного и того же неотфильтрованного
   * результата.
   */
  buildCached_(sourceYear, previousYear) {

    const key = sourceYear + "|" + previousYear;

    if (!this._cache_[key]) {
      this._cache_[key] = this.build(sourceYear, previousYear, []);
    }

    return this._cache_[key];

  },

  /**
   * @param {String} sourceYear - '2026'
   * @param {String} previousYear - '2025'
   * @param {Array<Object>} filters - те же фильтры, что в buildReport
   */
  build(sourceYear, previousYear, filters) {

    filters = filters || [];

    // ---------- 1. Данные ----------

    const survey = loadEnrichedSurveyData_(sourceYear, true);
    const headers = survey.headers;
    const rows = FilterEngine.applyFilters(survey.data, headers, filters, sourceYear);

    let previousRows = [];
    let previousHeaders = headers;
    let hasPrevious = false;

    try {
      const previousSurvey = loadEnrichedSurveyData_(previousYear, true);
      previousHeaders = previousSurvey.headers;
      previousRows = FilterEngine.applyFilters(previousSurvey.data, previousHeaders, filters, previousYear);
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
        previousVectors[question.title] = Scoring.vector(previousRows, previousHeaders, question);
      }
    });

    const enpsQuestion = questions.find(q => q.type === "enps");
    const enpsVector = enpsQuestion ? vectors[enpsQuestion.title] : [];

    // ---------- 3–6. Светофор по каждому вопросу ----------

    // Численность выбирается отдельно для каждого года. Процент явки
    // считается только для выборок без фильтров либо с фильтрами по
    // отделу/управлению/группе команд: для прочих признаков знаменателя
    // на листе нет. Те же scope дают N для поправки на конечную
    // совокупность (FPC, см. MathStats.finitePopulationCorrection) в
    // светофоре ниже — populationSize не передается, если scope не
    // поддержан (текущий набор фильтров не сводится к одному отделу/
    // управлению/группе команд), тогда FPC не применяется.
    const headcountScope = Headcount.invitedForFilters(sourceYear, filters);
    const previousHeadcountScope = Headcount.invitedForFilters(previousYear, filters);
    const includeHeadcount = headcountScope.supported && Headcount.hasYear(sourceYear);
    const includePreviousHeadcount = hasPrevious && previousHeadcountScope.supported &&
      Headcount.hasYear(previousYear);

    const trafficLight = this.trafficLight_(
      questions, vectors, previousVectors, rows, previousRows, headers, previousHeaders, hasPrevious,
      includeHeadcount ? headcountScope.count : null,
      includePreviousHeadcount ? previousHeadcountScope.count : null
    );

    // ---------- 5. Когорта ----------

    let cohort = null;

    if (hasPrevious) {

      const matched = Cohort.build(rows, previousRows, headers, previousHeaders);

      cohort = {
        info: matched,
        enps: Cohort.enpsChange(matched, headers, previousHeaders, questions),
        changes: Cohort.changes(matched, headers, previousHeaders, questions)
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
      { title: "Отдел", normalizer: null },
      { title: "Управление", normalizer: null },
      { title: "Группа команд", normalizer: null }
    ];

    // "Соответствие ожиданиям" и "Grade" существуют только в 2026
    // (обогащение справочником "перформанс" — см. PerformanceDirectory.gs).
    // Срезы добавляются только для отчета за 2026 и ВСЕГДА без
    // прошлогодних строк (noHistory), даже если для остальных срезов
    // hasPrevious=true: подставлять сюда 2025 нельзя — признаков там нет.
    // Знаменатель для "Соответствие ожиданиям"/"Грейд" — не из справочника
    // численности (Headcount.gs), а из самого справочника "перформанс":
    // все сотрудники с заполненным полем, независимо от участия в опросе
    // (см. PerformanceDirectory.countsForFilters).
    if (sourceYear === "2026") {
      const expectationsScope = PerformanceDirectory.countsForFilters(
        PerformanceDirectory.COLUMNS.EXPECTATIONS, filters
      );
      const gradeScope = PerformanceDirectory.countsForFilters(
        PerformanceDirectory.COLUMNS.GRADE, filters
      );

      dimensions.push(
        { title: "Соответствие ожиданиям", normalizer: null, noHistory: true, performanceScope: expectationsScope },
        { title: "Грейд", normalizer: null, noHistory: true, performanceScope: gradeScope },
        { title: "Роль в отделе", normalizer: null, noHistory: true }
      );
    }

    const segments = dimensions.map(dimension => Object.assign(
      Segments.analyze(
        rows, headers, questions, dimension.title,
        {
          normalizer: dimension.normalizer,
          previousRows: dimension.noHistory ? null : (hasPrevious ? previousRows : null),
          previousHeaders: previousHeaders,
          year: sourceYear,
          previousYear: previousYear,
          headcountTotal: headcountScope.count,
          previousHeadcountTotal: previousHeadcountScope.count,
          includeHeadcount: includeHeadcount &&
            (dimension.title === "Отдел" || dimension.title === "Управление" || dimension.title === "Группа команд"),
          includePreviousHeadcount: !dimension.noHistory && includePreviousHeadcount &&
            (dimension.title === "Отдел" || dimension.title === "Управление" || dimension.title === "Группа команд"),
          performanceDimension: !!(dimension.performanceScope && dimension.performanceScope.supported),
          performanceTotal: dimension.performanceScope && dimension.performanceScope.supported
            ? dimension.performanceScope.total : null
        }
      ),
      { noHistory: !!dimension.noHistory }
    ));

    // compositionShift сравнивает состав среза год-к-году — бессмысленно
    // и некорректно для срезов, которых в 2025 не существует.
    const composition = hasPrevious
      ? dimensions.filter(dimension => !dimension.noHistory).map(dimension => ({
          dimension: dimension.title,
          shifts: Segments.compositionShift(
            rows, previousRows, headers, previousHeaders, dimension.title, dimension.normalizer,
            sourceYear, previousYear
          )
            .filter(shift => shift.material)
        })).filter(entry => entry.shifts.length)
      : [];

    // ---------- 9. Связи между срезами перформанса ----------

    // Как и сами срезы "Соответствие ожиданиям"/"Грейд"/"Роль в отделе"
    // (см. dimensions выше), связи между ними считаются только для 2026 —
    // признаков нет в данных 2025 (см. CrossSegments.gs).
    const crossSegments = sourceYear === "2026"
      ? CrossSegments.analyzeAll(rows, headers, questions)
      : [];

    // Сводка листа "Связи срезов" (общие показатели компании, сравнение
    // по грейдам/эффективности, матрица, вопросы с наибольшими различиями,
    // выводы по группам) — как и crossSegments, только для 2026.
    const crossSegmentsOverview = sourceYear === "2026"
      ? CrossSegments.overview(rows, headers, questions, segments)
      : null;

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
      composition: composition,
      crossSegments: crossSegments,
      crossSegmentsOverview: crossSegmentsOverview
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
  trafficLight_(questions, vectors, previousVectors, rows, previousRows, headers, previousHeaders, hasPrevious,
    populationSize, previousPopulationSize) {

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
        // Штат текущего фильтра (см. build(): headcountScope) — нужен,
        // чтобы отличить "n мал, потому что фильтр сузился до маленького,
        // но ПОЛНОСТЬЮ опрошенного отдела" от настоящей малой выборки
        // (см. AnalyticsWriter.writeTrafficLight_).
        populationSize: populationSize || null,
        mean: MathStats.round(stats.mean, 2),
        level: MathStats.round(
          Norms.normalizeLevel(stats.mean, Scoring.minFor(question), Scoring.maxFor(question)), 1
        )
      };

      // --- Основной показатель и его динамика ---

      if (question.type === "enps") {

        const valid = vector.filter(v => v !== null);
        const ci = MathStats.enpsConfidence(
          valid.filter(v => Scoring.enpsCategory(v) === "promoters").length,
          valid.filter(v => Scoring.enpsCategory(v) === "detractors").length,
          valid.length,
          populationSize
        );

        entry.value = MathStats.round(ci.enps, 1);
        entry.margin = MathStats.round(ci.margin, 1);
        entry.unit = "пунктов";

        if (previousVector) {

          const previousValid = previousVector.filter(v => v !== null);
          const previousCi = MathStats.enpsConfidence(
            previousValid.filter(v => Scoring.enpsCategory(v) === "promoters").length,
            previousValid.filter(v => Scoring.enpsCategory(v) === "detractors").length,
            previousValid.length,
            previousPopulationSize
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

          const test = MathStats.zTestProportions(
            bad, valid, previousBad, previousValid.length, populationSize, previousPopulationSize
          );

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

          const test = MathStats.welchTest(vector, previousVector, populationSize, previousPopulationSize);

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
            share.positive, share.valid, previousShare.positive, previousShare.valid,
            populationSize, previousPopulationSize
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

        const previousCoverage = Scoring.coverage(previousRows, previousHeaders, question);

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

          // Отклонение от нормы компании считается по ТЕКУЩЕМУ году
          // (Segments.METRICS), поэтому и severity зависит только от
          // надежности текущего года — прошлогодняя явка/малая база
          // сюда не подмешивается (см. Segments.currentReliabilityLimited).
          // Полный текущий охват не понижает серьезность подтвержденного
          // отклонения: малое n там значит чувствительность метрики, а
          // не слабую выборку (см. Segments.coverageCaveat). Та же
          // функция используется и на листе "Отклонения срезов" —
          // иначе один и тот же срез может получить противоположные
          // выводы на разных поверхностях.
          const caveat = Segments.coverageCaveat(segment, false);

          findings.push({
            severity: Segments.currentReliabilityLimited(segment) ? "warning" : "critical",
            title: "Срез с отклонениями: " + segment.name + " (" + dimension.dimension + ", n=" + segment.n + ")",
            text: bad + ". " + (caveat.text || "Размер группы достаточен для вывода.")
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
