/**
 * ==========================================================
 * Executive Summary — генерация текстовых выводов
 * ==========================================================
 *
 * Вся логика формирования текста Executive Summary находится только
 * здесь — ReportBuilder.gs (когда подключит вывод этого блока) должен
 * лишь получить готовый массив строк из buildExecutiveSummary и вывести
 * их на лист, не формируя текст самостоятельно.
 *
 * Ничего не пересчитывает: использует только уже готовые показатели из
 * reportData/reportData.comparison (Statistics.gs/Comparison.gs) —
 * например, eNPS/промоутеры/нейтралы/критики за 2026 и 2025 и их Δ.
 * Функции конкретных инсайтов (buildEnpsInsight_ и далее) принимают не
 * весь reportData, а только тот минимальный уже готовый объект, который
 * им действительно нужен — им не следует знать про устройство отчета
 * целиком.
 */

const Insights = {

  // Порог, при котором изменение доли критиков в eNPS-инсайте считается
  // "не изменилось" (Сценарий 1). Доли уже округлены Statistics.gs до
  // целых процентов, поэтому порог меньше 1 п.п. отсекает только
  // настоящий ноль, а не случайные округления в другую сторону.
  ENPS_NO_CHANGE_THRESHOLD: 0.5,

  // Порог "значимого" изменения средней оценки (баллы шкалы 1-5, тот же
  // порядок величины, что и ReportBuilder.DELTA_THRESHOLD_RATING, но
  // это независимая, специфичная для формулировок инсайта константа —
  // Insights.gs не обращается к ReportBuilder). Все |delta| меньше этого
  // значения считаются незначительными и не упоминаются в инсайте.
  AVERAGE_DELTA_THRESHOLD: 0.05,

  // Максимум показателей, перечисляемых в одном инсайте о росте/снижении
  // средних оценок ("взять максимум три показателя").
  AVERAGE_TOP_N: 3,

  // Порог "значимого" изменения доли риск-категории выгорания (п.п.).
  // Изменения меньше этого значения считаются незначительными и не
  // упоминаются в инсайте.
  BURNOUT_DELTA_THRESHOLD: 3,

  // Порог "значимого" изменения доли риск-категории ухода (п.п.) —
  // отдельная константа от BURNOUT_DELTA_THRESHOLD (числовое значение
  // сейчас совпадает, но это два независимых, по смыслу разных порога).
  TURNOVER_DELTA_THRESHOLD: 3,

  /**
   * Собрать Executive Summary — массив готовых строк для вывода.
   * Каждый источник получает не весь reportData, а только свой
   * минимальный уже готовый кусок данных:
   *   - eNPS (buildEnpsInsight_) — reportData.comparison.enps;
   *   - средние оценки (buildAverageScoreInsights_) —
   *     reportData.comparison.averageRatings;
   *   - выгорание (buildBurnoutInsight_) — агрегированные риск-категории
   *     "Выгорания" (percent2026/percent2025/delta по низкому и
   *     повышенному риску);
   *   - риск ухода (buildTurnoverRiskInsight_) — те же агрегированные
   *     риск-категории, но для "Риска ухода".
   * Ни один из них не получает reportData целиком.
   */
  buildExecutiveSummary(reportData) {

    const summary = [];

    const enpsComparison = reportData.comparison ? reportData.comparison.enps : null;
    const enpsInsight = this.buildEnpsInsight_(enpsComparison);

    if (enpsInsight) {
      summary.push(enpsInsight);
    }

    const averageRatings = reportData.comparison ? reportData.comparison.averageRatings : [];
    this.buildAverageScoreInsights_(averageRatings).forEach(insight => { summary.push(insight); });

    const burnoutCategories = reportData.comparison ? reportData.comparison.burnout : null;
    const burnoutInsight = this.buildBurnoutInsight_(burnoutCategories);

    if (burnoutInsight) {
      summary.push(burnoutInsight);
    }

    const turnoverCategories = reportData.comparison ? reportData.comparison.turnoverRisk : null;
    const turnoverInsight = this.buildTurnoverRiskInsight_(turnoverCategories);

    if (turnoverInsight) {
      summary.push(turnoverInsight);
    }

    return summary;

  },

  /**
   * Инсайт по eNPS. Принимает только reportData.comparison.enps (форма
   * Comparison.compareENPS: value2026/value2025/delta + categories[]) —
   * не весь reportData. null, если сравнивать не с чем (см.
   * buildEnpsContext_).
   */
  buildEnpsInsight_(enpsComparison) {

    const context = this.buildEnpsContext_(enpsComparison);

    if (!context) {
      return null;
    }

    const scenario = this.ENPS_SCENARIOS_.find(candidate => candidate.matches(context));

    return scenario ? scenario.describe(context) : null;

  },

  /**
   * Извлечь из enpsComparison плоский набор значений, нужных сценариям
   * eNPS-инсайта, — единственное место, которое "понимает" форму
   * Comparison.compareENPS. Дальше сценарии работают только с этим
   * плоским контекстом, не с исходной структурой сравнения.
   *
   * null, если сравнивать не с чем: сравнение с 2025 не включено, либо
   * eNPS или разбивка по категориям недоступны за один из годов (нет
   * валидных ответов — тот же случай null, что и в Comparison.gs).
   */
  buildEnpsContext_(enpsComparison) {

    if (!enpsComparison || enpsComparison.value2026 === null || enpsComparison.value2025 === null) {
      return null;
    }

    const byCategory = {};
    (enpsComparison.categories || []).forEach(item => { byCategory[item.category] = item; });

    const promoters = byCategory.promoters;
    const passives = byCategory.neutrals;
    const detractors = byCategory.detractors;

    if (!promoters || !passives || !detractors ||
        promoters.delta === null || passives.delta === null || detractors.delta === null) {
      return null;
    }

    return {
      oldValue: enpsComparison.value2025,
      newValue: enpsComparison.value2026,
      deltaEnps: enpsComparison.delta,
      deltaPromoters: promoters.delta,
      deltaPassives: passives.delta,
      deltaDetractors: detractors.delta,
      detractorsPercent2026: detractors.percent2026
    };

  },

  /**
   * Сценарии eNPS-инсайта, по порядку: первый, чей matches(context)
   * вернет true, определяет текст через describe(context). Добавление
   * нового сценария — это новый элемент массива, а не еще один if в
   * растущей цепочке условий внутри buildEnpsInsight_. Последний
   * сценарий — "все остальные случаи", его matches() всегда true.
   */
  ENPS_SCENARIOS_: [

    {
      // eNPS снизился из-за перетока промоутеров в нейтралы, доля
      // критиков практически не изменилась. deltaEnps < 0 обязателен —
      // главный показатель имеет приоритет: одного лишь распределения
      // категорий недостаточно, чтобы утверждать "eNPS снизился"
      // (иначе возможно противоречие: категории намекают на снижение,
      // а сам eNPS вырос).
      matches(context) {
        return context.deltaEnps < 0 &&
          context.deltaPromoters < 0 &&
          context.deltaPassives > 0 &&
          Math.abs(context.deltaDetractors) < Insights.ENPS_NO_CHANGE_THRESHOLD;
      },
      describe(context) {
        return "eNPS снизился с " + context.oldValue + " до " + context.newValue + " (" +
          Insights.formatSigned_(context.deltaEnps) + " п.п.). Доля критиков не изменилась (" +
          context.detractorsPercent2026 + "%), снижение связано с ростом доли нейтралов.";
      }
    },

    {
      // eNPS снизился в основном из-за роста доли критиков. Тот же
      // приоритет deltaEnps < 0, что и в предыдущем сценарии — по той
      // же причине (текст начинается с "eNPS снизился").
      matches(context) {
        return context.deltaEnps < 0 && context.deltaDetractors > 0;
      },
      describe(context) {
        return "eNPS снизился с " + context.oldValue + " до " + context.newValue + " (" +
          Insights.formatSigned_(context.deltaEnps) + " п.п.). Основной вклад внес рост доли критиков.";
      }
    },

    {
      // eNPS вырос благодаря росту доли промоутеров. deltaEnps > 0
      // обязателен — та же логика приоритета, что и выше, но для роста.
      matches(context) {
        return context.deltaEnps > 0 && context.deltaPromoters > 0;
      },
      describe(context) {
        return "eNPS вырос с " + context.oldValue + " до " + context.newValue + " (" +
          Insights.formatSigned_(context.deltaEnps) + " п.п.) благодаря увеличению доли промоутеров.";
      }
    },

    {
      // Остальные случаи — без дополнительных выводов.
      matches() {
        return true;
      },
      describe(context) {
        return "eNPS изменился с " + context.oldValue + " до " + context.newValue + " (" +
          Insights.formatSigned_(context.deltaEnps) + " п.п.).";
      }
    }

  ],

  /**
   * Число со знаком в тексте инсайта — отрицательное и так печатается
   * со знаком "-", здесь только добавляется "+" для положительного
   * (ноль — без знака).
   */
  formatSigned_(value) {
    return value > 0 ? "+" + value : String(value);
  },

  /**
   * Инсайты по средним оценкам: рост и снижение генерируются
   * независимо (см. AVERAGE_SCENARIOS_) — при выраженном росте и
   * выраженном снижении одновременно возвращаются оба текста; если ни
   * одного заметного изменения нет, возвращается только нейтральный
   * текст "Сценария 3". Принимает не reportData, а только массив уже
   * посчитанных средних оценок — тот же {question, value2026,
   * value2025, delta}, что уже используется в блоке "Средние оценки"
   * (Comparison.compareAverageRatings /
   * ReportBuilder.buildAverageOverviewRows_) — не пересчитывает и не
   * обращается к исходным ответам.
   */
  buildAverageScoreInsights_(averageRatings) {

    const context = this.buildAverageContext_(averageRatings);

    if (!context) {
      return [];
    }

    return this.AVERAGE_SCENARIOS_
      .filter(scenario => scenario.matches(context))
      .map(scenario => scenario.describe(context));

  },

  /**
   * Извлечь из массива средних оценок то, что нужно сценариям: топ-N
   * (AVERAGE_TOP_N) показателей с заметным ростом (delta >=
   * AVERAGE_DELTA_THRESHOLD, отсортированы по убыванию роста) и топ-N с
   * заметным снижением (delta <= -AVERAGE_DELTA_THRESHOLD, отсортированы
   * по убыванию снижения). Показатели без дельты (нет данных 2025 по
   * конкретному вопросу) не учитываются.
   *
   * null, если сравнивать вообще не с чем (пустой/отсутствующий массив —
   * сравнение с 2025 не включено) — тогда инсайтов не будет вовсе, в
   * отличие от случая "дельты есть, но все меньше порога" (это уже
   * Сценарий 3, не null).
   */
  buildAverageContext_(averageRatings) {

    const validItems = (averageRatings || [])
      .filter(item => item.delta !== null && item.delta !== undefined);

    if (validItems.length === 0) {
      return null;
    }

    const risers = validItems
      .filter(item => item.delta >= this.AVERAGE_DELTA_THRESHOLD)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, this.AVERAGE_TOP_N);

    const decliners = validItems
      .filter(item => item.delta <= -this.AVERAGE_DELTA_THRESHOLD)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, this.AVERAGE_TOP_N);

    return { risers: risers, decliners: decliners };

  },

  /**
   * Сценарии инсайта по средним оценкам. В отличие от ENPS_SCENARIOS_
   * (там побеждает первый подошедший), здесь matches() каждого сценария
   * проверяется независимо (.filter, не .find) — рост и снижение не
   * взаимоисключающие и могут дать два инсайта одновременно. Сценарий
   * "нет заметных изменений" матчится только тогда, когда не подошел ни
   * рост, ни снижение.
   */
  AVERAGE_SCENARIOS_: [

    {
      // Наибольший рост — до трех показателей, отсортированных по
      // убыванию роста (context.risers уже отсортирован в
      // buildAverageContext_).
      matches(context) {
        return context.risers.length > 0;
      },
      describe(context) {
        return Insights.describeAverageMovers_(
          context.risers,
          "Наибольший рост показал показатель",
          "Наибольший рост показали",
          false // при двух показателях — без двоеточия, см. заданный пример
        );
      }
    },

    {
      // Наиболее заметное снижение — симметрично росту, но с "по
      // показателю(ям)" вместо "показал(и)".
      matches(context) {
        return context.decliners.length > 0;
      },
      describe(context) {
        return Insights.describeAverageMovers_(
          context.decliners,
          "Наиболее заметное снижение отмечено по показателю",
          "Наиболее заметное снижение отмечено по показателям",
          true // здесь двоеточие ставится уже при двух показателях, см. заданный пример
        );
      }
    },

    {
      // Ни заметного роста, ни заметного снижения ни по одному вопросу.
      matches(context) {
        return context.risers.length === 0 && context.decliners.length === 0;
      },
      describe() {
        return "Все средние оценки изменились менее чем на " +
          Insights.formatAverageThreshold_(Insights.AVERAGE_DELTA_THRESHOLD) + " балла.";
      }
    }

  ],

  /**
   * Собрать текст инсайта роста/снижения средних оценок по списку
   * "движителей" (items, уже отсортированы и ограничены AVERAGE_TOP_N):
   *   - 1 показатель: singularPhrase + название в кавычках (+Δ);
   *   - 2 показателя: pluralPhrase + "A (Δ) и B (Δ)." — с двоеточием,
   *     только если colonForTwo=true (у сценария снижения — да, у роста —
   *     нет; ровно так, как в заданных примерах для каждого сценария);
   *   - 3 показателя: pluralPhrase + ": A (Δ), B (Δ) и C (Δ)." — здесь
   *     двоеточие всегда, независимо от colonForTwo.
   */
  describeAverageMovers_(items, singularPhrase, pluralPhrase, colonForTwo) {

    const formatted = items.map(item => item.question + " (" + this.formatSignedAverage_(item.delta) + ")");

    if (formatted.length === 1) {
      return singularPhrase + " \"" + items[0].question + "\" (" +
        this.formatSignedAverage_(items[0].delta) + ").";
    }

    if (formatted.length === 2 && !colonForTwo) {
      return pluralPhrase + " " + formatted[0] + " и " + formatted[1] + ".";
    }

    const head = formatted.slice(0, -1).join(", ");
    const tail = formatted[formatted.length - 1];

    return pluralPhrase + ": " + head + " и " + tail + ".";

  },

  /**
   * Средняя оценка со знаком и запятой как десятичным разделителем
   * (+0,08 / -0,07) — формат соответствует уже принятому в отчете
   * написанию баллов (см. ReportBuilder), не совпадает с formatSigned_
   * (тот — для целых eNPS-показателей, без десятичных знаков).
   */
  formatSignedAverage_(value) {

    const magnitude = Math.abs(value).toFixed(2).replace(".", ",");
    const sign = value > 0 ? "+" : (value < 0 ? "-" : "");

    return sign + magnitude;

  },

  /**
   * Порог |delta| для текста Сценария 3 — та же запятая-разделитель,
   * что и у formatSignedAverage_, без знака (порог сам по себе не может
   * быть отрицательным).
   */
  formatAverageThreshold_(value) {
    return value.toFixed(2).replace(".", ",");
  },

  /**
   * Инсайт по выгоранию. Принимает не reportData, а только уже
   * агрегированные риск-категории — { lowRisk, highRisk, unsure }, у
   * каждой { percent2026, percent2025, delta } (та же агрегация, что уже
   * используется в KPI-блоке "Выгорание"). "unsure" ("Затруднились")
   * присутствует в данных, но никогда не используется в тексте — см.
   * buildBurnoutContext_.
   *
   * В отличие от AVERAGE_SCENARIOS_ (там независимые .filter) и как у
   * ENPS_SCENARIOS_ (там .find) — здесь тоже только один текст:
   * "объединенные" сценарии 5/6 стоят в начале BURNOUT_SCENARIOS_ и
   * поэтому имеют приоритет над одиночными 1-4 (когда оба условия
   * объединенного сценария выполняются, одиночные условия 1-4 тоже
   * автоматически выполняются, но объединенный уже "забрал" совпадение,
   * т.к. проверяется первым). null, если ни один сценарий не подошел
   * (Сценарий 7 — намеренно без текста "изменения незначительны").
   */
  buildBurnoutInsight_(burnoutCategories) {

    const context = this.buildBurnoutContext_(burnoutCategories);

    if (!context) {
      return null;
    }

    const scenario = this.BURNOUT_SCENARIOS_.find(candidate => candidate.matches(context));

    return scenario ? scenario.describe(context) : null;

  },

  /**
   * Извлечь из агрегированных риск-категорий выгорания плоский контекст
   * для сценариев — только lowRisk/highRisk (percent2026/percent2025/
   * delta). "unsure" ("Затруднились") намеренно не попадает в контекст:
   * она может присутствовать в данных, но не должна влиять на
   * формулировки.
   *
   * null, если сравнивать не с чем: агрегированные категории не переданы
   * либо у lowRisk/highRisk нет delta (нет данных 2025).
   */
  buildBurnoutContext_(burnoutCategories) {

    if (!burnoutCategories) {
      return null;
    }

    const lowRisk = burnoutCategories.lowRisk;
    const highRisk = burnoutCategories.highRisk;

    if (!lowRisk || !highRisk ||
        lowRisk.delta === null || lowRisk.delta === undefined ||
        highRisk.delta === null || highRisk.delta === undefined) {
      return null;
    }

    return {
      lowOld: lowRisk.percent2025,
      lowNew: lowRisk.percent2026,
      lowDelta: lowRisk.delta,
      highOld: highRisk.percent2025,
      highNew: highRisk.percent2026,
      highDelta: highRisk.delta
    };

  },

  /**
   * Сценарии инсайта по выгоранию, по порядку — первый подошедший
   * побеждает (см. buildBurnoutInsight_). Объединенные сценарии
   * "улучшились"/"ухудшились" идут первыми, поэтому имеют приоритет над
   * одиночными сценариями 1-4, как и требуется.
   */
  BURNOUT_SCENARIOS_: [

    {
      // Сценарий 5: низкий риск вырос И повышенный риск снизился —
      // заменяет сценарии 1 и 4.
      matches(context) {
        return context.lowDelta >= Insights.BURNOUT_DELTA_THRESHOLD &&
          context.highDelta <= -Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Показатели выгорания улучшились: доля сотрудников с низким риском выросла с " +
          context.lowOld + "% до " + context.lowNew + "%, а с повышенным риском снизилась с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 6: низкий риск снизился И повышенный риск вырос —
      // заменяет сценарии 2 и 3.
      matches(context) {
        return context.lowDelta <= -Insights.BURNOUT_DELTA_THRESHOLD &&
          context.highDelta >= Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Показатели выгорания ухудшились: доля сотрудников с низким риском снизилась с " +
          context.lowOld + "% до " + context.lowNew + "%, а с повышенным риском выросла с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 1: низкий риск вырос (без учета повышенного риска).
      matches(context) {
        return context.lowDelta >= Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Доля сотрудников с низким риском выгорания выросла с " +
          context.lowOld + "% до " + context.lowNew + "%.";
      }
    },

    {
      // Сценарий 2: низкий риск снизился.
      matches(context) {
        return context.lowDelta <= -Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Доля сотрудников с низким риском выгорания снизилась с " +
          context.lowOld + "% до " + context.lowNew + "%.";
      }
    },

    {
      // Сценарий 3: повышенный риск вырос.
      matches(context) {
        return context.highDelta >= Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Доля сотрудников с повышенным риском выгорания выросла с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 4: повышенный риск снизился.
      matches(context) {
        return context.highDelta <= -Insights.BURNOUT_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Доля сотрудников с повышенным риском выгорания снизилась с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    }

    // Сценарий 7 намеренно не описан отдельным элементом: если ни один
    // из перечисленных выше не подошел, .find() в buildBurnoutInsight_
    // вернет undefined, и функция вернет null — без текста об
    // отсутствии значимых изменений.

  ],

  /**
   * Инсайт по риску ухода. Полностью аналогичен buildBurnoutInsight_ —
   * тот же шаблон (context builder + приоритетный массив сценариев +
   * .find), только другая формулировка текста и своя константа порога
   * (TURNOVER_DELTA_THRESHOLD). Принимает не reportData, а только уже
   * агрегированные риск-категории — { lowRisk, highRisk, unsure } с
   * { percent2026, percent2025, delta } (та же агрегация, что уже
   * используется в KPI-блоке "Риск ухода"). "unsure" ("Затруднились"),
   * если появится в данных, игнорируется — см. buildTurnoverContext_.
   *
   * null, если ни один сценарий не подошел (Сценарий 7 — намеренно без
   * текста "изменения незначительны").
   */
  buildTurnoverRiskInsight_(turnoverCategories) {

    const context = this.buildTurnoverContext_(turnoverCategories);

    if (!context) {
      return null;
    }

    const scenario = this.TURNOVER_SCENARIOS_.find(candidate => candidate.matches(context));

    return scenario ? scenario.describe(context) : null;

  },

  /**
   * Извлечь из агрегированных риск-категорий ухода плоский контекст для
   * сценариев — только lowRisk/highRisk (percent2026/percent2025/delta).
   * "unsure" ("Затруднились") намеренно не попадает в контекст — как и в
   * buildBurnoutContext_, она может присутствовать в данных, но не
   * должна влиять на формулировки.
   *
   * null, если сравнивать не с чем: агрегированные категории не переданы
   * либо у lowRisk/highRisk нет delta (нет данных 2025).
   */
  buildTurnoverContext_(turnoverCategories) {

    if (!turnoverCategories) {
      return null;
    }

    const lowRisk = turnoverCategories.lowRisk;
    const highRisk = turnoverCategories.highRisk;

    if (!lowRisk || !highRisk ||
        lowRisk.delta === null || lowRisk.delta === undefined ||
        highRisk.delta === null || highRisk.delta === undefined) {
      return null;
    }

    return {
      lowOld: lowRisk.percent2025,
      lowNew: lowRisk.percent2026,
      lowDelta: lowRisk.delta,
      highOld: highRisk.percent2025,
      highNew: highRisk.percent2026,
      highDelta: highRisk.delta
    };

  },

  /**
   * Сценарии инсайта по риску ухода, по порядку — первый подошедший
   * побеждает (см. buildTurnoverRiskInsight_). Объединенные сценарии
   * "снизился"/"вырос" идут первыми, поэтому имеют приоритет над
   * одиночными сценариями 1-4 — тот же принцип, что и в
   * BURNOUT_SCENARIOS_.
   */
  TURNOVER_SCENARIOS_: [

    {
      // Сценарий 5: низкий риск вырос И повышенный риск снизился —
      // заменяет сценарии 1 и 4.
      matches(context) {
        return context.lowDelta >= Insights.TURNOVER_DELTA_THRESHOLD &&
          context.highDelta <= -Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Риск ухода снизился: доля сотрудников, не рассматривающих смену работы, выросла с " +
          context.lowOld + "% до " + context.lowNew + "%, а рассматривающих уход снизилась с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 6: низкий риск снизился И повышенный риск вырос —
      // заменяет сценарии 2 и 3.
      matches(context) {
        return context.lowDelta <= -Insights.TURNOVER_DELTA_THRESHOLD &&
          context.highDelta >= Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Риск ухода вырос: доля сотрудников, не рассматривающих смену работы, снизилась с " +
          context.lowOld + "% до " + context.lowNew + "%, а рассматривающих уход выросла с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 1: низкий риск вырос (без учета повышенного риска).
      matches(context) {
        return context.lowDelta >= Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Риск ухода остается низким: доля сотрудников, не рассматривающих смену работы, выросла с " +
          context.lowOld + "% до " + context.lowNew + "%.";
      }
    },

    {
      // Сценарий 2: низкий риск снизился.
      matches(context) {
        return context.lowDelta <= -Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Доля сотрудников, не рассматривающих смену работы, снизилась с " +
          context.lowOld + "% до " + context.lowNew + "%.";
      }
    },

    {
      // Сценарий 3: повышенный риск вырос.
      matches(context) {
        return context.highDelta >= Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Увеличилась доля сотрудников, рассматривающих смену работы: с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    },

    {
      // Сценарий 4: повышенный риск снизился.
      matches(context) {
        return context.highDelta <= -Insights.TURNOVER_DELTA_THRESHOLD;
      },
      describe(context) {
        return "Снизилась доля сотрудников, рассматривающих смену работы: с " +
          context.highOld + "% до " + context.highNew + "%.";
      }
    }

    // Сценарий 7 намеренно не описан отдельным элементом: если ни один
    // из перечисленных выше не подошел, .find() в
    // buildTurnoverRiskInsight_ вернет undefined, и функция вернет null.

  ]

};
