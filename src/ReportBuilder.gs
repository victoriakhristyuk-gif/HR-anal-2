/**
 * ==========================================================
 * Построение отчета
 * ==========================================================
 */

const ReportBuilder = {

  // Порог нерепрезентативности выборки (UX-правило проекта, не
  // статистический расчет). При сравнении проверяется меньшая из
  // выборок 2026/2025 — именно она ограничивает надежность сравнения.
  SMALL_SAMPLE_THRESHOLD: 5,

  // UX-пороги для подсветки динамики (эвристика для визуального
  // выделения "заметных" изменений, НЕ статистическая значимость).
  // Значения относятся к предметной области отчета, поэтому живут
  // здесь, а не в Formatter — Formatter только умеет красить диапазон
  // по переданному порогу, не зная, откуда порог взялся.
  DELTA_THRESHOLD_RATING: 0.3,   // средние оценки (шкала 1-5), баллы
  DELTA_THRESHOLD_PERCENT: 5,    // eNPS/распределения/Top-5, п.п.

  // Ключ developer metadata, которым лист-отчет помечается сигнатурой
  // своих параметров построения (источник + сравнение + фильтры).
  // Позволяет находить "тот же" отчет независимо от его названия.
  REPORT_KEY_METADATA_KEY: "hranalytics_report_key",

  createReport(reportData, reportName, isCustomName) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reportKey = this.getReportKey_(reportData);
    const existingSheet = this.findReportSheetByKey_(ss, reportKey);

    let sheet;

    if (existingSheet) {

      // Отчет с такими же параметрами уже существует. Вместо очистки
      // контента на месте (sheet.clear() не удаляет графики, группировку
      // строк и другие структуры листа) — лист удаляется целиком и сразу
      // пересоздается на том же месте с тем же именем: весь "мусор"
      // предыдущих версий гарантированно исчезает вместе со старым листом.
      const existingIndex = existingSheet.getIndex() - 1; // getIndex() 1-based, insertSheet(index) 0-based

      // Пользовательское название не участвует в поиске отчета (сигнатура
      // строится только по source/comparison/filters, см. getReportKey_).
      // Если оно не задано — сохраняем текущее имя листа как есть.
      const finalName = isCustomName ? reportName : existingSheet.getName();

      ss.deleteSheet(existingSheet);
      sheet = ss.insertSheet(this.getUniqueSheetName(ss, finalName), existingIndex);

    } else {
      sheet = ss.insertSheet(this.getUniqueSheetName(ss, reportName));
    }

    // Сигнатура прикрепляется к листу заново в обоих случаях — при
    // удалении листа его developer metadata удаляется вместе с ним.
    sheet.addDeveloperMetadata(this.REPORT_KEY_METADATA_KEY, reportKey);

    Formatter.applyBaseFont(sheet.getRange("A1:F50"));
    Formatter.setColumnWidths(sheet, [320, 110, 110, 110, 110, 110]);

    // ctx.row — "курсор" текущей свободной строки. Каждый render-метод
    // дописывает свой блок начиная с ctx.row и сам сдвигает его дальше,
    // поэтому блоки верхней части листа можно переставлять местами, не
    // пересчитывая номера строк вручную.
    const ctx = { sheet: sheet, row: 1 };

    this.renderHeader_(ctx);
    this.renderPassport_(ctx, reportData);
    this.renderSampleWarning_(ctx, reportData);

    // Замораживаем строки заголовка/паспорта/предупреждения (без
    // хвостовой пустой строки-разделителя) — они остаются на виду при
    // прокрутке остальной, гораздо более длинной, части отчета.
    const frozenRows = ctx.row - 1;

    // Порядок разделов отчета (см. также ReportSections.gs):
    // Executive Summary → Ключевые показатели (eNPS) → Состав выборки →
    // Удовлетворенность работой и оплатой → Риски → Культура →
    // Средние оценки (с вложенными Офис/Бенефиты) → Сырые данные.
    // Заголовки крупных разделов идут подряд, без пустых строк между
    // ними (пустые строки внутри самих разделов не затрагиваются).
    this.renderExecutiveSummary_(ctx, reportData);
    this.renderKeyIndicators_(ctx, reportData);
    this.renderDetailedAnalyticsBefore_(ctx, reportData);
    this.renderAverageOverviewSection_(ctx, reportData);
    this.renderRawData_(ctx, reportData);

    Formatter.freezeHeader(sheet, frozenRows, 0);

    return sheet;

  },

  /**
   * Заголовок отчета: всегда точно название листа (sheet.getName()) —
   * единственный источник для обоих; заголовок ничего не строит
   * самостоятельно, чтобы не дублировать логику именования и не
   * рисковать расхождением с реальным именем листа (в т.ч. с
   * уникализирующим суффиксом "_2" и т.п., см. getUniqueSheetName, и с
   * пользовательским названием отчета).
   */
  renderHeader_(ctx) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue(sheet.getName());
    Formatter.formatMainTitle(sheet.getRange(ctx.row, 1));

    ctx.row += 1;

  },

  /**
   * Паспорт выборки: источник, примененные фильтры, размер(ы) выборки.
   */
  renderPassport_(ctx, reportData) {

    const sheet = ctx.sheet;

    const activeFilters = reportData.filters
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.formatFilterForPassport(filter));

    const filtersText = activeFilters.length > 0
      ? activeFilters.join("; ")
      : "без фильтров";

    sheet.getRange(ctx.row, 1).setValue(
      "Источник: " + reportData.source + " · Фильтры: " + filtersText
    );
    ctx.row += 1;

    const sampleText = reportData.comparison
      ? "Размер выборки: 2026 — n=" + reportData.employees +
        "; 2025 — n=" + reportData.comparison.employees2025
      : "Размер выборки: n=" + reportData.employees;

    sheet.getRange(ctx.row, 1).setValue(sampleText);
    ctx.row += 1;

    ctx.row += 1; // пустая строка-разделитель

  },

  /**
   * Предупреждение о нерепрезентативной выборке (n < порога). Данные
   * при этом не скрываются — баннер только привлекает внимание.
   */
  renderSampleWarning_(ctx, reportData) {

    const sheet = ctx.sheet;

    const minSample = reportData.comparison
      ? Math.min(reportData.employees, reportData.comparison.employees2025)
      : reportData.employees;

    if (minSample >= this.SMALL_SAMPLE_THRESHOLD) {
      return;
    }

    const range = sheet.getRange(ctx.row, 1, 1, 3);

    range.setValue(
      "⚠ Выборка нерепрезентативна (n=" + minSample + " < " + this.SMALL_SAMPLE_THRESHOLD +
      ") — данные приведены, но интерпретируйте их с осторожностью"
    );
    Formatter.formatWarningBanner(range);

    ctx.row += 1;
    ctx.row += 1; // пустая строка-разделитель

  },

  /**
   * Executive Summary — компактное текстовое представление уже
   * посчитанных данных (eNPS, средние оценки, их динамика), без
   * новых показателей и без новой аналитики. Состав зафиксирован
   * макетом V3.
   */
  renderExecutiveSummary_(ctx, reportData) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue("Short Summary");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    sheet.getRange(ctx.row, 1).setValue(this.buildEnpsSummaryLine_(reportData));
    ctx.row += 1;

    const sortedDesc = reportData.averageRatings.slice().sort((a, b) => b.average - a.average);
    const sortedAsc = reportData.averageRatings.slice().sort((a, b) => a.average - b.average);

    sheet.getRange(ctx.row, 1).setValue(
      "Самые высокие показатели: " + this.formatRatingList_(sortedDesc.slice(0, 3))
    );
    ctx.row += 1;

    sheet.getRange(ctx.row, 1).setValue(
      "Самые низкие показатели: " + this.formatRatingList_(sortedAsc.slice(0, 3))
    );
    ctx.row += 1;

    if (reportData.comparison) {
      sheet.getRange(ctx.row, 1).setValue(this.buildDynamicsSummaryLine_(reportData));
      ctx.row += 1;
    }

  },

  /**
   * "Вопрос — X.X   Вопрос2 — X.X" для списка средних оценок
   */
  formatRatingList_(items) {
    return items.map(item => item.question + " — " + item.average).join("   ");
  },

  /**
   * Строка eNPS для Executive Summary: значение (+ динамика к 2025,
   * если сравнение включено).
   */
  buildEnpsSummaryLine_(reportData) {

    const enps = reportData.enps.enps;

    if (!reportData.comparison) {
      return "eNPS: " + enps;
    }

    const comparisonEnps = reportData.comparison.enps;

    if (comparisonEnps.delta === null || comparisonEnps.value2025 === null) {
      return "eNPS: " + enps + " (нет данных 2025 для сравнения)";
    }

    return "eNPS: " + enps + " (" + this.formatSignedDelta_(comparisonEnps.delta, " п.п.") +
      " к 2025: " + comparisonEnps.value2025 + ")";

  },

  /**
   * Строка "Динамика" для Executive Summary: eNPS + самые заметные
   * изменения средних оценок (выше UX-порога DELTA_THRESHOLD_RATING).
   * Если ни один вопрос порог не превышает — явный текст об этом,
   * а не подобранное "на всякий случай" значение.
   */
  buildDynamicsSummaryLine_(reportData) {

    const movers = reportData.comparison.averageRatings
      .filter(item => item.delta !== null && Math.abs(item.delta) >= this.DELTA_THRESHOLD_RATING)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (movers.length === 0) {
      return "Динамика: существенных изменений в средних оценках не выявлено";
    }

    const top = movers.slice(0, 3)
      .map(item => item.question + " " + this.formatSignedDelta_(item.delta, ""))
      .join("   ");

    return "Динамика: " + top;

  },

  /**
   * Текстовое представление дельты со стрелкой и знаком (для строк
   * Executive Summary, которые пишутся обычным текстом, а не через
   * Formatter.applyDeltaNumberFormat — там нет числовой ячейки).
   */
  formatSignedDelta_(delta, suffix) {

    const arrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "–");
    const sign = delta > 0 ? "+" : "";

    return arrow + " " + sign + delta + suffix;

  },

  /**
   * Число с явным знаком в тексте (не стрелка, не Δ) — отрицательное
   * значение и так печатается со знаком "-", здесь только добавляется
   * "+" для положительного (ноль — без знака). Для значений вроде eNPS
   * за прошлый год, которые пишутся строкой (например, "(2025: +59)"),
   * а не отдельной числовой ячейкой с number format.
   */
  formatSignedInt_(value) {
    return value > 0 ? "+" + value : String(value);
  },

  /**
   * Ключевые показатели: eNPS-карточка — главный KPI отчета. "Средние
   * оценки — обзор" сюда больше не входит (см. createReport) — это
   * отдельный раздел, расположенный после "Культура" по новой структуре
   * отчета.
   */
  renderKeyIndicators_(ctx, reportData) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue("КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    this.renderEnpsIndicator_(ctx, reportData);

  },

  // Эмодзи/подписи категорий eNPS — единственное место, где сопоставляются
  // ключи Statistics.calculateENPS/Comparison.compareEnpsCategories_
  // ("promoters"/"neutrals"/"detractors") и их отображение.
  ENPS_CATEGORY_META_: {
    promoters: { emoji: "🟢", label: "Промоутеры" },
    neutrals: { emoji: "🟡", label: "Нейтралы" },
    detractors: { emoji: "🔴", label: "Критики" }
  },

  /**
   * eNPS — главный KPI отчета, оформлен как остальные компактные блоки:
   * заголовок "⭐ eNPS" → крупное жирное значение eNPS + Δ справа (то же
   * форматирование Δ, что и у KPI разделов средних оценок/риск-блоков) +
   * справочное значение "(2025: N)" мелким серым текстом (muted small) →
   * разделитель → детальный список категорий (эмодзи + название +
   * "кол-во (%)" + компактный progress bar — переиспользуется
   * renderCompactAnswerList_ с hasComparison=false, без своих Δ и своей
   * строки "2025:", т.к. они здесь не нужны на уровне категорий) →
   * итоговая строка "2025:" с агрегированными процентами категорий
   * (muted small, только эмодзи — без названий, по макету).
   * Ничего не пересчитывает — использует готовые
   * reportData.enps/reportData.comparison.enps.
   */
  renderEnpsIndicator_(ctx, reportData) {

    const sheet = ctx.sheet;
    const enps = reportData.enps;
    const comparisonEnps = reportData.comparison ? reportData.comparison.enps : null;
    const categories = ["promoters", "neutrals", "detractors"];

    sheet.getRange(ctx.row, 1).setValue("⭐ eNPS");
    Formatter.formatLabel(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    const valueCell = sheet.getRange(ctx.row, 1);
    valueCell.setValue(enps.enps);
    Formatter.formatHighlightNumber(valueCell);
    Formatter.applySignedIntegerFormat(valueCell);

    if (comparisonEnps && comparisonEnps.delta !== null && comparisonEnps.delta !== undefined) {
      const deltaCell = sheet.getRange(ctx.row, 2);
      deltaCell.setValue(comparisonEnps.delta);
      deltaCell.setFontWeight("bold");
      Formatter.applyCompactDeltaNumberFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, comparisonEnps.delta, "up");
    }

    if (comparisonEnps && comparisonEnps.value2025 !== null && comparisonEnps.value2025 !== undefined) {
      const value2025Cell = sheet.getRange(ctx.row, 3);
      value2025Cell.setValue("(2025: " + this.formatSignedInt_(comparisonEnps.value2025) + ")");
      Formatter.formatMutedSmall(value2025Cell);
    }

    Formatter.addBottomBorder(sheet.getRange(ctx.row, 1, 1, 3), "#cccccc");
    ctx.row += 1;

    const comparisonByCategory = {};
    if (comparisonEnps) {
      comparisonEnps.categories.forEach(item => { comparisonByCategory[item.category] = item; });
    }

    const items = categories.map(category => ({
      answer: category,
      count2026: enps[category],
      percent2026: enps[category + "Percent"]
    }));

    this.renderCompactAnswerList_(
      ctx, items, false,
      category => this.ENPS_CATEGORY_META_[category].emoji + " " + this.ENPS_CATEGORY_META_[category].label
    );

    if (comparisonEnps) {

      const summary = categories
        .map(category => {

          const cmp = comparisonByCategory[category];
          const value = (cmp && cmp.percent2025 !== null && cmp.percent2025 !== undefined)
            ? cmp.count2025 + " (" + cmp.percent2025 + "%)"
            : "н/д";

          return this.ENPS_CATEGORY_META_[category].emoji + " " + value;

        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue("2025: " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Обзор средних оценок сгруппирован по смысловым разделам анкеты (см.
   * AVERAGE_SCORE_GROUPS_), а не единой таблицей на все rating5-вопросы:
   * для каждого раздела — KPI "Средняя оценка раздела" (среднее уже
   * посчитанных per-question средних, не новый расчет по сырым данным),
   * затем тот же ранжированный список (медаль/номер + большая жирная
   * оценка + Δ), что и в остальных блоках отчета. Источник данных —
   * buildAverageOverviewRows_ (не меняется), только группировка и
   * отображение.
   */
  renderAverageOverview_(ctx, reportData) {

    const sheet = ctx.sheet;
    const hasComparison = !!reportData.comparison;
    const rows = this.buildAverageOverviewRows_(reportData);
    const coverageByQuestion = this.buildAverageCoverageInfo_(reportData);

    const byQuestion = {};
    rows.forEach(row => { byQuestion[row.question] = row; });

    sheet.getRange(ctx.row, 1).setValue("Средние оценки");
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;
    ctx.row += 1; // пустая строка-разделитель

    Object.keys(this.AVERAGE_SCORE_GROUPS_).forEach(groupName => {

      const group = this.AVERAGE_SCORE_GROUPS_[groupName];

      const groupRows = group.questions
        .map(title => byQuestion[title])
        .filter(Boolean)
        .sort((a, b) => (b.value2026 ?? -Infinity) - (a.value2026 ?? -Infinity));

      if (groupRows.length === 0) {
        return;
      }

      this.renderAverageScoreGroup_(ctx, groupName, group.icon, groupRows, hasComparison, coverageByQuestion);
      ctx.row += 1; // пустая строка-разделитель между разделами

    });

    // Группировка строк здесь не создается — этот блок не заканчивается
    // здесь: "Офис"/"Бенефиты" рендерятся сразу следом (см.
    // renderAverageOverviewSection_) и должны попасть в ту же, одну общую
    // группу "Средние оценки", а не оказаться вне ее.

  },

  /**
   * "Средние оценки" вместе с вложенными в нее детальными разделами
   * "Офис"/"Бенефиты" (последние две секции ReportSections.sections —
   * см. renderDetailedAnalyticsAfter_). Содержимое и логика сворачивания
   * самих разделов не меняются: "Офис"/"Бенефиты" по-прежнему
   * группируются каждый сам по себе (renderSection_). Здесь же вся
   * объединенная область — от строки сразу после заголовка "Средние
   * оценки" до последней строки "Бенефиты" — оборачивается ОДНОЙ
   * дополнительной группой; поскольку "Офис"/"Бенефиты" уже входят в
   * нее как во вложенный диапазон, Google Sheets автоматически поднимает
   * их группы на уровень глубже — они становятся визуально и
   * структурно вложенными подразделами "Средних оценок", без изменения
   * их собственного содержимого.
   */
  renderAverageOverviewSection_(ctx, reportData) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;

    this.renderAverageOverview_(ctx, reportData);
    this.renderDetailedAnalyticsAfter_(ctx, reportData);

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Подпись строки охвата ("Не пользовались"/"Не участвовали"/...) для
   * вопросов rating5, у которых есть вариант ответа "не пользовался" —
   * по конкретному смыслу вопроса, а не общей формулировкой (аналогично
   * YES_NO_SUMMARIES_/RISK_QUESTIONS_). Вопрос без записи здесь просто
   * не получает вторую строку (см. buildAverageCoverageInfo_) — сюда
   * попадают только rating5-вопросы из AVERAGE_SCORE_GROUPS_, у которых
   * в каталоге (Questions.gs) реально есть ответ "не пользовался"
   * ("Задачи 2"/"ЗП" его не имеют и поэтому не перечислены).
   *
   * Значение — объект (не голая строка), т.к. это по сути мини-конфигурация
   * на вопрос, а не просто словарь подписей: например, buildAverageCoverageInfo_
   * сейчас ищет в распределении ответ "не пользовался" одним и тем же
   * жестко заданным текстом для всех вопросов — если в будущем появится
   * вопрос с другой формулировкой "неучастия" (например, "нет опыта"),
   * сюда достаточно будет добавить свое поле у нужной записи, не меняя
   * форму остальных.
   */
  AVERAGE_COVERAGE_CONFIG_: {
    "Рабочий стол": { label: "Не пользовались" },
    "Рабочее кресло": { label: "Не пользовались" },
    "Расположение рабочего места": { label: "Не пользовались" },
    "Офисное пространство": { label: "Не пользовались" },
    "Отдых в офисе": { label: "Не пользовались" },
    "Переговорки": { label: "Не пользовались" },
    "Питание и возможность перекусить, выпить чай, кофе": { label: "Не пользовались" },
    "Атмосфера в офисе": { label: "Не были в офисе" },
    "Рабочая техника": { label: "Не пользовались" },
    "Корпоративы": { label: "Не участвовали" },
    "Обучение": { label: "Не участвовали" },
    "Курсы английского": { label: "Не пользовались" },
    "ДМС": { label: "Не пользовались" },
    "Мерч за достижения": { label: "Не оценили" }
  },

  /**
   * Собрать для каждого сконфигурированного вопроса (AVERAGE_COVERAGE_CONFIG_)
   * количество/процент варианта ответа "не пользовался" — берется из уже
   * посчитанного reportData.distributions/reportData.comparison.distributions
   * (Statistics.calculateDistribution/Comparison.compareDistributions),
   * новых расчетов нет, только поиск нужного варианта ответа в уже
   * готовом распределении. Вопрос отсутствует в результате, если у него
   * нет записи в AVERAGE_COVERAGE_CONFIG_, либо в его распределении нет
   * варианта "не пользовался", либо для него нет данных (count/percent
   * null/undefined).
   */
  buildAverageCoverageInfo_(reportData) {

    const hasComparison = !!reportData.comparison;
    const distributions = hasComparison ? reportData.comparison.distributions : reportData.distributions;

    const byQuestionTitle = {};
    distributions.forEach(entry => { byQuestionTitle[entry.question.title] = entry; });

    const coverage = {};

    Object.keys(this.AVERAGE_COVERAGE_CONFIG_).forEach(title => {

      const entry = byQuestionTitle[title];

      if (!entry) {
        return;
      }

      const item = entry.items.find(candidate => candidate.answer === "не пользовался");

      if (!item) {
        return;
      }

      const count = hasComparison ? item.count2026 : item.count;
      const percent = hasComparison ? item.percent2026 : item.percent;

      // Строка не показывается, если вариант отсутствует, либо никто
      // его не выбрал (count 0) или его доля округлилась до 0% — иначе
      // она только засоряет отчет строками вида "Не пользовались: 0 (0%)".
      if (!count || percent === 0) {
        return;
      }

      coverage[title] = {
        label: this.AVERAGE_COVERAGE_CONFIG_[title].label,
        count: count,
        percent: percent
      };

    });

    return coverage;

  },

  /**
   * Разделы для группировки блока "Средние оценки — обзор" —
   * принадлежность вопроса к разделу определяется исключительно этой
   * картой (без if по названиям вопросов). Порядок вопросов внутри
   * массива значения не имеет — итоговый порядок в разделе всегда
   * пересортировывается по убыванию 2026 (см. renderAverageOverview_).
   */
  AVERAGE_SCORE_GROUPS_: {

    "Офис": {
      icon: "🏢",
      questions: [
        "Рабочий стол", "Рабочее кресло", "Расположение рабочего места",
        "Офисное пространство", "Отдых в офисе", "Переговорки",
        "Питание и возможность перекусить, выпить чай, кофе",
        "Атмосфера в офисе", "Рабочая техника"
      ]
    },

    "Бенефиты": {
      icon: "🎁",
      questions: ["Корпоративы", "Обучение", "Курсы английского", "ДМС", "Мерч за достижения"]
    },

    "Вознаграждение": {
      icon: "💰",
      questions: ["ЗП"]
    }

  },

  /**
   * Один раздел обзора средних оценок: заголовок (иконка + название) →
   * KPI "Средняя оценка раздела" (пропускается, если в разделе всего
   * один вопрос — см. AVERAGE_SCORE_GROUPS_["Вознаграждение"], иначе это
   * было бы дублированием единственного показателя) → разделитель →
   * ранжированный список вопросов раздела (медаль/номер, большая жирная
   * оценка, Δ справа — тот же стиль, что и у "⭐ Средняя оценка" внутри
   * вопроса и у KPI-карточек риск-блока/Да-Нет).
   */
  renderAverageScoreGroup_(ctx, groupName, icon, groupRows, hasComparison, coverageByQuestion) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue(icon + " " + groupName);
    Formatter.formatLabel(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    if (groupRows.length > 1) {
      this.renderAverageScoreGroupKpi_(ctx, groupRows, hasComparison);
    }

    groupRows.forEach(row => {
      this.renderAverageScoreRankItem_(ctx, row, hasComparison, coverageByQuestion[row.question]);
    });

  },

  /**
   * KPI "Средняя оценка раздела": среднее значение value2026 (и, при
   * сравнении, value2025 → Δ) уже посчитанных per-question средних
   * группы — простое агрегирование готовых чисел, без обращения к
   * Statistics/Comparison. null, если хотя бы у одного вопроса группы
   * нет value2025 (нет данных 2025 по нему) — тогда для среднего 2025
   * раздела оно тоже не считается. Подпись и значение — одна строка:
   * "Средняя оценка раздела" (col1) | значение (+"(2025: ...)" той же
   * ячейкой, см. setKpiValueWithPreviousYear_) (col2) | Δ (col3).
   */
  renderAverageScoreGroupKpi_(ctx, groupRows, hasComparison) {

    const sheet = ctx.sheet;
    const average = values => +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);

    sheet.getRange(ctx.row, 1).setValue("Средняя оценка раздела");

    const value2026 = average(groupRows.map(row => row.value2026));
    const allHave2025 = hasComparison && groupRows.every(row => row.value2025 !== null && row.value2025 !== undefined);

    const valueCell = sheet.getRange(ctx.row, 2);

    if (allHave2025) {

      const value2025 = average(groupRows.map(row => row.value2025));
      const delta = +(value2026 - value2025).toFixed(2);

      // "4,52 (2025: 4,49)" одной ячейкой — воспринимается как единый
      // KPI, а не три независимых элемента; Δ — соседней ячейкой справа.
      this.setKpiValueWithPreviousYear_(valueCell, value2026, value2025);

      const deltaCell = sheet.getRange(ctx.row, 3);
      deltaCell.setValue(delta);
      Formatter.applyCompactDeltaTwoDecimalFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, delta, "up");

    } else {
      valueCell.setValue(value2026);
      Formatter.formatHighlightNumber(valueCell);
    }

    ctx.row += 1;

    Formatter.addBottomBorder(sheet.getRange(ctx.row - 1, 1, 1, 3), "#cccccc");
    ctx.row += 1; // пустая строка-разделитель перед ранжированным списком

  },

  /**
   * Один пункт списка средних оценок — одна строка, без места в
   * рейтинге (сортировка по убыванию 2026 сохраняется, просто не
   * отображается номером/медалью): название (жирный, вся ячейка) |
   * оценка (жирный, обычный размер — без formatHighlightNumber, по весу
   * как count(%) в остальных компактных блоках), с прошлогодней оценкой
   * в скобках после нее той же ячейкой (серым, обычным начертанием, без
   * изменения высоты строки — см. buildRatingWithPreviousYear_) | Δ
   * (числовая ячейка с двумя знаками после запятой — Formatter.
   * applyCompactDeltaTwoDecimalFormat/setDeltaFontColor; средние оценки
   * сами показываются с точностью до сотых, поэтому и Δ здесь с двумя
   * знаками, а не с одним, как в большинстве других компактных блоков).
   * Взгляд читает строку
   * слева направо: вопрос → оценка → изменение. Значения/Δ берутся из
   * уже посчитанных reportData.averageRatings/comparison.averageRatings
   * (buildAverageOverviewRows_), никаких новых вычислений.
   *
   * Если для вопроса есть coverageInfo (см. buildAverageCoverageInfo_) —
   * сразу под строкой добавляется вторая, менее заметная строка охвата
   * ("Не пользовались: 298 (71%)"): мелкий серый неполужирный текст,
   * ширина блока не меняется (текст остается в первой колонке).
   */
  renderAverageScoreRankItem_(ctx, row, hasComparison, coverageInfo) {

    const sheet = ctx.sheet;
    const itemRow = ctx.row;

    sheet.getRange(itemRow, 1).setValue(row.question);
    Formatter.formatLabel(sheet.getRange(itemRow, 1));

    const valueCell = sheet.getRange(itemRow, 2);

    if (hasComparison && row.value2025 !== null && row.value2025 !== undefined &&
        row.value2026 !== null && row.value2026 !== undefined) {
      this.setRatingWithPreviousYear_(valueCell, row.value2026, row.value2025);
    } else {
      valueCell.setValue(row.value2026 !== null && row.value2026 !== undefined ? row.value2026 : "н/д");
      valueCell.setFontWeight("bold");
    }

    if (hasComparison && row.delta !== null && row.delta !== undefined) {

      const deltaCell = sheet.getRange(itemRow, 3);
      deltaCell.setValue(row.delta);
      deltaCell.setFontWeight("bold");
      Formatter.applyCompactDeltaTwoDecimalFormat(deltaCell);
      Formatter.setDeltaFontColor(deltaCell, row.delta, "up");

    }

    ctx.row += 1;

    if (coverageInfo) {

      const coverageText = coverageInfo.percent !== null && coverageInfo.percent !== undefined
        ? coverageInfo.count + " (" + coverageInfo.percent + "%)"
        : coverageInfo.count + " (н/д)";

      const coverageCell = sheet.getRange(ctx.row, 1);
      coverageCell.setValue(coverageInfo.label + ": " + coverageText);
      Formatter.formatMutedSmall(coverageCell);

      ctx.row += 1;

    }

  },

  /**
   * Записать в одну ячейку "value2026 (value2025)" — текущая оценка
   * жирным (как и раньше), прошлогодняя в скобках рядом, серым, обычным
   * (не жирным) начертанием, тем же размером шрифта — визуально
   * второстепенная справочная информация в той же строке, без
   * увеличения ее высоты. Разные стили внутри одной ячейки требуют
   * RichTextValue (setFontWeight/setValue на весь Range тут не подходят
   * — они красят ячейку целиком одним стилем).
   */
  setRatingWithPreviousYear_(cell, value2026, value2025) {

    const currentText = this.formatRatingValue_(value2026);
    const previousText = " (" + this.formatRatingValue_(value2025) + ")";
    const fullText = currentText + previousText;

    const richText = SpreadsheetApp.newRichTextValue()
      .setText(fullText)
      .setTextStyle(0, currentText.length, SpreadsheetApp.newTextStyle().setBold(true).build())
      .setTextStyle(
        currentText.length, fullText.length,
        SpreadsheetApp.newTextStyle().setBold(false).setForegroundColor(Formatter.DELTA_NEUTRAL_COLOR).build()
      )
      .build();

    cell.setRichTextValue(richText);

  },

  /**
   * Средняя оценка (шкала 1-5) как текст с запятой в качестве
   * десятичного разделителя ("4,69") — нужно там, где значение
   * записывается вручную как часть строки (RichTextValue), а не как
   * число в отдельной ячейке, где разделитель проставляет сама таблица
   * по локали.
   */
  formatRatingValue_(value) {
    return String(value).replace(".", ",");
  },

  /**
   * То же самое, что setRatingWithPreviousYear_, но для KPI "Средняя
   * оценка раздела" — значение крупным жирным (18pt, как
   * Formatter.formatHighlightNumber), "(2025: X)" рядом мелким серым
   * (как Formatter.formatMutedSmall), в той же ячейке — строка читается
   * как единый показатель, а не три независимых элемента. Δ остается
   * соседней ячейкой, здесь не участвует.
   */
  setKpiValueWithPreviousYear_(cell, value2026, value2025) {

    const currentText = this.formatRatingValue_(value2026);
    const previousText = " (2025: " + this.formatRatingValue_(value2025) + ")";
    const fullText = currentText + previousText;

    const richText = SpreadsheetApp.newRichTextValue()
      .setText(fullText)
      .setTextStyle(
        0, currentText.length,
        SpreadsheetApp.newTextStyle().setBold(true).setFontSize(18).build()
      )
      .setTextStyle(
        currentText.length, fullText.length,
        SpreadsheetApp.newTextStyle().setBold(false).setFontSize(9).setForegroundColor(Formatter.DELTA_NEUTRAL_COLOR).build()
      )
      .build();

    cell.setRichTextValue(richText);

  },

  /**
   * Подготовить строки для обзора средних оценок: вопрос, значение
   * 2026[, 2025, дельта], отсортировано по убыванию 2026. Источник —
   * уже посчитанные reportData.averageRatings /
   * reportData.comparison.averageRatings, новых расчетов нет.
   */
  buildAverageOverviewRows_(reportData) {

    if (reportData.comparison) {

      return reportData.comparison.averageRatings
        .map(item => ({
          question: item.question,
          value2026: item.value2026,
          value2025: item.value2025,
          delta: item.delta
        }))
        .sort((a, b) => (b.value2026 ?? -Infinity) - (a.value2026 ?? -Infinity));

    }

    return reportData.averageRatings
      .map(item => ({ question: item.question, value2026: item.average, value2025: null, delta: null }))
      .sort((a, b) => b.value2026 - a.value2026);

  },

  /**
   * Первая группа смысловых секций анкеты (ReportSections.gs) — идут до
   * блока "Средние оценки" по новому порядку разделов отчета (см.
   * createReport): "Состав выборки", "Удовлетворенность работой и
   * оплатой", "Риски", "Культура" — первые четыре записи
   * ReportSections.sections. Без общего заголовка-обертки — каждая
   * секция теперь самостоятельный раздел верхнего уровня.
   */
  renderDetailedAnalyticsBefore_(ctx, reportData) {

    ReportSections.validate();

    const hasComparison = !!reportData.comparison;
    const lookups = this.buildDetailLookups_(reportData);
    const sections = ReportSections.getSections();

    this.renderSectionsRange_(ctx, sections.slice(0, 4), lookups, hasComparison);

  },

  /**
   * Вторая группа смысловых секций анкеты — "Офис"/"Бенефиты", идут
   * после блока "Средние оценки" (последние две записи
   * ReportSections.sections). См. renderDetailedAnalyticsBefore_.
   */
  renderDetailedAnalyticsAfter_(ctx, reportData) {

    const hasComparison = !!reportData.comparison;
    const lookups = this.buildDetailLookups_(reportData);
    const sections = ReportSections.getSections();

    this.renderSectionsRange_(ctx, sections.slice(4), lookups, hasComparison);

  },

  /**
   * Отрендерить последовательность секций анкеты — общая часть
   * renderDetailedAnalyticsBefore_/renderDetailedAnalyticsAfter_. Секции
   * отличаются только составом вопросов и заголовком, поэтому рендерятся
   * одним и тем же методом (renderSection_), а не отдельной функцией на
   * каждую. Без пустой строки между секциями — заголовки крупных
   * разделов идут подряд, единым списком.
   */
  renderSectionsRange_(ctx, sections, lookups, hasComparison) {

    sections.forEach(section => {
      this.renderSection_(ctx, section, lookups, hasComparison);
    });

  },

  /**
   * Быстрые словари "вопрос -> уже посчитанные данные" по названию —
   * без повторных расчетов, только группировка того, что уже есть в
   * reportData/reportData.comparison.
   */
  buildDetailLookups_(reportData) {

    const byQuestionTitle = list => {
      const map = {};
      list.forEach(entry => { map[entry.question.title] = entry; });
      return map;
    };

    const averages = {};
    reportData.averageRatings.forEach(item => { averages[item.question] = item; });

    const comparisonAverages = {};
    if (reportData.comparison) {
      reportData.comparison.averageRatings.forEach(item => { comparisonAverages[item.question] = item; });
    }

    return {
      distributions: byQuestionTitle(reportData.distributions),
      comparisonDistributions: reportData.comparison ? byQuestionTitle(reportData.comparison.distributions) : {},
      topAnswers: byQuestionTitle(reportData.topAnswers),
      comparisonTopAnswers: reportData.comparison ? byQuestionTitle(reportData.comparison.topAnswers) : {},
      averages: averages,
      comparisonAverages: comparisonAverages
    };

  },

  /**
   * Одна смысловая секция (например "Офис"): заголовок-саммари в виде
   * сворачиваемой группы, внутри — по очереди все вопросы секции.
   * Заголовок — только название секции, без количества вопросов.
   * section.indent (см. ReportSections.gs — сейчас "Офис"/"Бенефиты")
   * добавляет небольшой отступ слева перед названием — визуально
   * показывает, что секция вложена в "Средние оценки" (сама вложенность
   * группировки строк создается отдельно, см. renderAverageOverviewSection_).
   */
  renderSection_(ctx, section, lookups, hasComparison) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;
    const title = section.indent ? "    " + section.name : section.name;

    sheet.getRange(ctx.row, 1).setValue(title);
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    section.questions.forEach(question => {
      this.renderQuestionBlock_(ctx, question, section, lookups, hasComparison);
    });

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Склонение русского существительного по числу: forms = [1, 2-4, 5+],
   * например ["вопрос", "вопроса", "вопросов"] или ["строка", "строки", "строк"].
   */
  pluralizeRu_(count, forms) {

    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return forms[0];
    }

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return forms[1];
    }

    return forms[2];

  },

  /**
   * Один вопрос внутри секции: инлайн-среднее (только для rating5) +
   * таблица ответов — полное распределение для вопросов-шкал/single,
   * либо топ-ответы для вопросов с display "Топ 5". Единый метод для
   * обоих случаев — различается только источник данных (lookups).
   */
  renderQuestionBlock_(ctx, question, section, lookups, hasComparison) {

    const sheet = ctx.sheet;

    const isTopAnswers = question.display === "Топ 5";

    const entry2026 = isTopAnswers
      ? lookups.topAnswers[question.title]
      : lookups.distributions[question.title];

    const comparisonEntry = isTopAnswers
      ? lookups.comparisonTopAnswers[question.title]
      : lookups.comparisonDistributions[question.title];

    let items = (hasComparison && comparisonEntry)
      ? comparisonEntry.items
      : (entry2026 ? entry2026.items : []).map(item => ({
          answer: item.answer,
          count2026: item.count,
          percent2026: item.percent
        }));

    // Город/Отдел — по частоте (убывание) и без нулевых значений;
    // остальные вопросы сохраняют фиксированный порядок анкеты/шкалы.
    if (section.sortByFrequency.indexOf(question.title) !== -1) {
      items = items
        .filter(item => item.count2026 > 0)
        .slice()
        .sort((a, b) => b.count2026 - a.count2026);
    }

    // "Выгорание"/"Смена работы" (RISK_QUESTIONS_) и вопросы Да/Нет с
    // настроенной сводкой (YES_NO_SUMMARIES_) рендерятся одним и тем же
    // общим блоком "агрегированный KPI + детализация" — см.
    // renderAggregatedAnswerBlock_. Отличаются только конфигурацией
    // группировки/подписей, а не механизмом рендера. Вопрос Да/Нет без
    // записи в YES_NO_SUMMARIES_ безопасно проваливается в обычный путь
    // ниже (компактный список без KPI-карточки, как было раньше).
    const blockConfig = this.getRiskBlockConfig_(question) || this.getYesNoBlockConfig_(question);

    if (blockConfig) {
      this.renderAggregatedAnswerBlock_(ctx, blockConfig, items, hasComparison);
      ctx.row += 1; // разделитель между вопросами
      return;
    }

    sheet.getRange(ctx.row, 1).setValue(question.title);
    Formatter.formatLabel(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    if (question.average) {
      this.renderInlineAverage_(ctx, question, lookups, hasComparison);
    }

    const hasPercent = hasComparison || !isTopAnswers;

    if (question.type === "single") {
      // Город/Отдел/Стаж/Формат работы (единственные вопросы типа
      // "single" в каталоге — см. Questions.gs) — справочные вопросы о
      // составе выборки, не аналитическое сравнение. Полное
      // распределение без таблицы 2026/2025/Δ; Δ оставляем только для
      // Стаж/Формат работы (см. SINGLE_QUESTIONS_WITH_DELTA_) — эти два
      // отражают изменение структуры компании, для Города/Отдела Δ не нужна.
      const showDelta = hasComparison && this.SINGLE_QUESTIONS_WITH_DELTA_.indexOf(question.title) !== -1;
      // "Город" — единственный из четырех, где мелкие города (< порога)
      // сворачиваются в одну строку "Другие города" (см.
      // collapseSmallCities_/SMALL_CITY_THRESHOLD_); Отдел/Стаж/Формат
      // работы выводятся полностью, без изменений.
      const displayItems = question.title === "Город" ? this.collapseSmallCities_(items) : items;
      this.renderReferenceAnswerList_(ctx, displayItems, showDelta);
    } else if (Questions.isYesNoScale(question)) {
      this.renderCompactAnswerList_(ctx, items, hasComparison, answer => this.capitalize_(answer));
    } else if (question.type === "rating5") {
      // В строке "2025:" эмодзи-легенда не дублируется (formatSummaryLabel
      // отдельно от formatLabel) — иначе в мелком справочном тексте она
      // конкурирует за внимание с эмодзи основного (2026) списка.
      this.renderCompactAnswerList_(
        ctx, items, hasComparison,
        answer => this.formatRatingAnswerLabel_(answer),
        answer => answer
      );
    } else if (isTopAnswers) {
      // Все вопросы MULTIPLE (display "Топ 5") автоматически получают
      // рейтинговое отображение — специализированного рендера под
      // конкретный вопрос нет, см. renderRankedAnswerList_.
      this.renderRankedAnswerList_(ctx, items, hasComparison);
    } else {
      this.renderAnswerTable_(ctx, items, hasComparison, hasPercent);
    }

    ctx.row += 1; // разделитель между вопросами

  },

  /**
   * Карта агрегации в риск-категории для вопросов "Выгорание"/"Смена
   * работы" (см. заявленную "ЛОГИКА АГРЕГАЦИИ" макета) — какие варианты
   * ответа складываются в каждую категорию, и как называется/каким
   * эмодзи маркируется сама категория (эмодзи используется только в
   * KPI-карточке и в строке "2025:", детализация ниже — без эмодзи).
   * Числа не пересчитывает — только описывает, как сгруппировать уже
   * посчитанные Statistics/Comparison count/percent/delta по каждому
   * варианту ответа. Приводится к общему для всех агрегированных блоков
   * виду (title/subheading/buckets) функцией getRiskBlockConfig_.
   */
  RISK_QUESTIONS_: {

    "Выгорание": {
      icon: "🔥",
      heading: "Выгорание",
      subheading: "Риск выгорания",
      buckets: [
        { label: "🟢 Низкий риск", answers: ["совсем не чувствовал", "чувствовал редко"], direction: "up" },
        { label: "🔴 Повышенный риск", answers: ["чувствовал регулярно", "чувствовал постоянно и чувствую сейчас"], direction: "down" },
        { label: "⚪ Затруднились", answers: ["затрудняюсь ответить"], direction: "neutral" }
      ]
    },

    "Смена работы": {
      icon: "💼",
      heading: "Риск ухода",
      subheading: null,
      buckets: [
        { label: "🟢 Низкий риск", answers: ["совсем не задумывался", "очень редко, но такие мысли были"], direction: "up" },
        { label: "🔴 Повышенный риск", answers: ["задумывался время от времени", "постоянно и думаю об этом сейчас"], direction: "down" }
      ]
    }

  },

  /**
   * Привести RISK_QUESTIONS_[question.title] к общему для всех
   * агрегированных блоков виду {title, subheading, buckets} — см.
   * renderAggregatedAnswerBlock_. null, если у вопроса нет риск-карты
   * (не "Выгорание"/"Смена работы").
   */
  getRiskBlockConfig_(question) {

    const riskConfig = this.RISK_QUESTIONS_[question.title];

    if (!riskConfig) {
      return null;
    }

    return {
      title: riskConfig.icon + " " + riskConfig.heading,
      subheading: riskConfig.subheading,
      buckets: riskConfig.buckets
    };

  },

  /**
   * Подписи положительной/отрицательной группы для вопросов Да/Скорее
   * да/Скорее нет/Нет — по смыслу конкретного вопроса, а не общими
   * словами вроде "Положительная оценка" (см. запрос: "Не использовать
   * универсальные подписи"). Добавление нового вопроса в этот список —
   * единственное, что нужно для получения для него того же
   * агрегированного KPI-блока, что и у "Выгорание"/"Смена работы"; вопрос
   * без записи здесь просто продолжает рендериться старым компактным
   * списком (см. getYesNoBlockConfig_/renderQuestionBlock_).
   */
  YES_NO_SUMMARIES_: {

    "График": { positive: "Устраивает", negative: "Не устраивает" },
    "Задачи": { positive: "Устраивают", negative: "Не устраивают" },
    "Ожидания": { positive: "Ожидания понятны", negative: "Ожидания непонятны" },
    "Проф мнение": { positive: "Мнение учитывается", negative: "Мнение не учитывается" },
    "Возможности роста": { positive: "Видят возможности роста", negative: "Не видят возможностей роста" },
    "ОС от руководителя": { positive: "Получают обратную связь", negative: "Не получают обратную связь" },
    "Ценности": { positive: "Разделяют ценности", negative: "Не разделяют ценности" },
    "О жизни компании": { positive: "Информированы", negative: "Не информированы" },
    "Цели компании": { positive: "Понимают цели компании", negative: "Не понимают цели компании" },
    "Вклад": { positive: "Видят свой вклад", negative: "Не видят своего вклада" },
    "Атмосфера в отделе": { positive: "Атмосфера комфортная", negative: "Атмосфера некомфортная" },
    "Межкомандное взаимодействие": { positive: "Взаимодействие налажено", negative: "Взаимодействие не налажено" },
    "Неформальное общение": { positive: "Есть неформальное общение", negative: "Нет неформального общения" },
    "Решение споров": { positive: "Споры решаются конструктивно", negative: "Споры решаются неконструктивно" }

  },

  /**
   * Собрать общий {title, subheading, buckets} для вопроса Да/Скорее
   * да/Скорее нет/Нет из YES_NO_SUMMARIES_: положительная группа —
   * "Да"+"Скорее да" (рост хорошо), отрицательная — "Скорее нет"+"Нет"
   * (снижение хорошо). null, если вопрос не Да/Нет-шкала или для него
   * не задана сводка в YES_NO_SUMMARIES_ (тогда вопрос рендерится
   * обычным компактным списком без KPI-карточки).
   */
  getYesNoBlockConfig_(question) {

    if (!Questions.isYesNoScale(question)) {
      return null;
    }

    const summary = this.YES_NO_SUMMARIES_[question.title];

    if (!summary) {
      return null;
    }

    return {
      title: question.title,
      subheading: null,
      buckets: [
        { label: "🟢 " + summary.positive, answers: ["да", "скорее да"], direction: "up" },
        { label: "🔴 " + summary.negative, answers: ["скорее нет", "нет"], direction: "down" }
      ]
    };

  },

  /**
   * Общий блок "агрегированный KPI + детализация" для вопросов
   * "Выгорание"/"Смена работы" и Да/Скорее да/Скорее нет/Нет (см.
   * getRiskBlockConfig_/getYesNoBlockConfig_) — единственное, чем они
   * отличаются, это конфигурация группировки/подписей (blockConfig),
   * сам механизм рендера один: заголовок (title, опционально
   * subheading) → KPI-карточка агрегированных категорий (кол-во/%/Δ,
   * светло-серая заливка строк, без рамки и без бара) → одна пустая
   * строка → то же детальное распределение, что и у остальных вопросов
   * (renderCompactAnswerList_, переиспользуется как есть, без Δ и без
   * эмодзи — эти акценты уже есть в KPI-карточке выше и не дублируются
   * на уровне отдельных вариантов ответа) → строка "2025:" с
   * агрегированными значениями категорий (не по отдельным вариантам
   * ответа).
   */
  renderAggregatedAnswerBlock_(ctx, blockConfig, items, hasComparison) {

    const sheet = ctx.sheet;

    sheet.getRange(ctx.row, 1).setValue(blockConfig.title);
    Formatter.formatLabel(sheet.getRange(ctx.row, 1));
    ctx.row += 1;

    if (blockConfig.subheading) {
      sheet.getRange(ctx.row, 1).setValue(blockConfig.subheading);
      ctx.row += 1;
    }

    const buckets = this.aggregateAnswerBuckets_(items, blockConfig.buckets);

    this.renderAggregateKpiRows_(ctx, buckets, hasComparison);

    ctx.row += 1; // одна пустая строка между KPI-карточкой и детализацией

    // hasComparison=false здесь намеренно: детальные строки этого блока
    // показывают только кол-во/%/бар за 2026 (без Δ и без собственной
    // строки "2025:" на уровне отдельных вариантов ответа) — согласно
    // макету, Δ и "2025:" на этом экране относятся только к
    // агрегированным категориям, а не к каждому варианту ответа.
    // Эмодзи-легенда здесь тоже не используется (в отличие от KPI-строк
    // и строки "2025:") — только эмодзи-легенда KPI-карточки остается
    // визуальным акцентом, детализация оформлена нейтрально.
    this.renderCompactAnswerList_(ctx, items, false, answer => this.capitalize_(answer));

    if (hasComparison) {

      const summary = buckets
        .map(bucket => {
          const value2025 = (bucket.percent2025 !== null && bucket.percent2025 !== undefined)
            ? bucket.count2025 + " (" + bucket.percent2025 + "%)"
            : "н/д";
          return bucket.label + " " + value2025;
        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue("2025: " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Сложить уже посчитанные count2026/percent2026/count2025/percent2025/
   * delta вариантов ответа (items, из Statistics/Comparison) в
   * категории по карте bucket.answers. Общая логика для риск-категорий
   * и для положительной/отрицательной группы Да/Нет — ничего не
   * пересчитывает, только суммирует готовые числа; percent2026/
   * percent2025/delta категории — null, если хотя бы у одного из ее
   * вариантов ответа соответствующее значение null (нет валидных
   * ответов за этот год по всему вопросу — тот же случай, что и в
   * Comparison.gs).
   */
  aggregateAnswerBuckets_(items, buckets) {

    const byAnswer = {};
    items.forEach(item => { byAnswer[item.answer.trim().toLowerCase()] = item; });

    const sumNullable = (matched, key) => matched.reduce((total, item) => {
      const value = item[key];
      return (total !== null && value !== null && value !== undefined) ? total + value : null;
    }, 0);

    return buckets.map(bucket => {

      const matched = bucket.answers
        .map(answer => byAnswer[answer.trim().toLowerCase()])
        .filter(Boolean);

      return {
        label: bucket.label,
        direction: bucket.direction,
        count2026: matched.reduce((total, item) => total + item.count2026, 0),
        percent2026: sumNullable(matched, "percent2026"),
        count2025: matched.reduce((total, item) => total + (item.count2025 || 0), 0),
        percent2025: sumNullable(matched, "percent2025"),
        delta: sumNullable(matched, "delta")
      };

    });

  },

  /**
   * Строки KPI-карточки агрегированных категорий: label | "кол-во (%)" |
   * Δ — без бара (в отличие от renderCompactAnswerList_), общие для
   * риск-блока и блока Да/Нет. Цвет Δ — по bucket.direction (см.
   * GOOD_DIRECTION_/RISK_QUESTIONS_/YES_NO_SUMMARIES_), не по знаку
   * числа: например, снижение "Повышенный риск" или "Не устраивают" —
   * улучшение и красится зеленым, а не красным.
   */
  renderAggregateKpiRows_(ctx, buckets, hasComparison) {

    const sheet = ctx.sheet;
    const firstRow = ctx.row;

    buckets.forEach(bucket => {

      const row = ctx.row;

      sheet.getRange(row, 1).setValue(bucket.label);

      sheet.getRange(row, 2).setValue(
        bucket.percent2026 !== null && bucket.percent2026 !== undefined
          ? bucket.count2026 + " (" + bucket.percent2026 + "%)"
          : bucket.count2026 + " (н/д)"
      );
      sheet.getRange(row, 2).setFontWeight("bold");

      if (hasComparison && bucket.delta !== null && bucket.delta !== undefined) {
        const deltaCell = sheet.getRange(row, 4);
        deltaCell.setValue(bucket.delta);
        deltaCell.setFontWeight("bold");
        Formatter.setDeltaFontColor(deltaCell, bucket.delta, bucket.direction);
      }

      ctx.row += 1;

    });

    // KPI-карточка: светло-серая заливка трех (или двух, без сравнения)
    // строк агрегата, без рамки — карточка отделяется от детализации
    // пустой строкой (см. renderRiskQuestionBlock_), а не линией/рамкой.
    const width = hasComparison ? 4 : 2;
    sheet.getRange(firstRow, 1, buckets.length, width).setBackground("#f3f3f3");

    if (hasComparison) {
      const deltaRange = sheet.getRange(firstRow, 4, buckets.length, 1);
      Formatter.applyCompactDeltaNumberFormat(deltaRange);
    }

  },

  /**
   * Желаемое направление изменения Δ по варианту ответа — рост
   * показателя не всегда означает улучшение (например, снижение доли
   * ответа "Нет" — это хорошо). Ключ — нормализованный (trim+lowercase)
   * текст варианта ответа; значение передается в
   * Formatter.resolveDeltaColor/setDeltaFontColor:
   *   "up"      — рост хорошо (Δ>0 зеленый, Δ<0 красный);
   *   "down"    — снижение хорошо (цвет инвертирован, стрелка не меняется);
   *   "neutral" — всегда серый, независимо от знака Δ.
   * Вариант, не указанный здесь, по умолчанию считается "up" (см.
   * getGoodDirection_) — это прежнее поведение отчета.
   */
  GOOD_DIRECTION_: {

    "да": "up",
    "скорее да": "up",
    "скорее нет": "down",
    "нет": "down",

    "5": "up",
    "4": "up",
    "3": "neutral",
    "2": "down",
    "1": "down",
    "не пользовался": "neutral",

    "совсем не чувствовал": "up",
    "чувствовал редко": "up",
    "чувствовал регулярно": "down",
    "чувствовал постоянно и чувствую сейчас": "down",
    "затрудняюсь ответить": "neutral",

    "совсем не задумывался": "up",
    "очень редко, но такие мысли были": "up",
    "задумывался время от времени": "down",
    "постоянно и думаю об этом сейчас": "down"

  },

  /**
   * Желаемое направление Δ для варианта ответа (см. GOOD_DIRECTION_).
   * Явно не описанный вариант по умолчанию считается "up".
   */
  getGoodDirection_(answer) {
    return this.GOOD_DIRECTION_[String(answer).trim().toLowerCase()] || "up";
  },

  // Эмодзи-легенда перед оценкой в строках распределения rating5-вопросов
  // (только визуальная маркировка, порядок/расчеты не затрагивает).
  RATING_ANSWER_EMOJI_: { "5": "🟢", "4": "🟩", "3": "🟨", "2": "🟧", "1": "🟥" },

  /**
   * Подпись варианта ответа rating5-вопроса с эмодзи-легендой перед
   * цифрой оценки (например "🟢 5"). Вариант без эмодзи в карте
   * (например "не пользовался") выводится как есть.
   */
  formatRatingAnswerLabel_(answer) {

    const emoji = this.RATING_ANSWER_EMOJI_[answer];

    return emoji ? emoji + " " + answer : answer;

  },

  /**
   * Строка со средней оценкой вопроса (только rating5) — то же
   * значение, что уже показано в "Средние оценки — обзор", здесь оно
   * повторяется для контекста внутри своей секции анкеты. Значение —
   * главный визуальный элемент блока (крупный жирный шрифт), Δ — той
   * же строкой справа; цвет — по Formatter.resolveDeltaColor с
   * направлением "up" (рост среднего балла всегда хорошо), без порога.
   */
  renderInlineAverage_(ctx, question, lookups, hasComparison) {

    const sheet = ctx.sheet;

    const item = hasComparison
      ? lookups.comparisonAverages[question.title]
      : lookups.averages[question.title];

    if (!item) {
      return;
    }

    sheet.getRange(ctx.row, 1).setValue("⭐ Средняя оценка");
    ctx.row += 1;

    const value2026 = hasComparison
      ? (item.value2026 !== null ? item.value2026 : "н/д")
      : item.average;

    const valueCell = sheet.getRange(ctx.row, 1);
    valueCell.setValue(value2026);
    Formatter.formatHighlightNumber(valueCell);

    const delta = hasComparison ? item.delta : null;

    if (delta !== null && delta !== undefined) {

      const deltaCell = sheet.getRange(ctx.row, 2);
      deltaCell.setValue(this.formatSignedDelta_(delta, ""));
      // Средний балл rating5 — рост всегда хорошо (шкала оценки), в
      // отличие от отдельных вариантов ответа в GOOD_DIRECTION_.
      Formatter.setDeltaFontColor(deltaCell, delta, "up");

    }

    ctx.row += 1;

  },

  /**
   * Из четырех вопросов типа "single" (единственных в каталоге —
   * Город/Отдел/Стаж/Формат работы, см. renderQuestionBlock_) только эти
   * два отражают изменение структуры компании, поэтому для них Δ
   * оставляем; для Города/Отдела — нет (это просто описание состава
   * выборки, а не аналитическое сравнение). Тип/display у всех четырех
   * вопросов одинаковые, поэтому это единственное, что нельзя вывести
   * из существующих свойств Questions.gs — здесь минимально необходимый
   * список конкретных названий, а не полноценная конфигурация.
   */
  SINGLE_QUESTIONS_WITH_DELTA_: ["Стаж", "Формат работы"],

  // Порог для сворачивания мелких городов в одну строку "Другие города"
  // (см. collapseSmallCities_) — только для вопроса "Город".
  SMALL_CITY_THRESHOLD_: 3,

  /**
   * Свернуть города с count2026 < SMALL_CITY_THRESHOLD_ в одну итоговую
   * строку "Другие города". Города выше порога остаются как есть,
   * порядок (по убыванию count2026, задан раньше в renderQuestionBlock_)
   * не меняется — "Другие города" всегда добавляется последней строкой,
   * без участия в сортировке. Если мелких городов нет — items
   * возвращается без изменений (строка "Другие города" не добавляется).
   *
   * percent2026 для "Другие города" считается один раз от точной суммы
   * count2026, а НЕ суммой уже округленных percent2026 маленьких
   * городов — Statistics.calculateDistribution уже округляет percent
   * при вычислении (Math.round(count/total*100)), Comparison лишь
   * передает это готовое значение дальше без изменений. Сумма нескольких
   * округленных процентов накопила бы погрешность округления (три
   * города по фактическим 0,4% дали бы 0%+0%+0%=0% вместо верных ~1%).
   * count2026 при этом точный (не округлен), поэтому total (сумма
   * count2026 по items) и итоговый Math.round дают тот же результат, что
   * получился бы, если бы "Другие города" изначально были одной
   * категорией распределения в Statistics.gs — новых расчетов по сырым
   * ответам по-прежнему нет, только другой порядок суммирования/округления
   * уже имеющихся count.
   */
  collapseSmallCities_(items) {

    const bigCities = items.filter(item => item.count2026 >= this.SMALL_CITY_THRESHOLD_);
    const smallCities = items.filter(item => item.count2026 < this.SMALL_CITY_THRESHOLD_);

    if (smallCities.length === 0) {
      return items;
    }

    const otherCount = smallCities.reduce((sum, item) => sum + item.count2026, 0);
    const totalRespondents = items.reduce((sum, item) => sum + item.count2026, 0);
    const otherPercent = totalRespondents > 0 ? Math.round(otherCount / totalRespondents * 100) : 0;

    return bigCities.concat([{ answer: "Другие города", count2026: otherCount, percent2026: otherPercent }]);

  },

  /**
   * Простой список "название — кол-во (%)[, Δ]" для вопросов типа
   * "single" (Город/Отдел/Стаж/Формат работы) — без бара (в отличие от
   * renderCompactAnswerList_) и без заголовка таблицы. Для Города items
   * уже могут быть свернуты через collapseSmallCities_ (мелкие города →
   * "Другие города") до вызова этой функции — сама она просто выводит
   * то, что получила, ничего не агрегируя и не усекая. Δ, если
   * showDelta — целое число со стрелкой, без десятых (например,
   * "▲ +4", а не "▲ +4,0" — см. Formatter.applyCompactDeltaIntegerFormat),
   * цвет — как и везде в отчете (Formatter.setDeltaFontColor), без
   * отдельных "2025, кол-во"/"2025, %" колонок.
   */
  renderReferenceAnswerList_(ctx, items, showDelta) {

    const sheet = ctx.sheet;

    items.forEach(item => {

      const row = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;

      sheet.getRange(row, 1).setValue(item.answer);

      const countCell = sheet.getRange(row, 2);
      countCell.setValue(
        percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)"
      );
      countCell.setFontWeight("bold");

      if (showDelta) {

        const hasDelta = item.delta !== null && item.delta !== undefined;
        const deltaCell = sheet.getRange(row, 3);

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold");

        if (hasDelta) {
          Formatter.applyCompactDeltaIntegerFormat(deltaCell);
          Formatter.setDeltaFontColor(deltaCell, item.delta, "up");
        }

      }

      ctx.row += 1;

    });

  },

  /**
   * Таблица "Ответ | 2026 кол-во | 2026 % | 2025 кол-во | 2025 % | Δ" —
   * общая для распределений и Топ-5, колонки процента/сравнения
   * появляются только если для них есть данные (hasPercent/hasComparison).
   */
  renderAnswerTable_(ctx, items, hasComparison, hasPercent) {

    const sheet = ctx.sheet;
    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Ответ");
    sheet.getRange(headerRow, 2).setValue("2026, кол-во");

    let width = 2;

    if (hasPercent) {
      sheet.getRange(headerRow, 3).setValue("2026, %");
      width = 3;
    }

    if (hasComparison) {
      sheet.getRange(headerRow, 4).setValue("2025, кол-во");
      if (hasPercent) {
        sheet.getRange(headerRow, 5).setValue("2025, %");
      }
      sheet.getRange(headerRow, 6).setValue("Δ");
      width = 6;
    }

    Formatter.formatTableHeader(sheet.getRange(headerRow, 1, 1, width));
    ctx.row += 1;

    const firstDataRow = ctx.row;
    const formatNullable = value => value !== null && value !== undefined ? value : "н/д";

    items.forEach((item, index) => {

      const row = firstDataRow + index;

      sheet.getRange(row, 1).setValue(item.answer);
      sheet.getRange(row, 2).setValue(item.count2026);

      if (hasPercent) {
        sheet.getRange(row, 3).setValue(
          item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 + "%" : "н/д"
        );
      }

      if (hasComparison) {
        sheet.getRange(row, 4).setValue(formatNullable(item.count2025));
        if (hasPercent) {
          sheet.getRange(row, 5).setValue(
            item.percent2025 !== null && item.percent2025 !== undefined ? item.percent2025 + "%" : "н/д"
          );
        }
        sheet.getRange(row, 6).setValue(formatNullable(item.delta));
      }

    });

    if (items.length > 0) {

      Formatter.addTableBorder(sheet.getRange(headerRow, 1, items.length + 1, width));

      if (hasComparison) {
        const deltaRange = sheet.getRange(firstDataRow, 6, items.length, 1);
        Formatter.applyDeltaNumberFormat(deltaRange, " п.п.");
        Formatter.applyDeltaHighlighting(sheet, deltaRange, this.DELTA_THRESHOLD_PERCENT);
      }

    }

    ctx.row = firstDataRow + items.length;

  },

  /**
   * Компактный список вместо таблицы "Ответ | 2026 кол-во | 2026 % |
   * 2025 кол-во | 2025 % | Δ" — для вопросов со шкалой "Да / Скорее
   * да / Скорее нет / Нет" (см. Questions.isYesNoScale) и для
   * распределений rating5, чтобы результат было проще воспринимать
   * руководителям. Использует те же уже посчитанные count/percent/delta,
   * что и renderAnswerTable_ — меняется только визуальное представление,
   * не расчеты. formatLabel — как подписать вариант ответа в этом
   * конкретном вопросе (с заглавной буквы для "да/нет", с эмодзи-легендой
   * для оценок rating5 — см. вызовы в renderQuestionBlock_).
   *
   * Каждая строка: вариант ответа, "кол-во (%)" за 2026, мини-полоса
   * прогресса по % 2026, и (если есть сравнение) Δ к 2025 — та же
   * подсветка/формат, что и в остальных сравнительных таблицах отчета.
   * Ниже списка, если есть сравнение, одной мелкой серой строкой —
   * справочные значения 2025 по всем вариантам (2026 остается главным).
   * formatSummaryLabel — отдельная (более простая) подпись варианта
   * ответа для этой справочной строки; по умолчанию совпадает с
   * formatLabel, но может отличаться (например, без эмодзи-легенды у
   * rating5 — чтобы не спорить за внимание с основным 2026-списком).
   */
  renderCompactAnswerList_(ctx, items, hasComparison, formatLabel, formatSummaryLabel) {

    const summaryLabel = formatSummaryLabel || formatLabel;
    const sheet = ctx.sheet;

    if (items.length === 0) {
      return;
    }

    const width = hasComparison ? 4 : 3;

    const headerRow = ctx.row;

    sheet.getRange(headerRow, 1).setValue("Ответ");
    sheet.getRange(headerRow, 2).setValue("2026");

    if (hasComparison) {
      sheet.getRange(headerRow, 4).setValue("Δ (п.п.)");
    }

    sheet.getRange(headerRow, 1, 1, width).setFontColor("#666666");
    Formatter.addBottomBorder(sheet.getRange(headerRow, 1, 1, width), "#cccccc");
    ctx.row += 1;

    const firstRow = ctx.row;

    items.forEach(item => {

      const row = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;

      sheet.getRange(row, 1).setValue(formatLabel(item.answer));

      sheet.getRange(row, 2).setValue(
        percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)"
      );
      sheet.getRange(row, 2).setFontWeight("bold");

      Formatter.setBlockProgressBar(sheet.getRange(row, 3), percent2026 !== null ? percent2026 : 0);

      if (hasComparison) {

        const deltaCell = sheet.getRange(row, 4);
        const hasDelta = item.delta !== null && item.delta !== undefined;

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold");

        if (hasDelta) {
          Formatter.setDeltaFontColor(deltaCell, item.delta, this.getGoodDirection_(item.answer));
        }

      }

      Formatter.addBottomBorder(sheet.getRange(row, 1, 1, width), "#eeeeee");

      ctx.row += 1;

    });

    if (hasComparison) {

      const deltaRange = sheet.getRange(firstRow, 4, items.length, 1);
      Formatter.applyCompactDeltaNumberFormat(deltaRange);

      const summary = items
        .map(item => {
          const value2025 = (item.percent2025 !== null && item.percent2025 !== undefined)
            ? item.count2025 + " (" + item.percent2025 + "%)"
            : "н/д";
          return summaryLabel(item.answer) + " " + value2025;
        })
        .join(" • ");

      const summaryRow = ctx.row;

      sheet.getRange(summaryRow, 1).setValue("2025: " + summary);
      Formatter.formatMutedSmall(sheet.getRange(summaryRow, 1));

      ctx.row += 1;

    }

  },

  /**
   * Первая буква строки — заглавная (для подписи варианта ответа,
   * который в каталоге Questions.gs хранится в нижнем регистре).
   */
  capitalize_(text) {
    return text && text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  },

  /**
   * Рейтинговое отображение для всех вопросов MULTIPLE (display "Топ 5"):
   * автоматически применяется к любому такому вопросу, специализированного
   * рендера под конкретный вопрос нет (см. вызов в renderQuestionBlock_).
   * Сохраняет все существующие данные (кол-во/%/бар/Δ) и добавляет два
   * новых показателя, которые нигде раньше не считались: место в
   * рейтинге (медаль/номер) и его изменение к прошлому году.
   *
   * Ранг 2026 — это просто позиция в уже готовом items (items приходят
   * отсортированными по count2026 — тем же порядком, что и раньше строила
   * таблицу Comparison.compareTopAnswerItems/Statistics.calculateTopAnswers,
   * см. renderQuestionBlock_). Ранг 2025 считается тем же способом — той
   * же стабильной сортировкой JS Array.sort по count2025 — поэтому при
   * равенстве count2025 у нескольких вариантов порядок между ними
   * сохраняется таким, каким он был в items (без новой логики разрешения
   * ничьих). positionDelta = rank2025 - rank2026: >0 — поднялся в
   * рейтинге (зеленый), <0 — опустился (красный), 0 — не изменился (серый).
   *
   * Стрелки Δ (▲/▼, изменение процента) и изменения позиции (↗/↘/→)
   * используют разные символы намеренно — иначе визуально не отличить,
   * какая стрелка к чему относится (см. formatRankChange_).
   */
  renderRankedAnswerList_(ctx, items, hasComparison) {

    const sheet = ctx.sheet;

    if (items.length === 0) {
      return;
    }

    if (hasComparison) {
      const headerRow = ctx.row;
      sheet.getRange(headerRow, 3).setValue("Δ (п.п.)");
      sheet.getRange(headerRow, 4).setValue("Позиция");
      sheet.getRange(headerRow, 3, 1, 2).setFontColor("#666666");
      Formatter.addBottomBorder(sheet.getRange(headerRow, 1, 1, 4), "#cccccc");
      ctx.row += 1;
    }

    const rank2025ByAnswer = {};

    if (hasComparison) {
      items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (b.item.count2025 || 0) - (a.item.count2025 || 0))
        .forEach((entry, index) => { rank2025ByAnswer[entry.item.answer] = index + 1; });
    }

    items.forEach((item, index) => {

      const rank2026 = index + 1;

      const titleRow = ctx.row;
      sheet.getRange(titleRow, 1).setValue(this.formatRankLabel_(rank2026) + " " + item.answer);
      Formatter.formatLabel(sheet.getRange(titleRow, 1));
      ctx.row += 1;

      const metricsRow = ctx.row;
      const percent2026 = item.percent2026 !== null && item.percent2026 !== undefined ? item.percent2026 : null;

      // Небольшой отступ слева (не форматирование ячейки — Sheets Range
      // не дает API отступа абзаца) — визуально связывает строку
      // показателей со строкой заголовка над ней в один элемент рейтинга.
      sheet.getRange(metricsRow, 1).setValue(
        "    " + (percent2026 !== null ? item.count2026 + " (" + percent2026 + "%)" : item.count2026 + " (н/д)")
      );
      sheet.getRange(metricsRow, 1).setFontWeight("bold");

      Formatter.setBlockProgressBar(sheet.getRange(metricsRow, 2), percent2026 !== null ? percent2026 : 0);

      if (hasComparison) {

        const deltaCell = sheet.getRange(metricsRow, 3);
        const hasDelta = item.delta !== null && item.delta !== undefined;

        deltaCell.setValue(hasDelta ? item.delta : "н/д");
        deltaCell.setFontWeight("bold");

        if (hasDelta) {
          Formatter.applyCompactDeltaNumberFormat(deltaCell);
          Formatter.setDeltaFontColor(deltaCell, item.delta, "up");
        }

        const rank2025 = rank2025ByAnswer[item.answer];

        if (rank2025) {

          const positionDelta = rank2025 - rank2026;
          const positionCell = sheet.getRange(metricsRow, 4);

          positionCell.setValue(this.formatRankChange_(positionDelta));
          positionCell.setFontWeight("bold");
          positionCell.setFontColor(
            positionDelta > 0
              ? Formatter.DELTA_GOOD_COLOR
              : (positionDelta < 0 ? Formatter.DELTA_BAD_COLOR : Formatter.DELTA_NEUTRAL_COLOR)
          );

        }

      }

      ctx.row += 1; // без пустой строки — каждый пункт рейтинга занимает ровно 2 строки

    });

    if (hasComparison) {

      // Строка "2025:" — в порядке рейтинга 2025 (не 2026), полный текст
      // вариантов ответа без сокращений.
      const orderedBy2025 = items.slice().sort(
        (a, b) => rank2025ByAnswer[a.answer] - rank2025ByAnswer[b.answer]
      );

      const summary = orderedBy2025
        .map((item, index) => {
          const value2025 = (item.percent2025 !== null && item.percent2025 !== undefined)
            ? "(" + item.percent2025 + "%)"
            : "(н/д)";
          return this.formatRankLabel_(index + 1) + " " + item.answer + " " + value2025;
        })
        .join(" • ");

      sheet.getRange(ctx.row, 1).setValue("2025: " + summary);
      Formatter.formatMutedSmall(sheet.getRange(ctx.row, 1));
      ctx.row += 1;

    }

  },

  /**
   * Место в рейтинге: медаль для топ-3, "N." для остальных.
   */
  formatRankLabel_(rank) {
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    return medals[rank] || (rank + ".");
  },

  /**
   * Изменение позиции в рейтинге: "↗ N" / "↘ N" / "→". Единственное место
   * в отчете, где формируется это значение (рендер только вызывает этот
   * метод и красит ячейку по знаку positionDelta — своей проверки/строк
   * не дублирует). Символы намеренно другие, чем у Δ процента (▲/▼) —
   * иначе визуально не отличить рост процента от роста позиции в
   * рейтинге. "→" — обычный текст, а не "=": строка, начинающаяся с "="
   * в Range.setValue трактуется Google Sheets как формула и раньше
   * приводила к #ERROR!.
   */
  formatRankChange_(positionDelta) {

    if (positionDelta > 0) {
      return "↗ " + positionDelta;
    }

    if (positionDelta < 0) {
      return "↘ " + Math.abs(positionDelta);
    }

    return "→";

  },

  /**
   * Сырые данные — самый низкий приоритет чтения (тир 4), поэтому
   * визуально отделены толстой границей сверху и свернуты по
   * умолчанию. Содержимое (заголовки/строки) не меняется.
   */
  renderRawData_(ctx, reportData) {

    const sheet = ctx.sheet;
    const sectionStartRow = ctx.row;

    const rawHeaders = reportData.headers;
    const rawRows = reportData.filteredRows;

    sheet.getRange(ctx.row, 1).setValue(
      "Сырые данные (" + reportData.employees + " " +
      this.pluralizeRu_(reportData.employees, ["ответ", "ответа", "ответов"]) + ")"
    );
    Formatter.formatSectionTitle(sheet.getRange(ctx.row, 1));
    Formatter.formatSectionDivider(sheet.getRange(ctx.row, 1, 1, Math.max(rawHeaders.length, 1)));
    ctx.row += 1;

    const rawHeaderRow = ctx.row;

    sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length).setValues([rawHeaders]);
    Formatter.formatTableHeader(
      sheet.getRange(rawHeaderRow, 1, 1, rawHeaders.length)
    );
    ctx.row += 1;

    if (rawRows.length > 0) {

      sheet.getRange(rawHeaderRow + 1, 1, rawRows.length, rawHeaders.length).setValues(rawRows);

      Formatter.addTableBorder(
        sheet.getRange(rawHeaderRow, 1, rawRows.length + 1, rawHeaders.length)
      );

      ctx.row += rawRows.length;

    }

    // Стандартный Filter Google Sheets (не Filter View) строго на
    // таблицу сырых данных: от строки заголовков до последней строки
    // текущей выборки, по всем столбцам — заголовок становится строкой
    // фильтра с выпадающими списками, остальные разделы листа не
    // затрагивает (Range.createFilter ограничивает фильтр этим диапазоном).
    sheet.getRange(rawHeaderRow, 1, rawRows.length + 1, rawHeaders.length).createFilter();

    const sectionContentRows = ctx.row - 1 - sectionStartRow;

    if (sectionContentRows > 0) {
      Formatter.groupRows(sheet, sectionStartRow + 1, sectionContentRows, true);
    }

  },

  /**
   * Сформировать название листа отчета на основе значений выбранных
   * фильтров, без названий вопросов. Если фильтры не выбраны —
   * "Все сотрудники". Несколько фильтров соединяются через " • ".
   */
  generateReportName(filters) {

    const activeFilters = (filters || []).filter(filter => this.hasFilterValue(filter));

    if (activeFilters.length === 0) {
      return "Все сотрудники";
    }

    const parts = activeFilters.map(filter => this.formatFilterValueOnly_(filter));

    return this.sanitizeSheetName(parts.join(" • "));

  },

  /**
   * Значение фильтра без названия вопроса (для автогенерируемого
   * названия отчета). Для rating5/enps — оператор+число, для
   * остальных — выбранные варианты через запятую.
   */
  formatFilterValueOnly_(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.operator + filter.value;
    }

    return filter.values.join(", ");

  },

  /**
   * Убрать символы, запрещенные в названии листа Google Sheets ([ ] * ? : / \),
   * и ограничить длину 100 символами.
   */
  sanitizeSheetName(name) {

    const sanitized = name.replace(/[\[\]\*\?:\/\\]/g, "_");

    return sanitized.length > 100 ? sanitized.substring(0, 100) : sanitized;

  },

  /**
   * Сигнатура параметров построения отчета: источник данных, включено
   * ли сравнение, все выбранные фильтры и их значения. Не зависит от
   * порядка выбора фильтров и от названия листа.
   */
  getReportKey_(reportData) {

    const normalizedFilters = (reportData.filters || [])
      .filter(filter => this.hasFilterValue(filter))
      .map(filter => this.normalizeFilterForKey_(filter))
      .sort((a, b) => a.question.localeCompare(b.question));

    const payload = JSON.stringify({
      source: reportData.source,
      comparison: !!reportData.comparison,
      filters: normalizedFilters
    });

    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload, Utilities.Charset.UTF_8)
      .map(byte => ((byte + 256) % 256).toString(16).padStart(2, "0"))
      .join("");

  },

  /**
   * Приводит один фильтр к стабильному для сигнатуры виду.
   */
  normalizeFilterForKey_(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return { question: filter.question, operator: filter.operator, value: filter.value };
    }

    return { question: filter.question, values: (filter.values || []).slice().sort() };

  },

  /**
   * Найти лист ранее созданного отчета с той же сигнатурой параметров,
   * если он есть. Поиск идет по developer metadata, а не по имени листа.
   */
  findReportSheetByKey_(ss, reportKey) {

    const matches = ss.createDeveloperMetadataFinder()
      .withKey(this.REPORT_KEY_METADATA_KEY)
      .withValue(reportKey)
      .find();

    return matches.length > 0 ? matches[0].getLocation().getSheet() : null;

  },

  /**
   * Полностью снять группировку строк листа (например, перед повторной
   * сборкой уже существующего отчета), чтобы новая группировка
   * создавалась с нуля и не накладывалась на старую.
   */
  resetRowGroups_(sheet) {

    const maxRows = sheet.getMaxRows();

    for (let row = 1; row <= maxRows; row++) {
      const depth = sheet.getRowGroupDepth(row);
      if (depth > 0) {
        sheet.getRange(row, 1).shiftRowGroupDepth(-depth);
      }
    }

  },

  /**
   * Подобрать уникальное имя листа, добавляя суффиксы _2, _3 и т.д.,
   * если имя уже занято, с учетом ограничения в 100 символов.
   * excludeSheet (опционально) — лист, который не считается коллизией
   * (например, сам переименовываемый лист уже мог носить это имя).
   */
  getUniqueSheetName(ss, baseName, excludeSheet) {

    let name = baseName;
    let counter = 2;

    const isTaken = candidate => {
      const found = ss.getSheetByName(candidate);
      return found !== null && found !== excludeSheet;
    };

    while (isTaken(name)) {
      const suffix = "_" + counter;
      const trimmedBase = baseName.length + suffix.length > 100
        ? baseName.substring(0, 100 - suffix.length)
        : baseName;
      name = trimmedBase + suffix;
      counter++;
    }

    return name;

  },

  /**
   * Есть ли у фильтра значение, которое стоит показать в паспорте выборки
   */
  hasFilterValue(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.value !== undefined && filter.value !== null && filter.value !== "";
    }

    return filter.values && filter.values.length > 0;

  },

  /**
   * Текстовое представление фильтра для паспорта выборки
   */
  formatFilterForPassport(filter) {

    if (filter.type === "rating5" || filter.type === "enps") {
      return filter.question + filter.operator + filter.value;
    }

    return filter.question + "=" + filter.values.join(", ");

  }

};