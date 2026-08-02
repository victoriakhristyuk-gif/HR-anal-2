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
 * компании за текущий год. Каждый непустой срез рассчитывается и
 * показывается независимо от размера. DEVIATION-пороги определяют,
 * считать ли отличие от нормы заметным, но не скрывают саму группу.
 *
 * ЗАЩИТА ОТ ЛОЖНЫХ НАХОДОК. Чем мельче срез, тем легче случайно
 * получить «отклонение». Поэтому:
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

    // "Управление" — не реальная колонка анкеты: она считается по
    // отделу через справочник численности (Headcount), поэтому ищем
    // в данных колонку "Отдел", а не "Управление".
    const isDivisionDimension = this.normalizeKey_(questionTitle) === this.normalizeKey_("Управление");
    const lookupTitle = isDivisionDimension ? "Отдел" : questionTitle;

    const target = this.normalizeKey_(lookupTitle);
    const columnIndex = headers.findIndex(h => this.normalizeKey_(h) === target);

    if (columnIndex === -1) return {};

    const buckets = {};
    const labels = {};

    rows.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) return;

      let display = normalizer
        ? normalizer(String(raw).trim())
        : String(raw).trim();

      // "Отдел" — приводим к каноническому названию ДО группировки в
      // бакет (см. DepartmentAliases), иначе переименованный отдел
      // попадает в текущем и прошлом годах в разные бакеты и год-к-году
      // join ниже (по normalizeKey_) их не свяжет.
      if (isDivisionDimension || this.normalizeKey_(questionTitle) === this.normalizeKey_("Отдел")) {
        display = DepartmentAliases.canonicalize(display);
      }

      // Разрез "Управление" — заменяем отдел на его управление
      // (см. Headcount.gs). Отделы без управления в справочнике
      // (в т.ч. отделы вне справочника численности) попадают в общий
      // бакет "не отнесено", а не пропадают из отчета.
      if (isDivisionDimension) {
        display = Headcount.divisionOf(display) || Headcount.UNASSIGNED_LABEL;
      }

      if (!display) return;

      const key = this.normalizeKey_(display);

      if (!buckets[key]) {
        buckets[key] = [];
        labels[key] = display;
      } else if (labels[key] !== display) {
        console.warn("Segments: «" + display + "» → «" + labels[key] + "» (ключ «" + key + "»)");
      }

      buckets[key].push(row);

    });

    const result = {};
    Object.keys(buckets).forEach(key => { result[labels[key]] = buckets[key]; });
    return result;

  },

  /**
   * Единая категория для "удалённо/город не указан" (см. cityNormalizer).
   * До этой правки "Не указан" и "Удалённо (город не указан)" были
   * двумя разными бакетами — по сути один и тот же случай (нет
   * содержательного города), просто с разной формулировкой в ответе.
   * Раздельный подсчет занижал видимую численность каждой из групп и
   * дважды считался в отклонениях. Слиты в одну категорию ДО
   * группировки (внутри самого нормализатора), поэтому дальше по
   * пайплайну (Segments.splitBy → analyze → compositionShift →
   * AnalyticsWriter) она везде одна, без двойного подсчета.
   */
  UNSPECIFIED_CITY_LABEL: "Город не указан / удалённо",

  /**
   * Нормализатор для свободного текстового поля «Город».
   *
   * В данных 2026 поле заполнялось вручную: 66 вариантов написания,
   * включая «Ростов-на-Дону» и «Ростов на Дону» по отдельности,
   * «удалённо», «перемещаюсь» и четыре ответа «-». Без склейки
   * получается около 60 групп по одному человеку: они теперь видны,
   * но перегружают отчет и не дают содержательной географической
   * картины.
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

    return value => {

      // Лишние пробелы/регистр не должны создавать отдельные бакеты —
      // splitBy() уже обрезает крайние пробелы, но здесь применяем то
      // же самое независимо от вызывающего кода, плюс схлопываем
      // внутренние повторы пробелов ("Москва  " / "москва" и т.п.).
      const cleaned = String(value).trim().replace(/\s+/g, " ");
      const lower = cleaned.toLowerCase();
      const index = majorLower.indexOf(lower);

      if (index !== -1) return major[index];

      // "Удалённо"/"перемещаюсь" и "не указан"/"-"/"—"/"другое" —
      // формально разные ответы, но оба означают отсутствие
      // содержательного города. Единая категория — см.
      // UNSPECIFIED_CITY_LABEL.
      if (/удал|перемещ/i.test(cleaned)) return this.UNSPECIFIED_CITY_LABEL;
      if (cleaned === "-" || cleaned === "—" || /^друго/i.test(cleaned)) return this.UNSPECIFIED_CITY_LABEL;

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
      const promoters = valid.filter(v => Scoring.enpsCategory(v) === "promoters").length;
      const detractors = valid.filter(v => Scoring.enpsCategory(v) === "detractors").length;

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
   * @param {Object} options - {normalizer, previousRows, previousHeaders, keyQuestions}
   */
  analyze(rows, headers, questions, dimension, options) {

    options = options || {};

    const previousHeaders = options.previousHeaders || headers;

    const company = this.metricsFor(rows, headers, questions);
    const buckets = this.splitBy(rows, headers, dimension, options.normalizer);

    // Общая явка по компании — только для разрезов "Отдел"/"Управление"
    // (см. Headcount.gs). Считается от ВСЕЙ штатной численности, а
    // rows.length — от текущих фильтров (см. пояснение у сегментов ниже).
    if (options.includeHeadcount) {
      const companyHeadcount = Headcount.total();
      company.headcount = companyHeadcount;
      company.responseRatePercent = companyHeadcount
        ? MathStats.round(rows.length / companyHeadcount * 100, 1)
        : null;
    }

    const previousBuckets = options.previousRows
      ? this.splitBy(options.previousRows, previousHeaders, dimension, options.normalizer)
      : {};

    const prevByKey = {};
    Object.keys(previousBuckets).forEach(k => {
      prevByKey[this.normalizeKey_(k)] = previousBuckets[k];
    });

    // Вопросы, по которым ищем точечные отклонения средних.
    // Прогонять все 30 бессмысленно: отчет утонет. Берем ключевые.
    const keyQuestions = options.keyQuestions || ["ЗП", "Удовлетворенность рабочими задачами", "Возможности роста", "Цели компании", "ОС от руководителя"];

    const segments = [];

    Object.keys(buckets).forEach(name => {

      const group = buckets[name];

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

      // Стабильный id и примечание о переименовании — только для среза
      // "Отдел" (см. DepartmentAliases). Для остальных срезов (Город,
      // Стаж, Формат работы) отдел ни при чем — оставляем null/пусто.
      const isDepartmentDimension = this.normalizeKey_(dimension) === this.normalizeKey_("Отдел");
      const isDivisionDimension = this.normalizeKey_(dimension) === this.normalizeKey_("Управление");
      const departmentId = isDepartmentDimension ? DepartmentAliases.resolve(name).id : null;
      const renamedFrom = isDepartmentDimension ? DepartmentAliases.getAliasesFor(name) : [];

      // Численность и явка — только для срезов "Отдел" и "Управление"
      // (см. Headcount.gs, только 2026 год). Явка считается от общей
      // численности отдела/управления, а не только от отфильтрованной
      // части — то есть при активных фильтрах это «явка среди тех, кто
      // попадает под фильтр» относительно ВСЕЙ численности отдела, а
      // не оценка ответивших без фильтра.
      let headcount = null;
      let responseRatePercent = null;

      if (options.includeHeadcount) {
        if (isDepartmentDimension) {
          const entry = Headcount.forDepartment(name);
          headcount = entry ? entry.count : null;
        } else if (isDivisionDimension) {
          headcount = Headcount.forDivision(name).count || null;
        }
      }

      if (headcount) {
        responseRatePercent = MathStats.round(group.length / headcount * 100, 1);
      }

      // Явка выше 100% невозможна и означает, что справочник численности
      // (Headcount.gs) для этого отдела/управления битый или устарел —
      // показывать такой процент как обычную низкую/нормальную явку
      // означало бы выдавать заведомо неверные данные за факт.
      const headcountUnreliable = responseRatePercent !== null && responseRatePercent > 100;

      const lowCoverage = !headcountUnreliable && responseRatePercent !== null &&
        responseRatePercent < Norms.LOW_COVERAGE_THRESHOLD_PERCENT;

      // 3. Динамика к прошлому году — для любой непустой базы.
      // Размер обеих групп сохраняется в результате, а малая текущая
      // группа отдельно помечается как fragile: данные не скрываются,
      // но читатель видит ограничение надежности.
      let yearDelta = null;
      const previousGroup = prevByKey[this.normalizeKey_(name)];
      const previousN = previousGroup ? previousGroup.length : 0;

      if (previousN > 0) {

        const previousMetrics = this.metricsFor(previousGroup, previousHeaders, questions);

        if (previousMetrics.enps !== null && metrics.enps !== null) {

          const delta = metrics.enps - previousMetrics.enps;

          yearDelta = {
            previous: previousMetrics.enps,
            previousN: previousN,
            delta: MathStats.round(delta, 1),
            // Изменение считается заметным, только если превышает
            // сумму половин доверительных интервалов обоих годов И обе
            // базы не помечены как малые. Дельта рассчитывается при
            // любом n, но не объявляется надежным изменением.
            meaningful:
              group.length >= Norms.FRAGILE_SEGMENT_SIZE &&
              previousN >= Norms.FRAGILE_SEGMENT_SIZE &&
              Math.abs(delta) > (metrics.enpsMargin + previousMetrics.enpsMargin) / 2
          };

        }

      }

      segments.push({
        dimension: dimension,
        name: name,
        departmentId: departmentId,
        renamedFrom: renamedFrom,
        n: group.length,
        previousN: previousN,
        headcount: headcount,
        responseRatePercent: responseRatePercent,
        lowCoverage: lowCoverage,
        headcountUnreliable: headcountUnreliable,
        metrics: metrics,
        deviations: deviations,
        badCount: deviations.filter(d => d.bad).length,
        yearDelta: yearDelta,
        fragile: group.length < Norms.FRAGILE_SEGMENT_SIZE,
        previousFragile: previousN > 0 && previousN < Norms.FRAGILE_SEGMENT_SIZE,
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
  compositionShift(rowsNow, rowsBefore, headers, headersBefore, dimension, normalizer) {

    headersBefore = headersBefore || headers;

    const now = this.splitBy(rowsNow, headers, dimension, normalizer);
    const before = this.splitBy(rowsBefore, headersBefore, dimension, normalizer);

    const nowByKey = {};
    Object.keys(now).forEach(k => { nowByKey[this.normalizeKey_(k)] = { label: k, rows: now[k] }; });
    const beforeByKey = {};
    Object.keys(before).forEach(k => { beforeByKey[this.normalizeKey_(k)] = { label: k, rows: before[k] }; });

    const allKeys = {};
    Object.keys(nowByKey).forEach(k => { allKeys[k] = true; });
    Object.keys(beforeByKey).forEach(k => { allKeys[k] = true; });

    return Object.keys(allKeys).map(key => {

      const nowEntry = nowByKey[key];
      const beforeEntry = beforeByKey[key];
      const name = nowEntry ? nowEntry.label : beforeEntry.label;
      const nowCount = nowEntry ? nowEntry.rows.length : 0;
      const beforeCount = beforeEntry ? beforeEntry.rows.length : 0;
      const shareNow = nowCount / rowsNow.length * 100;
      const shareBefore = beforeCount / rowsBefore.length * 100;

      return {
        name: name,
        sharePercentNow: MathStats.round(shareNow, 1),
        sharePercentBefore: MathStats.round(shareBefore, 1),
        shiftPp: MathStats.round(shareNow - shareBefore, 1),
        // Сдвиг больше 3 п.п. уже способен заметно двигать общие цифры.
        material: Math.abs(shareNow - shareBefore) >= 3
      };

    }).sort((a, b) => Math.abs(b.shiftPp) - Math.abs(a.shiftPp));

  },

  normalizeKey_(value) {
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  }

};
