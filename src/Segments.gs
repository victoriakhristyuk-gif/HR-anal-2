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
    { key: "enps",        marginKey: "enpsMargin",        label: "eNPS",                    kind: "enps",   goodDirection: "up" },
    { key: "detractors",  marginKey: "detractorsMargin",  label: "Критики, %",              kind: "share",  goodDirection: "down" },
    { key: "burnoutRisk", marginKey: "burnoutRiskMargin", label: "Выгорание рег./пост., %", kind: "share",  goodDirection: "down" },
    { key: "leaveRisk",   marginKey: "leaveRiskMargin",   label: "Думают об уходе, %",      kind: "share",  goodDirection: "down" }
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
  splitBy(rows, headers, questionTitle, normalizer, year) {

    // "Управление" и "Группа команд" — не реальные колонки анкеты: обе
    // считаются по отделу через справочник численности (Headcount),
    // поэтому ищем в данных колонку "Отдел", а не сам вопрос.
    const isDivisionDimension = this.normalizeKey_(questionTitle) === this.normalizeKey_("Управление");
    const isTeamGroupDimension = this.normalizeKey_(questionTitle) === this.normalizeKey_("Группа команд");
    const lookupTitle = (isDivisionDimension || isTeamGroupDimension) ? "Отдел" : questionTitle;

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
      if (isDivisionDimension || isTeamGroupDimension || this.normalizeKey_(questionTitle) === this.normalizeKey_("Отдел")) {
        display = year
          ? Headcount.resolveDepartment(display).name
          : DepartmentAliases.canonicalize(display);
      }

      // Разрез "Управление" — заменяем отдел на его управление
      // (см. Headcount.gs). Отделы без управления в справочнике
      // (в т.ч. отделы вне справочника численности) попадают в общий
      // бакет "не отнесено", а не пропадают из отчета.
      if (isDivisionDimension) {
        if (!year) throw new Error('Для разреза "Управление" не указан год источника данных');
        display = Headcount.divisionOf(year, display) || Headcount.UNASSIGNED_LABEL;
      }

      // Разрез "Группа команд" — заменяем отдел на пару "Управление +
      // Тип команды" (см. Headcount.teamGroupOf). В отличие от
      // "Управление" здесь НЕТ бакета-заглушки для не отнесенных
      // отделов: отдел без указанного типа команды просто не входит ни
      // в одну группу (правило 3-4 в заголовке Headcount.gs) — строка
      // ниже (`if (!display) return;`) исключает его именно из ЭТОГО
      // среза, не трогая остальные измерения.
      if (isTeamGroupDimension) {
        if (!year) throw new Error('Для разреза "Группа команд" не указан год источника данных');
        display = Headcount.teamGroupOf(year, display);
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
   * Сырые счетчики группы (без округления и без ДИ) — общая основа
   * для метрик самой группы И для "компания минус срез" (см.
   * restOfCompany_): суммы/counts складываются и вычитаются, а не
   * готовые проценты, поэтому "остаток" считается корректно.
   */
  rawStats_(rows, headers, questions) {

    const byTitle = {};
    questions.forEach(q => { byTitle[q.title] = q; });

    const enpsQuestion = questions.find(q => q.type === "enps");
    const burnoutQuestion = byTitle["Выгорание"];
    const leaveQuestion = byTitle["Смена работы"];

    const raw = { n: rows.length, enps: null, burnoutRisk: null, leaveRisk: null, means: {} };

    if (enpsQuestion) {
      const vector = Scoring.vector(rows, headers, enpsQuestion);
      const valid = vector.filter(v => v !== null);
      raw.enps = {
        promoters: valid.filter(v => Scoring.enpsCategory(v) === "promoters").length,
        detractors: valid.filter(v => Scoring.enpsCategory(v) === "detractors").length,
        total: valid.length
      };
    }

    if (burnoutQuestion) raw.burnoutRisk = this.riskCounts_(rows, headers, burnoutQuestion, 2);
    if (leaveQuestion) raw.leaveRisk = this.riskCounts_(rows, headers, leaveQuestion, 2);

    // Средние по всем шкальным вопросам — для точечных отклонений.
    // Хранится сумма и сумма квадратов (не готовое среднее), потому что
    // это единственный способ корректно получить дисперсию "остатка"
    // (компания минус срез) — дисперсия не вычитается напрямую, а сумма
    // квадратов аддитивна по любому разбиению выборки.
    questions.forEach(question => {

      if (question.type === "text" || question.type === "single" || question.type === "enps") return;

      const values = Scoring.vector(rows, headers, question).filter(v => v !== null);

      if (values.length > 0) {
        raw.means[question.title] = {
          sum: values.reduce((s, v) => s + v, 0),
          sumSq: values.reduce((s, v) => s + v * v, 0),
          n: values.length
        };
      }

    });

    return raw;

  },

  /**
   * Число «плохих» ответов (балл не выше порога) и знаменатель.
   * Шкалы приведены к «больше = лучше», поэтому риск — это низ шкалы.
   */
  riskCounts_(rows, headers, question, maxBadScore) {

    const vector = Scoring.vector(rows, headers, question);
    const valid = vector.filter(v => v !== null);

    return { bad: valid.filter(v => v <= maxBadScore).length, valid: valid.length };

  },

  /**
   * Показатели одной группы, посчитанные из сырых счетчиков (см.
   * rawStats_) — проценты/среднее, доверительные интервалы (с
   * поправкой на конечную совокупность, см. MathStats.enpsConfidence/
   * proportionConfidence/meanConfidence) и сами сырые счетчики (_raw,
   * нужны только для restOfCompany_, наружу не документируются).
   *
   * @param {Object} raw - результат rawStats_
   * @param {Number} [populationSize] - штат группы (N) для FPC; не
   *   передавать, если знаменатель неизвестен (см. правила в
   *   MathStats.finitePopulationCorrection)
   */
  deriveMetrics_(raw, populationSize) {

    const result = { n: raw.n, _raw: raw };

    if (raw.enps) {

      const ci = MathStats.enpsConfidence(raw.enps.promoters, raw.enps.detractors, raw.enps.total, populationSize);

      result.enps = MathStats.round(ci.enps, 1);
      result.enpsMargin = raw.enps.total ? MathStats.round(ci.margin, 1) : null;
      result.detractors = raw.enps.total ? MathStats.round(raw.enps.detractors / raw.enps.total * 100, 1) : null;
      result.detractorsMargin = raw.enps.total
        ? MathStats.round(MathStats.proportionConfidence(raw.enps.detractors, raw.enps.total, populationSize).margin, 1)
        : null;
      result.enpsBase = raw.enps.total;

    }

    if (raw.burnoutRisk) {
      const ci = MathStats.proportionConfidence(raw.burnoutRisk.bad, raw.burnoutRisk.valid, populationSize);
      result.burnoutRisk = raw.burnoutRisk.valid ? MathStats.round(ci.value, 1) : null;
      result.burnoutRiskMargin = raw.burnoutRisk.valid ? MathStats.round(ci.margin, 1) : null;
    }

    if (raw.leaveRisk) {
      const ci = MathStats.proportionConfidence(raw.leaveRisk.bad, raw.leaveRisk.valid, populationSize);
      result.leaveRisk = raw.leaveRisk.valid ? MathStats.round(ci.value, 1) : null;
      result.leaveRiskMargin = raw.leaveRisk.valid ? MathStats.round(ci.margin, 1) : null;
    }

    result.means = {};

    Object.keys(raw.means).forEach(title => {

      const m = raw.means[title];
      const mean = m.sum / m.n;
      const variance = m.n > 1 ? (m.sumSq - m.n * mean * mean) / (m.n - 1) : 0;
      const ci = MathStats.meanConfidence(mean, variance, m.n, populationSize);

      result.means[title] = {
        mean: MathStats.round(mean, 2),
        n: m.n,
        margin: ci.margin !== null ? MathStats.round(ci.margin, 2) : null
      };

    });

    return result;

  },

  /**
   * Показатели одной группы (обертка над rawStats_ + deriveMetrics_
   * для вызывающего кода, которому не нужен "остаток").
   */
  metricsFor(rows, headers, questions, populationSize) {
    return this.deriveMetrics_(this.rawStats_(rows, headers, questions), populationSize);
  },

  /**
   * "Компания минус сам срез" — база сравнения для Norms.deviation
   * (см. задачу 3 методики). Раньше срез сравнивался с нормой, в
   * которую входил он сам: при доле среза в компании 69% (например
   * Управление разработки ПО, 289 из 418) это по сути сравнение
   * группы САМА С СОБОЙ, размытое небольшой добавкой остальных.
   *
   * Считается вычитанием СЫРЫХ счетчиков (не готовых процентов) —
   * единственный корректный способ, см. rawStats_. populationSize
   * "остатка" — тоже разность штатов (компания минус штат среза),
   * если оба известны, иначе поправка на конечную совокупность не
   * применяется, как и везде (см. MathStats.finitePopulationCorrection).
   */
  restOfCompany_(companyRaw, segmentRaw, companyPopulation, segmentPopulation) {

    const restRaw = {
      n: companyRaw.n - segmentRaw.n,
      enps: (companyRaw.enps && segmentRaw.enps) ? {
        promoters: companyRaw.enps.promoters - segmentRaw.enps.promoters,
        detractors: companyRaw.enps.detractors - segmentRaw.enps.detractors,
        total: companyRaw.enps.total - segmentRaw.enps.total
      } : null,
      burnoutRisk: (companyRaw.burnoutRisk && segmentRaw.burnoutRisk) ? {
        bad: companyRaw.burnoutRisk.bad - segmentRaw.burnoutRisk.bad,
        valid: companyRaw.burnoutRisk.valid - segmentRaw.burnoutRisk.valid
      } : companyRaw.burnoutRisk,
      leaveRisk: (companyRaw.leaveRisk && segmentRaw.leaveRisk) ? {
        bad: companyRaw.leaveRisk.bad - segmentRaw.leaveRisk.bad,
        valid: companyRaw.leaveRisk.valid - segmentRaw.leaveRisk.valid
      } : companyRaw.leaveRisk,
      means: {}
    };

    Object.keys(companyRaw.means).forEach(title => {
      const c = companyRaw.means[title];
      const s = segmentRaw.means[title] || { sum: 0, sumSq: 0, n: 0 };
      restRaw.means[title] = { sum: c.sum - s.sum, sumSq: c.sumSq - s.sumSq, n: c.n - s.n };
    });

    const restPopulation = (companyPopulation !== null && companyPopulation !== undefined &&
      segmentPopulation !== null && segmentPopulation !== undefined)
      ? companyPopulation - segmentPopulation
      : undefined;

    return this.deriveMetrics_(restRaw, restPopulation);

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

    const buckets = this.splitBy(rows, headers, dimension, options.normalizer, options.year);

    const isDepartmentDimension = this.normalizeKey_(dimension) === this.normalizeKey_("Отдел");
    const isDivisionDimension = this.normalizeKey_(dimension) === this.normalizeKey_("Управление");
    const isTeamGroupDimension = this.normalizeKey_(dimension) === this.normalizeKey_("Группа команд");

    // Общая явка по компании — только для разрезов "Отдел"/"Управление"/
    // "Группа команд" (см. Headcount.gs). Считается от ВСЕЙ штатной
    // численности, а rows.length — от текущих фильтров (см. пояснение у
    // сегментов ниже). companyPopulationForFpc — тот же штат, но ТОЛЬКО
    // для includeHeadcount: "Соответствие ожиданиям"/"Грейд" считаются
    // от справочника "перформанс" (performanceTotal), который не штат
    // отдела/управления, а сумма сотрудников с заполненным полем — это
    // среди случаев "N неизвестен" из методики (задача 1), поправка на
    // конечную совокупность для них не применяется.
    let companyHeadcount = null;
    let companyPopulationForFpc;

    if (options.includeHeadcount) {
      companyHeadcount = options.headcountTotal !== undefined
        ? options.headcountTotal
        : Headcount.total(options.year);
      companyPopulationForFpc = companyHeadcount || undefined;
    } else if (options.performanceDimension) {
      companyHeadcount = options.performanceTotal || null;
    }

    const companyRaw = this.rawStats_(rows, headers, questions);
    const company = this.deriveMetrics_(companyRaw, companyPopulationForFpc);

    company.headcount = companyHeadcount;
    company.responseRatePercent = (options.includeHeadcount && companyHeadcount)
      ? MathStats.round(rows.length / companyHeadcount * 100, 1)
      : null;

    const previousBuckets = options.previousRows
      ? this.splitBy(options.previousRows, previousHeaders, dimension, options.normalizer, options.previousYear)
      : {};

    let previousCompanyHeadcount = null;
    let previousCompanyPopulationForFpc;

    if (options.includePreviousHeadcount && options.previousRows) {
      previousCompanyHeadcount = options.previousHeadcountTotal !== undefined
        ? options.previousHeadcountTotal
        : Headcount.total(options.previousYear);
      previousCompanyPopulationForFpc = previousCompanyHeadcount || undefined;
    }

    if (options.previousRows) {
      const previousCompanyMetrics = this.metricsFor(options.previousRows, previousHeaders, questions, previousCompanyPopulationForFpc);
      company.previousN = options.previousRows.length;
      company.previousEnps = previousCompanyMetrics.enps;
    }

    if (options.includePreviousHeadcount && options.previousRows) {
      company.previousHeadcount = previousCompanyHeadcount;
      company.previousResponseRatePercent = previousCompanyHeadcount
        ? MathStats.round(options.previousRows.length / previousCompanyHeadcount * 100, 1)
        : null;
    }

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

      // Стабильный id и примечание о переименовании — только для среза
      // "Отдел" (см. DepartmentAliases). Для остальных срезов (Город,
      // Стаж, Формат работы) отдел ни при чем — оставляем null/пусто.
      const departmentId = isDepartmentDimension
        ? (options.year ? Headcount.resolveDepartment(name).id : DepartmentAliases.resolve(name).id)
        : null;
      const renamedFrom = isDepartmentDimension
        ? (options.year ? Headcount.historicalNames(name) : DepartmentAliases.getAliasesFor(name))
        : [];

      // Численность и явка — только для срезов "Отдел", "Управление" и
      // "Группа команд", и отдельно для каждого года (см. Headcount.gs).
      // Явка считается от общей численности отдела/управления/группы, а
      // не только от отфильтрованной части — то есть при активных
      // фильтрах это «явка среди тех, кто попадает под фильтр»
      // относительно ВСЕЙ численности отдела, а не оценка ответивших
      // без фильтра. Считается ДО метрик — headcount нужен как N для
      // ДИ группы (см. metricsFor ниже).
      let headcount = null;
      let responseRatePercent = null;

      if (options.includeHeadcount) {
        if (isDepartmentDimension) {
          const entry = Headcount.forDepartment(options.year, name);
          headcount = entry ? entry.count : null;
        } else if (isDivisionDimension) {
          headcount = Headcount.forDivision(options.year, name).count || null;
        } else if (isTeamGroupDimension) {
          headcount = Headcount.forTeamGroup(options.year, name).count || null;
        }
      } else if (options.performanceDimension) {
        // Единая численность "приглашенных" на все группы среза (см.
        // пояснение выше, у company.headcount) — не подсчет конкретного
        // значения поля в справочнике, а общее число сотрудников с
        // заполненным полем, независимо от того, к какой группе относится
        // текущая строка. НЕ используется как N для FPC (см. пояснение
        // у companyPopulationForFpc выше) — та же самая цифра для ВСЕХ
        // групп среза не является штатом конкретной группы.
        headcount = options.performanceTotal || null;
      }

      if (headcount) {
        responseRatePercent = MathStats.round(group.length / headcount * 100, 1);
      }

      // Явка выше 100% невозможна и означает, что справочник численности
      // (Headcount.gs) для этого отдела/управления битый или устарел —
      // показывать такой процент как обычную низкую/нормальную явку
      // означало бы выдавать заведомо неверные данные за факт. По той
      // же причине такому n НЕ передается populationSize — FPC от
      // (N−n) при n>N дал бы отрицательное подкоренное выражение (см.
      // MathStats.finitePopulationCorrection: n>N → без поправки).
      const headcountUnreliable = responseRatePercent !== null && responseRatePercent > 100;

      const lowCoverage = !headcountUnreliable && responseRatePercent !== null &&
        responseRatePercent < Norms.LOW_COVERAGE_THRESHOLD_PERCENT;

      // Полный охват — по точным целым n/headcount, а не по округлённому
      // проценту (100.0% в responseRatePercent может быть округлением
      // 99,6% и наоборот).
      const fullCoverage = headcount !== null && group.length === headcount;

      // N для FPC этой группы — только когда явка не битая (n<=N) и
      // знаменатель действительно штат самой группы (includeHeadcount),
      // не общий "перформанс"-тотал.
      const segmentPopulationForFpc = (options.includeHeadcount && headcount && !headcountUnreliable)
        ? headcount
        : undefined;

      const segmentRaw = this.rawStats_(group, headers, questions);
      const metrics = this.deriveMetrics_(segmentRaw, segmentPopulationForFpc);

      // "Компания минус сам срез" — база сравнения (см. задачу 3
      // методики и restOfCompany_ выше): срез не сравнивается сам с
      // собой через общую норму.
      const rest = this.restOfCompany_(companyRaw, segmentRaw, companyPopulationForFpc, segmentPopulationForFpc);

      const deviations = [];

      // 1. Отклонения по риск-метрикам и eNPS — против "остальной компании"
      this.METRICS.forEach(metric => {

        const deviation = Norms.deviation(
          metrics[metric.key],
          rest[metric.key],
          metric.kind,
          metric.label,
          metrics[metric.marginKey],
          rest[metric.marginKey]
        );

        if (!deviation) return;

        const isBad = metric.goodDirection === "up"
          ? deviation.diff < 0
          : deviation.diff > 0;

        deviation.bad = isBad;
        deviations.push(deviation);

      });

      // 2. Точечные отклонения средних по ключевым вопросам — тоже
      // против "остальной компании", не общей нормы.
      keyQuestions.forEach(title => {

        const segmentMeanEntry = metrics.means[title];
        const restMeanEntry = rest.means[title];

        const deviation = Norms.deviation(
          segmentMeanEntry ? segmentMeanEntry.mean : null,
          restMeanEntry ? restMeanEntry.mean : null,
          "rating",
          title,
          segmentMeanEntry ? segmentMeanEntry.margin : null,
          restMeanEntry ? restMeanEntry.margin : null
        );

        if (!deviation) return;

        deviation.bad = deviation.diff < 0;
        deviations.push(deviation);

      });

      // 3. Динамика к прошлому году — для любой непустой базы.
      let yearDelta = null;
      const previousGroup = prevByKey[this.normalizeKey_(name)];
      const previousN = previousGroup ? previousGroup.length : 0;

      let previousHeadcount = null;
      let previousResponseRatePercent = null;

      if (options.includePreviousHeadcount) {
        if (isDepartmentDimension) {
          const previousEntry = Headcount.forDepartment(options.previousYear, name);
          previousHeadcount = previousEntry ? previousEntry.count : null;
        } else if (isDivisionDimension) {
          previousHeadcount = Headcount.forDivision(options.previousYear, name).count || null;
        } else if (isTeamGroupDimension) {
          previousHeadcount = Headcount.forTeamGroup(options.previousYear, name).count || null;
        }
      }

      if (previousHeadcount) {
        previousResponseRatePercent = MathStats.round(previousN / previousHeadcount * 100, 1);
      }

      const previousHeadcountUnreliable = previousResponseRatePercent !== null &&
        previousResponseRatePercent > 100;
      const previousLowCoverage = !previousHeadcountUnreliable && previousResponseRatePercent !== null &&
        previousResponseRatePercent < Norms.LOW_COVERAGE_THRESHOLD_PERCENT;
      const previousFullCoverage = previousHeadcount !== null && previousN === previousHeadcount;

      const previousPopulationForFpc = (options.includePreviousHeadcount && previousHeadcount && !previousHeadcountUnreliable)
        ? previousHeadcount
        : undefined;

      const previousMetrics = previousN > 0
        ? this.metricsFor(previousGroup, previousHeaders, questions, previousPopulationForFpc)
        : null;

      if (previousMetrics && previousMetrics.enps !== null && metrics.enps !== null) {

        const delta = metrics.enps - previousMetrics.enps;

        yearDelta = {
          previous: previousMetrics.enps,
          previousN: previousN,
          delta: MathStats.round(delta, 1),
          // Изменение считается заметным, только если СКОРРЕКТИРОВАННЫЕ
          // (FPC+Лаплас) доверительные интервалы обоих годов НЕ
          // пересекаются (см. MathStats.enpsChangeIsReal) — не абсолютный
          // размер базы, как раньше (FRAGILE_SEGMENT_SIZE): при полном
          // охвате малая группа дает margin=0 и способна показать
          // надежное изменение, а большая группа с широким ДИ (напр.
          // неизвестный знаменатель) — нет, независимо от n.
          meaningful: MathStats.enpsChangeIsReal(
            { enps: metrics.enps, margin: metrics.enpsMargin },
            { enps: previousMetrics.enps, margin: previousMetrics.enpsMargin }
          )
        };

      }

      // Класс надёжности (см. Norms.reliabilityClass) — функция ширины
      // ДИ eNPS, не n. Качество охвата (Norms.coverageQuality) — отдельный
      // столбец про смещение неответивших, который FPC не лечит.
      const reliabilityClass = Norms.reliabilityClass(metrics.enpsMargin, fullCoverage);
      const coverageQuality = Norms.coverageQuality(responseRatePercent, headcount !== null);
      const previousReliabilityClass = previousMetrics
        ? Norms.reliabilityClass(previousMetrics.enpsMargin, previousFullCoverage)
        : null;
      const previousCoverageQuality = Norms.coverageQuality(previousResponseRatePercent, previousHeadcount !== null);

      segments.push({
        dimension: dimension,
        name: name,
        departmentId: departmentId,
        renamedFrom: renamedFrom,
        n: group.length,
        previousN: previousN,
        headcount: headcount,
        responseRatePercent: responseRatePercent,
        previousHeadcount: previousHeadcount,
        previousResponseRatePercent: previousResponseRatePercent,
        lowCoverage: lowCoverage,
        headcountUnreliable: headcountUnreliable,
        previousLowCoverage: previousLowCoverage,
        previousHeadcountUnreliable: previousHeadcountUnreliable,
        fullCoverage: fullCoverage,
        previousFullCoverage: previousFullCoverage,
        metrics: metrics,
        rest: rest,
        deviations: deviations,
        badCount: deviations.filter(d => d.bad).length,
        yearDelta: yearDelta,
        reliabilityClass: reliabilityClass,
        coverageQuality: coverageQuality,
        previousReliabilityClass: previousReliabilityClass,
        previousCoverageQuality: previousCoverageQuality,
        // Устаревшие признаки (см. Norms.FRAGILE_SEGMENT_SIZE) — оставлены
        // только для еще не мигрированных потребителей (CrossSegments.gs,
        // TeamTypeComparison.gs); "Отклонения срезов"/"Выводы"/"Светофор"
        // используют reliabilityClass/coverageQuality выше.
        fragile: group.length < Norms.FRAGILE_SEGMENT_SIZE,
        previousFragile: previousN > 0 && previousN < Norms.FRAGILE_SEGMENT_SIZE,
        // Срез считается настоящей проблемой, только если плохих
        // отклонений НЕСКОЛЬКО. Одно отклонение при переборе десятков
        // групп — ожидаемая случайность, а не находка. Правило про
        // множественные сравнения, не про размер группы — не меняется.
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
   * Пояснение репрезентативности среза — единая точка правды для
   * findings (AnalyticsService), листа "Отклонения срезов"
   * (AnalyticsWriter) и контекста в обычном отчете (ReportBuilder),
   * чтобы формулировки и статус надежности не разошлись между тремя
   * поверхностями.
   *
   * РАЗДЕЛЯЕТ ДВЕ РАЗНЫЕ ВЕЩИ (см. методику, задача 3):
   *   – КЛАСС НАДЁЖНОСТИ (Norms.reliabilityClass) — насколько точна
   *     цифра для тех, кто ответил, по фактической ширине
   *     скорректированного (FPC+Лаплас) ДИ eNPS;
   *   – КАЧЕСТВО ОХВАТА (Norms.coverageQuality) — насколько ответившие
   *     похожи на всю группу (смещение неответивших, которое FPC
   *     принципиально не лечит).
   * Ни один класс надёжности не означает "не показывать" — группа
   * показывается всегда, класс только помогает читать цифру.
   *
   * ЯВКА СЧИТАЕТСЯ ТОЛЬКО ДЛЯ "ОТДЕЛ"/"УПРАВЛЕНИЕ"/"ГРУППА КОМАНД" (см. Headcount.gs).
   * Для остальных срезов (город, стаж, формат работы...) headcount
   * всегда null не потому, что численность "не заполнена", а потому
   * что для них нет знаменателя в принципе.
   *
   * @param {Object} segment - элемент segments из analyze()
   * @param {Boolean} previous - true — пояснение для прошлого года
   * @returns {{text: String, limitsReliability: Boolean}}
   *   limitsReliability — можно ли из-за этой оговорки понижать
   *   серьезность/статус вывода (класс "Грубая"/"Ориентировочная",
   *   явка < 80% без полного охвата, или ДИ не посчитан).
   */
  coverageCaveat(segment, previous) {

    const n = previous ? segment.previousN : segment.n;
    const headcount = previous ? segment.previousHeadcount : segment.headcount;
    const responseRatePercent = previous ? segment.previousResponseRatePercent : segment.responseRatePercent;
    const headcountUnreliable = previous ? segment.previousHeadcountUnreliable : segment.headcountUnreliable;
    const reliabilityClass = previous ? segment.previousReliabilityClass : segment.reliabilityClass;
    const yearSuffix = previous ? " прошлого года" : "";

    const isPerformanceDimension =
      this.normalizeKey_(segment.dimension) === this.normalizeKey_("Соответствие ожиданиям") ||
      this.normalizeKey_(segment.dimension) === this.normalizeKey_("Грейд");

    const denominatorSource = isPerformanceDimension ? "справочник «перформанс»" : "справочник численности";

    if (headcountUnreliable) {
      return {
        text: "Явка" + yearSuffix + " " + responseRatePercent + "% (> 100%) — " + denominatorSource + " требует проверки.",
        limitsReliability: true
      };
    }

    const headcountKnown = headcount !== null;
    const coverageText = Norms.coverageQuality(responseRatePercent, headcountKnown);
    const reliabilityText = reliabilityClass
      ? Norms.RELIABILITY_TEXT[reliabilityClass]
      : "Доверительный интервал не посчитан (нет ни одного ответа).";

    const appliesToHeadcount =
      this.normalizeKey_(segment.dimension) === this.normalizeKey_("Отдел") ||
      this.normalizeKey_(segment.dimension) === this.normalizeKey_("Управление") ||
      this.normalizeKey_(segment.dimension) === this.normalizeKey_("Группа команд") ||
      isPerformanceDimension;

    // "Полный охват" называется явно в самом предложении (не только
    // через reliabilityText) — это факт про явку, отдельный от класса
    // надёжности ДИ, и читателю он должен быть виден в тексте прямо.
    let base;

    if (reliabilityClass === Norms.RELIABILITY_CLASS.FULL_COVERAGE) {
      base = "Полный охват" + yearSuffix + ": ответили " + n + " из " + headcount + " сотрудников.";
    } else if (headcountKnown) {
      base = "Ответили " + n + " из " + headcount + " (явка" + yearSuffix + " " + responseRatePercent + "%, " + coverageText + ").";
    } else if (appliesToHeadcount) {
      // Rule 3: "Отдел"/"Управление"/"Группа команд"/"Соответствие
      // ожиданиям"/"Грейд" — знаменатель потенциально узнаваем, просто
      // отсутствует/недоступен в текущем прогоне (не то же самое, что
      // "для этого среза явки не бывает в принципе", см. ниже).
      base = "Численность" + yearSuffix + " неизвестна (" + denominatorSource + ") — репрезентативность по явке оценить нельзя. n=" + n + ".";
    } else {
      // Rule 6: город/стаж/формат работы и т.п. — явка для таких срезов
      // не считается в принципе (нет знаменателя приглашенных).
      base = "n=" + n + ". " + coverageText.charAt(0).toUpperCase() + coverageText.slice(1) + ".";
    }

    const limitsReliability =
      reliabilityClass === null ||
      reliabilityClass === Norms.RELIABILITY_CLASS.ROUGH ||
      reliabilityClass === Norms.RELIABILITY_CLASS.INDICATIVE ||
      (reliabilityClass !== Norms.RELIABILITY_CLASS.FULL_COVERAGE &&
        headcountKnown && responseRatePercent !== null && responseRatePercent < 80);

    return { text: base + " " + reliabilityText, limitsReliability: limitsReliability };

  },

  /**
   * Надежность ТЕКУЩЕГО результата — от прошлогодней базы не зависит.
   * Подтверждённое отклонение сегмента от "остальной компании" (см.
   * METRICS в analyze()) считается по данным ТЕКУЩЕГО года, поэтому и
   * его надежность должна оцениваться только по текущему году.
   *
   * Единая точка для AnalyticsService.findings (п.6) и
   * AnalyticsWriter.writeSegments_ (статус текущего результата), чтобы
   * они не разошлись.
   *
   * @param {Object} segment - элемент segments из analyze()
   * @returns {Boolean}
   */
  currentReliabilityLimited(segment) {
    return this.coverageCaveat(segment, false).limitsReliability ||
      segment.metrics.enpsMargin === null;
  },

  /**
   * Надежность СРАВНЕНИЯ с прошлым годом — отдельная от
   * currentReliabilityLimited оценка. Используется только там, где
   * речь идет именно о годовой динамике (подпись рядом с yearDelta и
   * т.п.), а не о самом текущем результате. Не подменяет и не меняет
   * действующий расчет yearDelta.meaningful в analyze() — та проверка
   * теперь использует пересечение скорректированных ДИ
   * (MathStats.enpsChangeIsReal), а не размер базы.
   *
   * @param {Object} segment - элемент segments из analyze()
   * @returns {Boolean}
   */
  yearComparisonLimited(segment) {
    if (this.currentReliabilityLimited(segment)) return true;
    if (segment.previousN === 0) return true;
    return this.coverageCaveat(segment, true).limitsReliability;
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
  compositionShift(rowsNow, rowsBefore, headers, headersBefore, dimension, normalizer, yearNow, yearBefore) {

    headersBefore = headersBefore || headers;

    const now = this.splitBy(rowsNow, headers, dimension, normalizer, yearNow);
    const before = this.splitBy(rowsBefore, headersBefore, dimension, normalizer, yearBefore);

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
