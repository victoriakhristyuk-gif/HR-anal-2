/**
 * ==========================================================
 * Вывод аналитики на листы
 * ==========================================================
 *
 * Единственный модуль, который знает про SpreadsheetApp. Всё, что
 * выше, — чистые вычисления над массивами, их можно тестировать
 * без таблицы.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ. Всё пишется одним setValues на лист, а не
 * по ячейке. Apps Script тратит на каждое обращение к Range
 * заметное время, и построчная запись 40 строк уже ощутима,
 * а 400 — упирается в лимит выполнения.
 */

const AnalyticsWriter = {

  SHEETS: {
    METHODOLOGY: "Методика",
    FINDINGS: "Выводы",
    TRAFFIC: "Светофор",
    DRIVERS: "Драйверы",
    SEGMENTS: "Отклонения срезов",
    CROSS_SEGMENTS: "Связи срезов",
    COHORT: "Когорта",
    TEAM_TYPE_COMPARISON: "Сервисные vs доменные"
  },

  HEADER_BG: "#2e5c8a",

  /**
   * Точка входа: построить аналитику и разложить по листам.
   */
  run(sourceYear, previousYear, filters) {

    const analytics = AnalyticsService.build(sourceYear || "2026", previousYear || "2025", filters || []);
    const findings = AnalyticsService.findings(analytics);

    // Лист-объяснение не зависит от конкретных цифр запуска — методика
    // одна и та же для любого года/фильтра, поэтому пишется первым и
    // без обращения к analytics.
    this.writeMethodology_();

    this.writeFindings_(analytics, findings);
    this.writeTrafficLight_(analytics);
    this.writeDrivers_(analytics);
    this.writeSegments_(analytics);
    this.writeCrossSegments_(analytics);
    this.writeCohort_(analytics);

    // Лист "Сервисные vs доменные" — самостоятельный (как "Руководитель
    // и команда" ниже): строится по всей компании 2026/2025 независимо
    // от sourceYear/filters этого запуска (см. writeTeamTypeComparison_).
    this.writeTeamTypeComparison_();

    // Отдельный лист "Руководитель и команда" строится только по
    // ответам 2026 (обогащение "перформанс" — см. PerformanceDirectory.gs,
    // ManagerTeamReport.gs) — для другого sourceYear его строить не из чего.
    if ((sourceYear || "2026") === "2026") {
      ManagerTeamReport.write();
    }

    return analytics;

  },

  sheet_(name) {

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(name);

    if (sheet) {
      sheet.clear();
      sheet.clearConditionalFormatRules();
    } else {
      sheet = spreadsheet.insertSheet(name);
    }

    return sheet;

  },

  /**
   * Записать таблицу одним вызовом и оформить шапку.
   *
   * @param {Number} startRow - строка, с которой начинается таблица
   *   (по умолчанию 1). Листы расширенной аналитики печатают перед
   *   таблицей двухчастный заголовок и описание (Formatter.
   *   writeSheetIntro), поэтому сама таблица сдвинута вниз.
   * @param {Array<Array<String>>} headerNotes - [[индекс колонки
   *   (0-based), текст подсказки], ...] — подсказки при наведении на
   *   заголовок колонки (Formatter.note), текст берется из Glossary.
   */
  dump_(sheet, header, rows, widths, startRow, headerNotes) {

    startRow = startRow || 1;

    const table = [header].concat(rows);

    if (!table.length) return;

    // Все строки должны быть одной длины, иначе setValues упадет.
    const width = header.length;

    const normalized = table.map(row => {
      const copy = row.slice(0, width);
      while (copy.length < width) copy.push("");
      return copy.map(v => (v === null || v === undefined) ? "" : v);
    });

    sheet.getRange(startRow, 1, normalized.length, width).setValues(normalized);

    const headerRange = sheet.getRange(startRow, 1, 1, width);
    headerRange.setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);
    headerRange.setWrap(true).setVerticalAlignment("middle");

    sheet.setFrozenRows(startRow);
    sheet.setRowHeight(startRow, 42);

    (widths || []).forEach((w, i) => {
      if (w) sheet.setColumnWidth(i + 1, w);
    });

    (headerNotes || []).forEach(pair => {
      Formatter.note(sheet.getRange(startRow, pair[0] + 1), pair[1]);
    });

    return normalized.length;

  },

  /**
   * Лист "Методика" — объяснение того, как устроен весь отчет, для
   * читателя без статистического образования: как читать результат,
   * какие пороги приняты и почему, и подробно — как считается каждая
   * методика (тот же текст, что и в свернутых блоках под таблицами
   * остальных листов, см. Glossary.ENTRIES/Formatter.writeGlossaryBlock,
   * — здесь просто все методики собраны в одном месте, без разброса по
   * листам). Статичный контент, не зависит от конкретного запуска
   * (sourceYear/filters) — поэтому пишется без обращения к analytics.
   */
  writeMethodology_() {

    const sheet = this.sheet_(this.SHEETS.METHODOLOGY);
    const numCols = 3;
    const F = Formatter;

    Formatter.setColumnWidths(sheet, [460, 460, 460]);
    sheet.setHiddenGridlines(true);

    // Единый базовый шрифт листа (Calibri, крупнее, чем плоский вид
    // остальных листов AnalyticsWriter) — задается один раз на весь
    // потенциальный диапазон листа, дальше отдельные блоки переопределяют
    // только размер/цвет/фон, где это нужно. Так восстановимо читаемый
    // шрифт не теряется ни в одном блоке ниже.
    sheet.getRange(1, 1, sheet.getMaxRows(), numCols)
      .setFontFamily(F.REPORT_FONT).setFontSize(13).setFontColor(F.HIGHLIGHT_TEXT_COLOR);

    // Крупный титульный баннер — вместо плоского синего заголовка
    // остальных листов AnalyticsWriter: это лист-справочник для чтения,
    // а не таблица данных, оформление сознательно другое.
    const titleRange = sheet.getRange(1, 1, 1, numCols);
    titleRange.setValue("Как устроена методика этого отчета")
      .setFontFamily(F.REPORT_FONT).setFontSize(22).setFontWeight("bold")
      .setFontColor("#ffffff").setBackground(F.TITLE_BG)
      .setHorizontalAlignment("center").setVerticalAlignment("middle").mergeAcross();
    sheet.setRowHeight(1, 50);

    const subtitleRange = sheet.getRange(2, 1, 1, numCols);
    subtitleRange.setValue("Объяснение для тех, кто не занимается статистикой: как читать цифры и статусы, какие пороги приняты и почему именно такие, и подробно — как считается каждая методика. Те же формулировки продублированы короткими подсказками на самих листах (наведите на заголовок колонки или откройте свернутый блок под таблицей) — этот лист нужен, когда хочется прочитать все объяснения сразу и по порядку.")
      .setFontSize(13).setFontStyle("italic").setFontColor(F.MUTED_TEXT_COLOR).setWrap(true)
      .setVerticalAlignment("middle").setHorizontalAlignment("center").mergeAcross();
    sheet.setRowHeight(2, 48);

    let row = 4;

    const heading = text => {
      sheet.getRange(row, 1, 1, numCols).setValue(text)
        .setFontFamily(F.REPORT_FONT).setFontWeight("bold").setFontSize(18)
        .setFontColor("#ffffff").setBackground(F.ACCENT_TEAL)
        .setVerticalAlignment("middle").mergeAcross();
      sheet.setRowHeight(row, 34);
      row++;
    };

    const paragraph = text => {
      sheet.getRange(row, 1, 1, numCols).setValue(text)
        .setFontFamily(F.REPORT_FONT).setFontSize(13).setFontColor(F.HIGHLIGHT_TEXT_COLOR)
        .setWrap(true).setVerticalAlignment("top").mergeAcross();
      row++;
    };

    // Пункт нумерованного списка — цветной кружок-номер акцентным цветом
    // вместо голого "1." в начале строки, светлая полосатая заливка
    // (как в ReportBuilder — applyZebraStripe) для visual rhythm списка.
    const listItem = (number, text) => {
      const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"][number - 1] || (number + ".");
      const range = sheet.getRange(row, 1, 1, numCols);
      range.setValue(circled + "  " + text)
        .setFontFamily(F.REPORT_FONT).setFontSize(13).setFontColor(F.HIGHLIGHT_TEXT_COLOR)
        .setWrap(true).setVerticalAlignment("top").mergeAcross();
      F.applyZebraStripe(range, number - 1);
      row++;
    };

    const blank = () => { row++; };

    // Заметная цитата-врезка (не КПЭ-карточка, как applyReportHighlightCard
    // — та под короткое число по центру; здесь предложение целиком, поэтому
    // своя облегченная версия того же визуального языка: рамка акцентным
    // цветом, бледная бирюзовая заливка, текст слева).
    const callout = text => {
      const range = sheet.getRange(row, 1, 1, numCols);
      range.setValue(text)
        .setFontFamily(F.REPORT_FONT).setFontSize(15).setFontWeight("bold").setFontStyle("italic")
        .setFontColor(F.HIGHLIGHT_TEXT_COLOR).setBackground(F.HIGHLIGHT_BG)
        .setBorder(true, true, true, true, false, false, F.ACCENT_TEAL, SpreadsheetApp.BorderStyle.SOLID)
        .setWrap(true).setVerticalAlignment("middle").mergeAcross();
      sheet.setRowHeight(row, 46);
      row++;
    };

    // Таблица со светлым бирюзовым заголовком (formatReportTableHeader —
    // тот же прием, что и в ReportBuilder) и чередующейся заливкой строк
    // (applyZebraStripe), обрамленная тонкой рамкой для эффекта карточки.
    // statusColumns — необязательный массив [{col: 0-based индекс, color}]
    // для подсветки колонок светофора (Норм.COLORS) отдельным легким тоном.
    const table = (header, dataRows, statusColumns) => {
      const width = header.length;
      const tableTop = row;

      const headerRange = sheet.getRange(row, 1, 1, width);
      headerRange.setValues([header]);
      F.formatReportTableHeader(headerRange);
      headerRange.setFontSize(13).setWrap(true).setVerticalAlignment("middle").setHorizontalAlignment("left");
      sheet.setRowHeight(row, 40);
      row++;

      if (dataRows.length) {

        const dataRange = sheet.getRange(row, 1, dataRows.length, width);
        dataRange.setValues(dataRows)
          .setFontFamily(F.REPORT_FONT).setFontSize(12.5).setFontColor(F.HIGHLIGHT_TEXT_COLOR)
          .setWrap(true).setVerticalAlignment("top");

        dataRows.forEach((dataRow, i) => {
          F.applyZebraStripe(sheet.getRange(row + i, 1, 1, width), i);
        });

        (statusColumns || []).forEach(spec => {
          const colRange = sheet.getRange(row, spec.col + 1, dataRows.length, 1);
          colRange.setBackground(spec.color).setHorizontalAlignment("center").setFontWeight("bold");
        });

        row += dataRows.length;

      }

      sheet.getRange(tableTop, 1, row - tableTop, width)
        .setBorder(true, true, true, true, true, true, "#d0d7de", SpreadsheetApp.BorderStyle.SOLID);

    };

    // 1. Как читать отчет без знания статистики — см. src/МЕТОДИКА.md,
    // раздел "Как читать отчёт без знания статистики" (источник истины
    // для формулировок этого блока).
    heading("1. Как читать отчёт, если вы не разбираетесь в статистике");
    paragraph("Отчет отвечает на пять разных вопросов. Их важно не смешивать — каждый описывает свою часть картины и ничего не говорит про остальные.");
    blank();

    table(["Что показано", "Простой смысл", "Чего это само по себе не доказывает"], [
      ["Текущий уровень", "Как сотрудники оценили тему сейчас", "Почему получилась именно такая оценка"],
      ["Изменение к прошлому году", "Насколько показатель вырос или снизился", "Что изменение обязательно устойчивое, а не случайное"],
      ["Статистическая значимость", "Достаточно ли данных, чтобы считать изменение неслучайным", "Что изменение крупное и требует немедленного действия"],
      ["Цвет светофора", "В какую внутреннюю зону внимания попал результат", "Что ситуация объективно хорошая или плохая: цвета основаны на внутренних порогах проекта, а не на данных рынка"],
      ["n", "Сколько ответов реально участвовало в конкретном расчёте", "Что отвечавшие полностью представляют всех сотрудников"]
    ]);

    blank();
    paragraph("Безопасный порядок чтения:");
    listItem(1, "Сначала посмотреть n: на малой группе результат сильнее меняется от нескольких ответов.");
    listItem(2, "Затем посмотреть сам уровень и размер разницы.");
    listItem(3, "Проверить, подтверждена ли разница статистически.");
    listItem(4, "Сопоставить сигнал с комментариями, другими показателями и рабочим контекстом.");
    listItem(5, "Принимать решение не по одной цифре, а по сочетанию масштаба, надежности и важности темы.");
    blank();

    callout("Коротко: цвет показывает, куда смотреть; значимость — насколько можно доверять отличию; величина изменения — насколько оно практически важно.");
    blank();

    // 2. С какого листа начать
    heading("2. С какого листа начать");
    table(["Лист", "На какой вопрос отвечает", "Как использовать"], [
      ["Выводы", "Какие сигналы система считает главными", "Начать чтение здесь, затем проверить детали на остальных листах"],
      ["Светофор", "Где текущий уровень хороший, а где требуется внимание", "Выбрать темы для обсуждения, не считать цвет готовым диагнозом"],
      ["Драйверы", "Какие темы меняются вместе с лояльностью", "Искать возможные направления работы; связь еще не доказывает причину"],
      ["Отклонения срезов", "Какие группы отличаются от общего результата", "Проверять локальные зоны риска и учитывать размер группы"],
      ["Когорта", "Как изменились ответы одних и тех же людей", "Отделить личную динамику от изменения состава ответивших"],
      ["Сервисные vs доменные", "Чем сервисные команды отличаются от доменной разработки внутри Управления разработки ПО", "Смотреть разрыв 2026 года и годовую динамику каждой группы отдельно, учитывая статус значимости"],
      ["Руководитель и команда", "Где взгляд руководителя расходится с мнением команды", "Использовать как повод для разговора, особенно осторожно при малой команде"],
      ["Методика (этот лист)", "Как всё это устроено и почему выбраны именно такие правила", "Открывать, когда возникает вопрос «а почему именно так посчитано»"]
    ]);
    blank();

    // 3. Мини-словарь
    heading("3. Мини-словарь терминов");
    table(["Термин", "Простое объяснение"], [
      ["n", "Число ответов, реально участвовавших в конкретном расчёте"],
      ["Валидный ответ", "Ответ, который можно корректно использовать для этой метрики"],
      ["Дельта, Δ", "Разница между двумя значениями"],
      ["Процентный пункт, п.п.", "Прямая разница процентов: рост с 40% до 45% равен 5 п.п."],
      ["Срез", "Отдельная группа сотрудников, например отдел, город или стаж"],
      ["Когорта", "Одни и те же люди, найденные в обоих замерах"],
      ["Погрешность", "Диапазон, внутри которого результат может колебаться из-за случайного состава ответивших"],
      ["Доверительный интервал", "Диапазон значений, в котором с высокой вероятностью (95%) лежит истинный результат, если бы опросили вообще всех, а не только ответивших. Например, eNPS = 42 ± 8 означает, что настоящее значение, скорее всего, между 34 и 50. Чем меньше n, тем шире интервал"],
      ["Статистическая значимость", "Признак того, что найденную разницу уже трудно объяснить одной случайностью"],
      ["Корреляция", "Две оценки часто растут или снижаются вместе; это не доказывает, что одна вызывает другую"],
      ["Драйвер", "В этом отчете — тема, статистически связанная с eNPS, а не доказанная причина eNPS"],
      ["Эвристика", "Практическое правило для быстрой навигации, а не строгий статистический вывод"],
      ["Уровень 0–100", "Оценка вопроса, переведенная на единую шкалу от 0 до 100, чтобы сравнивать вопросы с разными исходными шкалами"],
      ["Существенное расхождение (руководитель и команда)", "Разница взглядов больше принятого порога (20 пунктов из 100), а не любое, даже минимальное отличие"]
    ]);
    blank();

    // 4. Пороги компании и почему именно такие
    heading("4. Какие пороги приняты и почему");
    paragraph("Пороги ниже — двух разных видов, и для каждого явно указано, какой это вид. ВЫВЕДЕН ИЗ ДАННЫХ — граница посчитана по фактическому разбросу результатов именно этой компании (при формальной границе «4,0 = хорошо» почти все вопросы по шкале rating5 попали бы в зеленую зону, и светофор перестал бы что-либо различать). РЕШЕНИЕ ПРОЕКТА — граница, которую нужно было выбрать сознательно, но которую данные сами по себе не диктуют (например стандартный 95%-й порог статистической значимости — общепринятая конвенция, а не свойство этих данных). Оба вида пересматриваются не чаще раза в год — иначе динамика статусов между отчетами станет несопоставимой. Сравнивать любые из этих порогов напрямую с другими компаниями нельзя — калибровка под этот конкретный набор данных.");
    blank();

    table(["Показатель", "Отлично", "Хорошо", "Внимание", "Критично (ниже — требует решения)"], [
      ["Средний балл, шкала 1–5 (rating5)", "≥ 4,50", "4,30–4,49", "4,10–4,29", "< 4,10"],
      ["Доля «да» + «скорее да» (scale4)", "≥ 95%", "90–94%", "85–89%", "< 85%"],
      ["eNPS", "≥ 60", "40–59", "20–39", "< 20"],
      ["Доля выгорающих «регулярно»/«постоянно»", "≤ 10%", "11–15%", "16–20%", "> 20%"],
      ["Доля задумывающихся об уходе", "≤ 5%", "6–10%", "11–15%", "> 15%"],
      ["Охват льготы (доля тех, кто попробовал)", "≥ 70%", "50–69%", "35–49%", "< 35%"]
    ], [
      { col: 1, color: Norms.COLORS[Norms.STATUS.EXCELLENT] },
      { col: 2, color: Norms.COLORS[Norms.STATUS.GOOD] },
      { col: 3, color: Norms.COLORS[Norms.STATUS.WATCH] },
      { col: 4, color: Norms.COLORS[Norms.STATUS.CRITICAL] }
    ]);
    paragraph("Происхождение: ВЫВЕДЕНО ИЗ ДАННЫХ — границы разбивают фактический разброс компании примерно на верхнюю треть, середину, нижнюю треть и хвост.");
    blank();

    paragraph("Кроме светофора, в отчете используется еще несколько порогов — они относятся не к самому уровню, а к тому, можно ли вообще доверять результату или сравнению:");
    blank();

    table(["Порог", "Значение", "Происхождение", "Зачем нужен"], [
      ["Класс надёжности результата", "ДИ eNPS ≤6 / 6–12 / 12–20 / >20 пунктов (после поправки на конечную совокупность)", "Выведено из данных", "Границы 6/12/20 — стандартное отклонение eNPS между отделами компании (19,8 п.) и медианное отклонение отдела от нормы (12,0 п.); класс показывает, различия какого масштаба цифра ещё способна показать. Ни один класс не скрывает группу — см. «Устойчивость результата»"],
      ["Поправка на конечную совокупность (FPC)", "√((N−n)/(N−1)), см. отдельную карточку ниже", "Статистическая формула (не калибровка)", "Убирает ошибку выборки для групп с известным конечным штатом — при полном охвате ДИ схлопывается в 0"],
      ["Низкая явка среза (отдел/управление)", "< 50% от штатной численности; отдельно порог «полный/почти полный охват» — ≥ 80%", "Решение проекта", "Качество охвата — отдельный признак от класса надёжности (см. выше): показывает риск смещения неответивших, который поправка FPC не лечит"],
      ["Отклонение среза от остальной компании — управленческий порог", "≥ 0,20 балла (rating5) / ≥ 7 п.п. (доли) / ≥ 15 пунктов (eNPS)", "Решение проекта", "15 пунктов eNPS ≈ 0,75 стандартного отклонения между отделами (19,8) — не статистическая граница, а порог «стоит ли этим заниматься». Статистический вопрос «отличается ли группа вообще» считается отдельно, через пересечение доверительных интервалов, без фиксированного порога"],
      ["Статистическая значимость изменения", "|z| или |t| > 1,96", "Решение проекта (стандартная конвенция)", "Общепринятый 95%-й порог уверенности в статистике — не подобран отдельно под эти данные"],
      ["Совпадение оценки руководителя и команды", "|разница| ≤ 10 (шкала 0–100)", "Решение проекта", "Меньшая разница считается совпадением взглядов"],
      ["Существенное расхождение руководителя и команды", "> 20 пунктов (шкала 0–100)", "Решение проекта", "Порог, начиная с которого расхождение считается достаточно большим, чтобы обсуждать"],
      ["Надёжное сравнение руководителя и команды", "n ≥ 5 ответивших в команде ИЛИ доля команды ≥ 60%", "Решение проекта", "Доля важнее абсолютного числа: 4 из 5 человек команды — полноценный результат, 4 из 40 — нет, хотя n одинаковое"]
    ]);
    blank();

    // 5. Подробно про каждую методику — тот же текст, что и в свернутых
    // блоках под таблицами остальных листов (см. Glossary.ENTRIES), но
    // оформленный как отдельные "карточки" методик, каждая со своей
    // независимой группировкой строк (в отличие от общего
    // Formatter.writeGlossaryBlock, который используют остальные листы —
    // тот сворачивает все методики одним блоком; здесь каждая методика
    // сворачивается по отдельности). Без "живых" примеров из конкретного
    // запуска — примеры с реальными цифрами уже есть на соответствующих
    // листах (Светофор/Драйверы/Отклонения срезов/Когорта); у методики
    // нет "своего" запуска analytics.
    heading("5. Подробно про каждую методику");
    paragraph("Каждая карточка ниже свернута — нажмите «+» слева от строки, чтобы раскрыть: что показывает методика, зачем она нужна, как считается (формула и то же самыми словами), как читать результат и на что обратить внимание.");
    blank();

    const methodologyKeys = [
      "absoluteLevel", "significance", "enpsConfidence", "finitePopulationCorrection", "coverage", "bottomShare",
      "uncertainGroup", "correlation", "driversQuadrant", "correlationMatrix", "promoterGap",
      "segmentDeviation", "sampleReliability", "cohortPairedTest", "compositionShift", "managerTeamComparison",
      "teamTypeComparison"
    ];

    methodologyKeys.forEach(key => {

      const entry = Glossary.ENTRIES[key];
      if (!entry) return;

      const titleRange = sheet.getRange(row, 1, 1, numCols);
      titleRange.setValue(entry.title)
        .setFontFamily(F.REPORT_FONT).setFontWeight("bold").setFontSize(15)
        .setFontColor("#ffffff").setBackground(F.ACCENT_TEAL)
        .setVerticalAlignment("middle").setWrap(true).mergeAcross();
      sheet.setRowHeight(row, 30);
      row++;

      const detailStart = row;

      const fields = [
        ["Зачем это нужно", entry.why],
        ["Как рассчитывается", entry.formula],
        ["Простыми словами", entry.formulaPlain],
        ["Как читать результат", entry.howToRead],
        ["На что обратить внимание", entry.limitations]
      ];

      // Шрифт (семья) для рантайма не переопределяется здесь — ячейки уже
      // получили Formatter.REPORT_FONT общим форматированием листа в
      // начале метода, а RichTextValue без явного runs.setFontFamily
      // наследует его. Это тот же прием, что и в ReportBuilder
      // (setRatingWithPreviousYear_/setKpiValueWithPreviousYear_) — размер
      // и цвет задаются по runs, а не range-уровневыми вызовами поверх
      // setRichTextValue, чтобы не затирать стили самого RichText.
      fields.forEach((field, i) => {

        const label = field[0] + ": ";
        const text = label + field[1];

        const fieldRange = sheet.getRange(row, 1, 1, numCols);
        const richText = SpreadsheetApp.newRichTextValue()
          .setText(text)
          .setTextStyle(0, label.length, SpreadsheetApp.newTextStyle()
            .setBold(true).setFontSize(12.5).setForegroundColor(F.LABEL_TEXT_COLOR).build())
          .setTextStyle(label.length, text.length, SpreadsheetApp.newTextStyle()
            .setBold(false).setFontSize(12.5).setForegroundColor(F.HIGHLIGHT_TEXT_COLOR).build())
          .build();

        fieldRange.setRichTextValue(richText);
        fieldRange.setWrap(true).setVerticalAlignment("top").mergeAcross();
        F.applyZebraStripe(fieldRange, i);
        row++;

      });

      sheet.getRange(row - 1, 1, 1, numCols)
        .setBorder(false, false, true, false, false, false, F.ACCENT_TEAL, SpreadsheetApp.BorderStyle.SOLID);

      F.groupRows(sheet, detailStart, row - detailStart, true);

      blank();

    });

  },

  writeFindings_(analytics, findings) {

    const sheet = this.sheet_(this.SHEETS.FINDINGS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Что заметили автоматические правила — сводка наблюдений",
      "Каждая строка — готовый вывод по одному из проверенных правил (значимость изменений, отклонения срезов, малые группы и т.д.). Подробности каждой методики — на соответствующем листе (Светофор, Драйверы, Отклонения срезов, Когорта).",
      3);

    const meta = analytics.meta;

    const rows = [
      ["", "Опрос " + meta.year + ": " + meta.n + " анкет" +
        (meta.hasPrevious ? " (" + meta.previousYear + ": " + meta.nPrevious + ")" : ""), ""],
      ["", "Построено " + Utilities.formatDate(meta.builtAt, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm"), ""],
      ["", "", ""]
    ];

    const labels = { critical: "КРИТИЧНО", warning: "ВНИМАНИЕ", info: "СПРАВОЧНО" };

    findings.forEach(finding => {
      rows.push([labels[finding.severity], finding.title, finding.text]);
    });

    this.dump_(sheet, ["Уровень", "Наблюдение", "Расшифровка"], rows, [110, 380, 700], startRow, [
      [0, "Насколько срочно реагировать. КРИТИЧНО — подтвержденная проблема, требует решения. " +
        "ВНИМАНИЕ — значимое изменение, стоит обсудить причины. СПРАВОЧНО — полезный контекст без немедленных действий."]
    ]);

    // Цвет уровня
    const colors = { "КРИТИЧНО": "#ffc7ce", "ВНИМАНИЕ": "#fcd5b4", "СПРАВОЧНО": "#ededed" };

    for (let i = 0; i < rows.length; i++) {
      const level = rows[i][0];
      if (colors[level]) {
        sheet.getRange(startRow + 1 + i, 1).setBackground(colors[level]).setFontWeight("bold").setFontSize(9);
      }
    }

    sheet.getRange(startRow + 1, 1, rows.length + 1, 3).setVerticalAlignment("top").setWrap(true);
    sheet.setHiddenGridlines(true);

  },

  writeTrafficLight_(analytics) {

    const sheet = this.sheet_(this.SHEETS.TRAFFIC);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Какой у вопросов статус и куда смотреть — светофор с проверкой значимости",
      "По каждому вопросу: текущий уровень относительно порогов компании, значимо ли изменение к прошлому году, связь с лояльностью (eNPS) и охват. Подсказки — на заголовках колонок, формулы и ограничения — в свернутом блоке под таблицей.",
      21);

    const sorted = analytics.trafficLight.slice().sort((a, b) => (a.level || 0) - (b.level || 0));

    const header = [
      "Вопрос", "Группа", "Тип шкалы", "Значение", "Ед.", "Прошлый год", "Δ",
      "Значимость", "Статус результата", "Уровень 0–100", "Статус", "Что означает статус",
      "Влияние на eNPS (r)", "База n", "Охват, %", "Δ охвата, п.п.", "Жёсткий негатив, %",
      "Затрудняюсь, n", "Затрудняюсь, %", "eNPS затруднившихся", "Критики затруднившихся, %"
    ];

    // insufficientData — для eNPS (единственный тип с показанным ДИ,
    // entry.margin) по классу надёжности (см. Norms.reliabilityClass:
    // ширина скорректированного ДИ, не голое n). Для остальных типов
    // ДИ не отображается (см. AnalyticsService.trafficLight_) —
    // остается прежний признак малой базы, но с поправкой на полный
    // охват: сузившийся до маленького, но ПОЛНОСТЬЮ опрошенного отдела
    // фильтр не должен получать ярлык "недостаточно данных".
    const statuses = sorted.map(entry => {

      const fullCoverage = !!entry.populationSize && entry.n === entry.populationSize;

      let insufficientData;

      if (entry.type === "enps") {
        const reliabilityClass = Norms.reliabilityClass(entry.margin, fullCoverage);
        insufficientData = reliabilityClass === null ||
          reliabilityClass === Norms.RELIABILITY_CLASS.ROUGH ||
          reliabilityClass === Norms.RELIABILITY_CLASS.INDICATIVE;
      } else {
        insufficientData = !fullCoverage && entry.n < Norms.FRAGILE_SEGMENT_SIZE;
      }

      return Glossary.reliabilityStatus({
        insufficientData: insufficientData,
        noComparisonData: entry.previous === undefined,
        negativeSignal: entry.status === Norms.STATUS.CRITICAL || (entry.significant && entry.delta < 0),
        weakSignal: entry.status === Norms.STATUS.WATCH
      });

    });

    const rows = sorted.map((entry, i) => [
      entry.question,
      entry.group,
      entry.scaleKey,
      entry.value,
      entry.unit,
      entry.previous === undefined ? "" : entry.previous,
      entry.delta === undefined ? "" : entry.delta,
      entry.significanceNote || "",
      statuses[i].label,
      entry.level,
      entry.status,
      entry.statusExplained,
      entry.rEnps === undefined ? "" : entry.rEnps,
      entry.n,
      entry.coveragePercent,
      entry.coverageDelta === undefined ? "" : entry.coverageDelta,
      entry.bottomShare === undefined ? "" : entry.bottomShare,
      entry.uncertainGroup ? entry.uncertainGroup.n : "",
      entry.uncertainGroup ? entry.uncertainGroup.percent : "",
      entry.uncertainGroup ? entry.uncertainGroup.enps : "",
      entry.uncertainGroup ? entry.uncertainGroup.criticsPercent : ""
    ]);

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows,
      [280, 120, 100, 80, 55, 90, 60, 150, 190, 95, 100, 300, 110, 60, 75, 95, 110, 90, 90, 110, 130],
      startRow, [
        [7, G.significance.what + " " + G.significance.howToRead],
        [8, "Итоговая надежность результата: значим ли эффект и достаточно ли данных, чтобы ему доверять."],
        [9, G.absoluteLevel.what + " " + G.absoluteLevel.howToRead],
        [12, G.correlation.what + " " + G.correlation.howToRead],
        [14, G.coverage.what + " " + G.coverage.howToRead],
        [16, G.bottomShare.what + " " + G.bottomShare.howToRead],
        [17, G.uncertainGroup.what + " " + G.uncertainGroup.howToRead]
      ]);

    sorted.forEach((entry, i) => {
      if (entry.color) sheet.getRange(startRow + 1 + i, 11).setBackground(entry.color).setFontWeight("bold");
      sheet.getRange(startRow + 1 + i, 9).setBackground(statuses[i].color).setFontWeight("bold");
    });

    const examples = {
      absoluteLevel: Glossary.EXAMPLE.absoluteLevel(sorted.find(e => e.status)),
      significance: Glossary.EXAMPLE.significance(sorted.find(e => e.previous !== undefined)),
      enpsConfidence: Glossary.EXAMPLE.enpsConfidence(sorted.find(e => e.type === "enps")),
      coverage: Glossary.EXAMPLE.coverage(sorted.find(e => e.coveragePercent !== null && e.coveragePercent !== undefined)),
      bottomShare: Glossary.EXAMPLE.bottomShare(sorted.find(e => e.bottomShare !== undefined)),
      uncertainGroup: Glossary.EXAMPLE.uncertainGroup(sorted.find(e => e.uncertainGroup)),
      correlation: Glossary.EXAMPLE.correlation(sorted.find(e => e.rEnps !== null && e.rEnps !== undefined))
    };

    const lastDataRow = startRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["absoluteLevel", "significance", "enpsConfidence", "coverage", "bottomShare", "uncertainGroup", "correlation"],
      examples);

    sheet.setHiddenGridlines(true);

  },

  writeDrivers_(analytics) {

    const sheet = this.sheet_(this.SHEETS.DRIVERS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "За что браться в первую очередь — матрица приоритетов",
      "Каждый вопрос — в одном из четырех квадрантов: сила связи с лояльностью (eNPS, выгорание, уход) против текущего уровня. Низкая оценка сама по себе не значит «важно чинить» — важно то, где низкий уровень сочетается с сильной связью.",
      12);

    const gapByQuestion = {};
    analytics.gaps.forEach(gap => { gapByQuestion[gap.question] = gap; });

    const header = [
      "Вопрос", "Квадрант", "Статус результата", "Уровень 0–100", "Влияние на eNPS (r)", "r с выгоранием",
      "r с уходом", "Промоутеры", "Критики", "Разрыв", "База n", "Предупреждение"
    ];

    const matrixByQuestion = {};
    analytics.correlationMatrix.forEach(row => { matrixByQuestion[row.question] = row; });

    const statuses = analytics.drivers.rows.map(row => Glossary.reliabilityStatus({
      insufficientData: row.n < Norms.FRAGILE_SEGMENT_SIZE,
      negativeSignal: row.quadrant === Drivers.QUADRANT.FIX_FIRST,
      weakSignal: row.quadrant === Drivers.QUADRANT.WATCH || !!row.note
    }));

    const rows = analytics.drivers.rows.map((row, i) => {

      const gap = gapByQuestion[row.question] || {};
      const matrix = matrixByQuestion[row.question] || {};

      return [
        row.question,
        row.quadrant,
        statuses[i].label,
        row.level,
        row.r,
        matrix.burnout === undefined ? "" : matrix.burnout,
        matrix.leave === undefined ? "" : matrix.leave,
        gap.promoterMean === undefined ? "" : gap.promoterMean,
        gap.detractorMean === undefined ? "" : gap.detractorMean,
        gap.gap === undefined ? "" : gap.gap,
        row.n,
        row.note || ""
      ];

    });

    const cuts = [
      new Array(header.length).fill(""),
      ["ГРАНИЦЫ КВАДРАНТОВ", "медиана влияния r = " + analytics.drivers.impactCut +
        ", средний уровень = " + analytics.drivers.levelCut].concat(new Array(header.length - 2).fill(""))
    ];

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows.concat(cuts),
      [280, 140, 190, 100, 110, 110, 95, 95, 85, 75, 60, 480], startRow, [
        [1, G.driversQuadrant.what + " " + G.driversQuadrant.howToRead],
        [2, "Итоговая надежность результата: подтвержден ли сигнал и достаточно ли данных, чтобы ему доверять."],
        [4, G.correlation.what + " " + G.correlation.howToRead],
        [5, G.correlationMatrix.what + " " + G.correlationMatrix.howToRead],
        [6, G.correlationMatrix.what + " " + G.correlationMatrix.howToRead],
        [9, G.promoterGap.what + " " + G.promoterGap.howToRead]
      ]);

    const quadrantColors = {
      "ЧИНИТЬ ПЕРВЫМ": "#ffc7ce",
      "СЛЕДИТЬ": "#fcd5b4",
      "ДЕРЖАТЬ": "#c6efce",
      "ОК": "#ededed"
    };

    analytics.drivers.rows.forEach((row, i) => {
      const color = quadrantColors[row.quadrant];
      if (color) sheet.getRange(startRow + 1 + i, 2).setBackground(color).setFontWeight("bold");
      sheet.getRange(startRow + 1 + i, 3).setBackground(statuses[i].color).setFontWeight("bold");
    });

    const corrRow = analytics.drivers.rows.find(row => row.r !== null && row.r !== undefined);
    const matrixRow = analytics.correlationMatrix.find(row =>
      (row.burnout !== null && row.burnout !== undefined) || (row.leave !== null && row.leave !== undefined));

    const examples = {
      driversQuadrant: Glossary.EXAMPLE.driversQuadrant(analytics.drivers.rows[0]),
      correlation: corrRow ? Glossary.EXAMPLE.correlation({ question: corrRow.question, rEnps: corrRow.r }) : null,
      correlationMatrix: Glossary.EXAMPLE.correlationMatrix(matrixRow),
      promoterGap: Glossary.EXAMPLE.promoterGap(analytics.gaps[0])
    };

    const lastDataRow = startRow + rows.length + cuts.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["driversQuadrant", "correlation", "correlationMatrix", "promoterGap"], examples);

    sheet.setHiddenGridlines(true);

  },

  writeSegments_(analytics) {

    const sheet = this.sheet_(this.SHEETS.SEGMENTS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Какие группы сотрудников заметно отличаются от компании — отклонения срезов",
      "Каждый срез сравнивается с остальной компанией за вычетом самого среза (не с нормой, в которую входит он сам — иначе крупный срез отчасти сравнивался бы сам с собой). Для отделов, управлений и групп команд показаны приглашенные и явка отдельно за текущий и прошлый годы; названия связываются через стабильный ID отдела. Для «Соответствие ожиданиям» и «Грейд» приглашенные — все сотрудники с заполненным полем в справочнике «перформанс», независимо от участия в опросе (только 2026 год; «—» — приглашенных в группе нет). Процент не выводится для фильтров, по которым неизвестна численность приглашенных (например город или стаж). ДИ (±) считается с поправкой на конечную совокупность штата (см. лист «Методика») — при полном охвате отдела интервал схлопывается в 0.",
      19);

    const header = [
      "Разрез", "Группа", "n", "Приглашены", "Явка, %", "n пр. год", "Приглашены пр. год", "Явка пр. год, %",
      "eNPS", "ДИ ±", "eNPS пр. год", "Δ eNPS",
      "Критики, %", "Выгорание, %", "Уход, %", "Отклонений (плохих)", "Отклонения от нормы компании",
      "Надёжность", "Статус результата"
    ];

    // Округление eNPS зависит от ширины ДИ (методика, задача 6): широкий
    // интервал (> 10 пунктов) создаёт ложную точность у десятичного
    // знака — "43,8" при ДИ ±24 выглядит точнее, чем есть на самом деле.
    // При полном охвате (ДИ=0) десятая сохраняется — там это не ложная
    // точность, а факт.
    const roundEnpsForDisplay_ = (value, margin, fullCoverage) => {
      if (value === null || value === undefined) return value;
      if (!fullCoverage && margin !== null && margin !== undefined && margin > 10) {
        return Math.round(value);
      }
      return value;
    };

    const rows = [];
    const rowStatuses = [];
    const rowRenamedFrom = [];
    let deviationExampleSegment = null;
    let deviationExampleDimension = null;
    let reliabilityExampleSegment = null;
    let reliabilityExampleDimension = null;
    let fragileExampleSegment = null;
    let fragileExampleDimension = null;

    analytics.segments.forEach(dimension => {

      const company = dimension.company;

      // "Соответствие ожиданиям"/"Грейд": знаменатель — справочник
      // "перформанс", а не Headcount.gs (см. Segments.analyze). Когда он
      // посчитан, но приглашенных в группе нет (0), "—" отличает это от
      // обычного "не считается для этого среза" (пустая ячейка).
      const isPerformanceDimension = dimension.dimension === "Соответствие ожиданиям" ||
        dimension.dimension === "Грейд";

      rows.push([
        dimension.dimension,
        "НОРМА КОМПАНИИ",
        company.n,
        company.headcount !== undefined ? company.headcount : "",
        company.responseRatePercent !== undefined && company.responseRatePercent !== null
          ? company.responseRatePercent
          : (isPerformanceDimension && company.headcount !== undefined ? "—" : ""),
        company.previousN !== undefined ? company.previousN : "",
        company.previousHeadcount !== undefined && company.previousHeadcount !== null ? company.previousHeadcount : "",
        company.previousResponseRatePercent !== undefined && company.previousResponseRatePercent !== null ? company.previousResponseRatePercent : "",
        roundEnpsForDisplay_(company.enps, company.enpsMargin, company.responseRatePercent === 100),
        company.enpsMargin,
        company.previousEnps !== undefined ? company.previousEnps : "",
        "",
        company.detractors,
        company.burnoutRisk,
        company.leaveRisk,
        "",
        "Отклонением считается: eNPS ≥" + Norms.DEVIATION.enpsPoints +
          " п., доли ≥" + Norms.DEVIATION.sharePp + " п.п., средние ≥" + Norms.DEVIATION.ratingPoints + " балла",
        "",
        ""
      ]);
      rowStatuses.push(null);
      rowRenamedFrom.push(null);

      // "Соответствие ожиданиям"/"Грейд"/"Роль в отделе" существуют только
      // в 2026 — сравнения с прошлым годом для них в принципе нет (не
      // "данных не хватило", а "признака не было"), это стоит сказать явно,
      // а не полагаться на то, что читатель сам заметит пустые колонки.
      if (dimension.noHistory) {
        const note = new Array(header.length).fill("");
        note[16] = "Исторического сравнения нет: признак «" + dimension.dimension +
          "» отсутствует в данных 2025 (справочник «перформанс» есть только за 2026 год).";
        rows.push(note);
        rowStatuses.push(null);
        rowRenamedFrom.push(null);
      }

      dimension.segments.forEach(segment => {

        const deviationText = segment.deviations.length
          ? segment.deviations.map(d =>
              d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1) +
              (d.bad ? " ⚠" : "")).join(" · ")
          : "в пределах нормы";

        // "Статус результата" описывает ТЕКУЩИЙ результат и зависит
        // только от надежности текущего года (Segments.
        // currentReliabilityLimited) — та же функция, что и в
        // AnalyticsService.findings (п.6). Прошлогодняя явка/малая
        // база сюда не подмешивается: полный текущий охват не должен
        // превращаться в "недостаточно данных" из-за ограничений
        // прошлого периода, который не участвует в расчете текущих
        // отклонений от нормы компании.
        const currentCaveat = Segments.coverageCaveat(segment, false);
        const previousCaveat = segment.previousN > 0 ? Segments.coverageCaveat(segment, true) : null;

        let reliabilityText = currentCaveat.text || "достаточно данных";

        if (segment.metrics.enpsMargin !== null) {
          reliabilityText += ", ДИ текущего eNPS ±" + segment.metrics.enpsMargin;
          // "Цена одного ответа" (методика, задача 6) — вместо абстрактного
          // "мало данных": на группах, где класс надёжности "Грубая"/
          // "Ориентировочная" (не полный охват), явно называем, сколько
          // пунктов eNPS двигает один изменившийся ответ — это то, что
          // читатель реально может применить, в отличие от предупреждения
          // без цифр.
          if (segment.n > 0 && (segment.reliabilityClass === Norms.RELIABILITY_CLASS.ROUGH ||
              segment.reliabilityClass === Norms.RELIABILITY_CLASS.INDICATIVE)) {
            // Один ответ, сдвинувшийся на одну категорию (например
            // критик → нейтрал, или нейтрал → промоутер), меняет
            // числитель eNPS (промоутеры-критики) на 1 из n — то есть
            // на 100/n пунктов.
            const pointsPerAnswer = MathStats.round(100 / segment.n, 1);
            reliabilityText += ". В группе из " + segment.n + " человек один изменившийся ответ двигает eNPS примерно на " +
              pointsPerAnswer + " пункта";
          }
        } else {
          reliabilityText += ", нет валидных ответов eNPS текущего года";
        }

        if (dimension.noHistory) {
          reliabilityText += "; сравнения с 2025 нет — признака не было в прошлом году";
        } else if (segment.previousN === 0) {
          reliabilityText += "; нет базы прошлого года";
        } else if (previousCaveat && previousCaveat.text) {
          // Оговорка прошлого года относится ТОЛЬКО к сравнению годов,
          // а не к текущему результату — поэтому вынесена отдельной
          // явно подписанной фразой, а не смешана со статусом текущего
          // результата (см. Segments.yearComparisonLimited). Если
          // текущий год и сам ограничен, отдельная подпись не нужна —
          // статус результата уже это отражает.
          reliabilityText += Segments.currentReliabilityLimited(segment)
            ? "; " + previousCaveat.text
            : "; Ограничение относится только к сравнению с прошлым годом: " + previousCaveat.text;
        }

        const status = Glossary.reliabilityStatus({
          insufficientData: Segments.currentReliabilityLimited(segment),
          noComparisonData: dimension.noHistory,
          negativeSignal: segment.confirmed,
          weakSignal: segment.badCount === 1
        });

        rows.push([
          "",
          segment.name,
          segment.n,
          segment.headcount !== null ? segment.headcount : "",
          segment.responseRatePercent !== null
            ? segment.responseRatePercent
            : (isPerformanceDimension && company.headcount !== undefined ? "—" : ""),
          segment.previousN,
          segment.previousHeadcount !== null ? segment.previousHeadcount : "",
          segment.previousResponseRatePercent !== null ? segment.previousResponseRatePercent : "",
          roundEnpsForDisplay_(segment.metrics.enps, segment.metrics.enpsMargin, segment.fullCoverage),
          segment.metrics.enpsMargin,
          segment.yearDelta ? segment.yearDelta.previous : "",
          segment.yearDelta ? segment.yearDelta.delta : "",
          segment.metrics.detractors,
          segment.metrics.burnoutRisk,
          segment.metrics.leaveRisk,
          segment.badCount,
          deviationText,
          reliabilityText,
          status.label
        ]);
        rowStatuses.push(status);
        rowRenamedFrom.push(segment.renamedFrom && segment.renamedFrom.length ? segment.renamedFrom : null);

        if (!deviationExampleSegment && segment.deviations.length) {
          deviationExampleSegment = segment;
          deviationExampleDimension = dimension.dimension;
        }
        if (!reliabilityExampleSegment) {
          reliabilityExampleSegment = segment;
          reliabilityExampleDimension = dimension.dimension;
        }
        if (!fragileExampleSegment && segment.fragile) {
          fragileExampleSegment = segment;
          fragileExampleDimension = dimension.dimension;
        }

      });

      rows.push(new Array(header.length).fill(""));
      rowStatuses.push(null);
      rowRenamedFrom.push(null);

    });

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows, [120, 300, 50, 90, 75, 70, 110, 105, 70, 60, 90, 70, 80, 95, 80, 110, 520, 280, 190],
      startRow, [
        [16, G.segmentDeviation.what + " " + G.segmentDeviation.howToRead],
        [17, G.sampleReliability.what + " " + G.sampleReliability.howToRead],
        [18, "Итоговая надежность результата: подтверждено ли отклонение и достаточно ли данных, чтобы ему доверять."]
      ]);

    rows.forEach((row, i) => {
      if (row[1] === "НОРМА КОМПАНИИ") {
        sheet.getRange(startRow + 1 + i, 1, 1, header.length).setBackground("#ededed").setFontWeight("bold");
      } else if (row[15] !== "" && row[15] >= 2) {
        sheet.getRange(startRow + 1 + i, 16).setBackground("#ffc7ce").setFontWeight("bold");
      }
      if (rowStatuses[i]) {
        sheet.getRange(startRow + 1 + i, 19).setBackground(rowStatuses[i].color).setFontWeight("bold");
      }
      if (rowRenamedFrom[i]) {
        Formatter.note(sheet.getRange(startRow + 1 + i, 2), "Ранее называлось: " + rowRenamedFrom[i].join(", "));
      }
    });

    sheet.getRange(startRow + 1, 17, rows.length, 2).setWrap(true).setVerticalAlignment("top");

    const reliabilitySegment = fragileExampleSegment || reliabilityExampleSegment;
    const reliabilityDimension = fragileExampleSegment ? fragileExampleDimension : reliabilityExampleDimension;

    const examples = {
      segmentDeviation: Glossary.EXAMPLE.segmentDeviation(deviationExampleSegment, deviationExampleDimension),
      sampleReliability: Glossary.EXAMPLE.sampleReliability(reliabilitySegment, reliabilityDimension)
    };

    const lastDataRow = startRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["segmentDeviation", "sampleReliability"], examples);

    sheet.setHiddenGridlines(true);

  },

  /**
   * Строки для одного компактного блока листа "Связи срезов" —
   * "заголовок + мини-таблица" (в отличие от dump_, который пишет ОДНУ
   * большую таблицу на весь лист с frozen header, здесь несколько таких
   * блоков идут подряд одним листом). Чистая функция без SpreadsheetApp
   * — тот же прием, что и buildTeamTypeComparisonSheetModel_, чтобы
   * ширину и состав строк можно было проверить unit-тестом.
   *
   * @param {Object|null} overview - analytics.crossSegmentsOverview
   * @returns {Array<{title, header: Array<String>, rows: Array<Array>}>}
   */
  buildCrossSegmentsOverviewBlocks_(overview) {

    if (!overview) return [];

    const blocks = [];
    const cell_ = value => (value === null || value === undefined) ? "" : value;
    const deviationText_ = deviations => deviations.length
      ? deviations.map(d => d.label + " " + (d.diff > 0 ? "+" : "") + MathStats.round(d.diff, 1) +
          (d.bad ? " ⚠" : "")).join(" · ")
      : "в пределах нормы";

    // 1. Общие показатели по компании
    blocks.push({
      title: "Общие показатели по компании",
      header: ["n", "Приглашены", "Явка, %", "eNPS", "ДИ ±", "Критики, %", "Выгорание, %", "Уход, %"],
      rows: [[
        overview.company.n,
        cell_(overview.company.headcount),
        cell_(overview.company.responseRatePercent),
        overview.company.enps,
        overview.company.enpsMargin,
        overview.company.detractors,
        overview.company.burnoutRisk,
        overview.company.leaveRisk
      ]]
    });

    // 2-3. Сравнение по грейдам / по эффективности (=«Соответствие
    // ожиданиям» — та же терминология, что использует пользователь при
    // обсуждении этих срезов, хотя в данных и на листе "Отклонения
    // срезов" поле называется "Соответствие ожиданиям").
    [
      { title: "Сравнение по грейдам", dimensionResult: overview.gradeComparison },
      { title: "Сравнение по эффективности", dimensionResult: overview.performanceComparison }
    ].forEach(entry => {

      const header = ["Группа", "n", "Приглашены", "Явка, %", "eNPS", "ДИ ±",
        "Критики, %", "Выгорание, %", "Уход, %", "Отличия от нормы компании"];

      if (!entry.dimensionResult) {
        blocks.push({
          title: entry.title,
          header: header,
          rows: [["Срез недоступен в этом запуске (справочник «перформанс» не подключен)", "", "", "", "", "", "", "", "", ""]]
        });
        return;
      }

      const company = entry.dimensionResult.company;

      const rows = [[
        "НОРМА КОМПАНИИ", company.n, cell_(company.headcount), cell_(company.responseRatePercent),
        company.enps, company.enpsMargin, company.detractors, company.burnoutRisk, company.leaveRisk, ""
      ]];

      entry.dimensionResult.segments.forEach(segment => {
        rows.push([
          segment.name, segment.n, cell_(segment.headcount), cell_(segment.responseRatePercent),
          segment.metrics.enps, segment.metrics.enpsMargin, segment.metrics.detractors,
          segment.metrics.burnoutRisk, segment.metrics.leaveRisk, deviationText_(segment.deviations)
        ]);
      });

      blocks.push({ title: entry.title, header: header, rows: rows });

    });

    // 4. Матрица "Грейд × Соответствие ожиданиям"
    if (overview.matrix && overview.matrix.rowLabels.length && overview.matrix.colLabels.length) {

      const header = ["Грейд \\ Соответствие ожиданиям"].concat(overview.matrix.colLabels);

      const rows = overview.matrix.rowLabels.map(rowLabel => {
        const cells = overview.matrix.colLabels.map(colLabel => {
          const cell = overview.matrix.grid[rowLabel] && overview.matrix.grid[rowLabel][colLabel];
          if (!cell) return "—";
          return "n=" + cell.metrics.n + ", eNPS=" + cell_(cell.metrics.enps) + (cell.fragile ? " ⚠" : "");
        });
        return [rowLabel].concat(cells);
      });

      blocks.push({ title: "Матрица «Грейд × Соответствие ожиданиям»", header: header, rows: rows });

    } else {
      blocks.push({
        title: "Матрица «Грейд × Соответствие ожиданиям»",
        header: ["Грейд \\ Соответствие ожиданиям"],
        rows: [["Недостаточно данных для матрицы (нет пересекающихся значений обоих срезов)"]]
      });
    }

    // 5. Вопросы с наибольшими различиями между группами
    {
      const header = ["Разрез", "Вопрос", "Разброс (макс−мин)", "Группа (макс)", "Значение (макс)",
        "Группа (мин)", "Значение (мин)"];
      const rows = [];

      [
        { label: "Грейд", list: overview.gradeQuestionDifferences },
        { label: "Соответствие ожиданиям", list: overview.performanceQuestionDifferences }
      ].forEach(entry => {
        if (!entry.list.length) {
          rows.push([entry.label, "нет достаточных данных для сравнения (меньше двух групп с валидными ответами)", "", "", "", "", ""]);
          return;
        }
        entry.list.forEach(item => {
          rows.push([entry.label, item.question, item.spread, item.maxGroup, item.maxValue, item.minGroup, item.minValue]);
        });
      });

      blocks.push({ title: "Вопросы с наибольшими различиями между группами", header: header, rows: rows });
    }

    // 6. Выводы: чем каждая группа отличается от нормы компании
    {
      const header = ["Разрез", "Группа", "n", "Чем группа отличается от нормы компании"];
      const rows = [];

      [overview.gradeInsights, overview.performanceInsights].forEach(list => {
        list.forEach(item => rows.push([item.dimension, item.group, item.n, item.text]));
      });

      if (!rows.length) rows.push(["", "нет данных", "", ""]);

      blocks.push({ title: "Выводы: чем каждая группа отличается от нормы компании", header: header, rows: rows });
    }

    return blocks;

  },

  /**
   * Пишет на лист несколько блоков "заголовок + мини-таблица" подряд
   * (см. buildCrossSegmentsOverviewBlocks_) — сам ничего не считает.
   *
   * @returns {Number} первая свободная строка после последнего блока
   */
  writeStackedBlocks_(sheet, startRow, blocks) {

    let row = startRow;

    blocks.forEach(block => {

      const width = block.header.length;

      const titleRange = sheet.getRange(row, 1, 1, width);
      if (width > 1) titleRange.merge();
      titleRange.setValue(block.title)
        .setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG)
        .setVerticalAlignment("middle");
      sheet.setRowHeight(row, 22);

      const headerRow = row + 1;
      sheet.getRange(headerRow, 1, 1, width).setValues([block.header])
        .setFontWeight("bold").setBackground("#ededed").setWrap(true);

      const dataRows = block.rows.map(r => {
        const copy = r.slice(0, width);
        while (copy.length < width) copy.push("");
        return copy.map(v => (v === null || v === undefined) ? "" : v);
      });

      sheet.getRange(headerRow + 1, 1, dataRows.length, width).setValues(dataRows);

      row = headerRow + 1 + dataRows.length + 1; // + пустая строка-разделитель

    });

    return row;

  },

  /**
   * Лист "Связи срезов" — связаны ли между собой три среза, доступные
   * только для 2026 года: "Соответствие ожиданиям", "Грейд", "Роль в
   * отделе" (см. CrossSegments.gs). В отличие от "Отклонения срезов",
   * где каждый срез сравнивается с нормой компании независимо, здесь
   * пары срезов сравниваются друг с другом. Сначала идет сводка
   * (общие показатели компании, сравнение по грейдам/эффективности,
   * матрица "Грейд × Соответствие ожиданиям", вопросы с наибольшими
   * различиями, выводы по каждой группе — buildCrossSegmentsOverviewBlocks_),
   * затем — детальная построчная таблица всех пар срезов, как раньше.
   */
  writeCrossSegments_(analytics) {

    const sheet = this.sheet_(this.SHEETS.CROSS_SEGMENTS);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Связаны ли между собой перформанс, грейд и роль в отделе",
      "Сначала — сводка 2026 года: общие показатели компании, сравнение по грейдам и по эффективности " +
        "(«Соответствие ожиданиям»), матрица «Грейд × Соответствие ожиданиям», вопросы анкеты с наибольшим " +
        "разбросом между группами и выводы, чем каждая группа отличается от нормы компании. Ниже — детальная " +
        "таблица: для каждой пары срезов (доступны только для этого источника — см. лист «Отклонения срезов») " +
        "кросс-таблица метрик по сочетаниям значений и сила связи между самими срезами (V Крамера). Связь " +
        "считается по всей отфильтрованной выборке отчета, вне зависимости от размера отдельных ячеек ниже.",
      10);

    const overviewBlocks = this.buildCrossSegmentsOverviewBlocks_(analytics.crossSegmentsOverview);
    let pairsStartRow = startRow;

    if (overviewBlocks.length) {
      pairsStartRow = this.writeStackedBlocks_(sheet, startRow, overviewBlocks);
    }

    const pairsTitleRange = sheet.getRange(pairsStartRow, 1, 1, 10);
    pairsTitleRange.merge();
    pairsTitleRange.setValue("Все пары срезов — детальная таблица")
      .setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG)
      .setVerticalAlignment("middle");
    sheet.setRowHeight(pairsStartRow, 22);

    const tableStartRow = pairsStartRow + 1;

    const header = [
      "Пара срезов", "Значение A", "Значение B", "n", "eNPS", "ДИ ±",
      "Критики, %", "Выгорание, %", "Уход, %", "Связь / надёжность"
    ];

    const rows = [];
    const rowKinds = []; // "pair" | "cell" | null (разделитель)
    let associationExample = null;

    if (!analytics.crossSegments || !analytics.crossSegments.length) {

      rows.push([
        "Связей нет", "", "", "", "", "", "", "", "",
        "Срезы «Соответствие ожиданиям»/«Грейд»/«Роль в отделе» существуют только для отчета за 2026 год " +
          "(справочник «перформанс» есть только за этот год) либо справочник «перформанс» недоступен в этом запуске."
      ]);
      rowKinds.push(null);

    } else {

      analytics.crossSegments.forEach(pair => {

        const pairLabel = pair.dimA + " × " + pair.dimB;
        const association = pair.association;

        let associationText;

        if (!association || association.v === null) {
          associationText = "Недостаточно данных для оценки связи (мало наблюдений либо меньше 2 значений " +
            "хотя бы в одном из измерений).";
        } else {

          const strength = association.v < 0.10 ? "практически нет связи"
            : association.v < 0.30 ? "слабая связь"
              : association.v < 0.50 ? "умеренная связь"
                : "сильная связь";

          associationText = "V Крамера = " + association.v + " (" + strength + "), n=" + association.n +
            ", χ²=" + association.chi2 + ". Пороги условны: <0,10 практически нет, 0,10–0,30 слабая, " +
            "0,30–0,50 умеренная, >0,50 сильная.";

          if (!associationExample) associationExample = pair;

        }

        rows.push([pairLabel, "", "", "", "", "", "", "", "", associationText]);
        rowKinds.push("pair");

        if (!pair.crossTab.cells.length) {

          rows.push(["", "нет пересекающихся данных для этой пары", "", "", "", "", "", "", "", ""]);
          rowKinds.push(null);

        } else {

          pair.crossTab.cells.forEach(cell => {

            rows.push([
              "", cell.a, cell.b, cell.metrics.n, cell.metrics.enps, cell.metrics.enpsMargin,
              cell.metrics.detractors, cell.metrics.burnoutRisk, cell.metrics.leaveRisk,
              cell.fragile ? "⚠ малая база (n < " + Norms.FRAGILE_SEGMENT_SIZE + ")" : "достаточно данных"
            ]);
            rowKinds.push("cell");

          });

        }

        rows.push(new Array(header.length).fill(""));
        rowKinds.push(null);

      });

    }

    const G = Glossary.ENTRIES;

    this.dump_(sheet, header, rows, [200, 170, 170, 50, 70, 60, 90, 95, 80, 520],
      tableStartRow, [
        [9, G.crossSegmentAssociation.what + " " + G.crossSegmentAssociation.howToRead]
      ]);

    rows.forEach((row, i) => {
      if (rowKinds[i] === "pair") {
        sheet.getRange(tableStartRow + 1 + i, 1, 1, header.length).setBackground("#ededed").setFontWeight("bold");
      } else if (rowKinds[i] === "cell" && row[9] && row[9].indexOf("⚠") === 0) {
        sheet.getRange(tableStartRow + 1 + i, 10).setBackground("#fff2cc");
      }
    });

    sheet.getRange(tableStartRow + 1, 10, rows.length, 1).setWrap(true).setVerticalAlignment("top");

    const examples = {
      crossSegmentAssociation: Glossary.EXAMPLE.crossSegmentAssociation(associationExample)
    };

    const lastDataRow = tableStartRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["crossSegmentAssociation"], examples);

    sheet.setHiddenGridlines(true);

  },

  writeCohort_(analytics) {

    const sheet = this.sheet_(this.SHEETS.COHORT);

    const startRow = Formatter.writeSheetIntro(sheet,
      "Что изменилось у тех же самых людей — сквозная когорта",
      "Сравнение не всей выборки, а только тех, кто отвечал на опрос оба года — это отделяет реальное изменение отношения от смены состава респондентов. Уровень по когорте читать нельзя (подписываются более лояльные), только направление изменения.",
      9);

    if (!analytics.cohort) {
      sheet.getRange(startRow, 1).setValue("Данных прошлого года нет — сквозная когорта не строится.");
      return;
    }

    const cohort = analytics.cohort;

    const intro = [
      ["Размер когорты", cohort.info.size, "человек ответили оба года", "", "", "", "", "", ""],
      ["Подписанных анкет", cohort.info.signedNow + " / " + cohort.info.signedBefore,
        "текущий / прошлый год", "", "", "", "", "", ""],
      ["Отброшено дублей ключа", cohort.info.droppedDuplicates, "неоднозначное сопоставление", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""]
    ];

    if (cohort.enps) {
      intro.push(["eNPS когорты", cohort.enps.enpsBefore + " → " + cohort.enps.enpsNow,
        "Δ " + cohort.enps.delta + " п.", "подняли оценку: " + cohort.enps.up,
        "снизили: " + cohort.enps.down, "не изменили: " + cohort.enps.same, "", "", ""]);
      intro.push(["", "", "", "", "", "", "", "", ""]);
      intro.push(["ВАЖНО", "Уровень когорты читать нельзя — подписываются более лояльные. Читать только ИЗМЕНЕНИЕ.",
        "", "", "", "", "", "", ""]);
      intro.push(["", "", "", "", "", "", "", "", ""]);
    }

    const header = ["Вопрос", "Δ у одних и тех же людей", "n", "t", "Статус результата",
      "Подняли", "Снизили", "Без изменений", "Вердикт"];

    const statuses = (cohort.changes.rows || []).map(row => Glossary.reliabilityStatus({
      insufficientData: row.n < Norms.FRAGILE_SEGMENT_SIZE,
      negativeSignal: row.significant && row.meanDiff < 0,
      weakSignal: false
    }));

    const rows = (cohort.changes.rows || []).map((row, i) => [
      row.question, row.meanDiff, row.n, row.t, statuses[i].label, row.up, row.down, row.same, row.verdict
    ]);

    const table = intro.concat([header]).concat(rows);

    sheet.getRange(startRow, 1, table.length, header.length).setValues(
      table.map(row => row.map(v => (v === null || v === undefined) ? "" : v))
    );

    const headerRow = startRow + intro.length;
    sheet.getRange(headerRow, 1, 1, header.length)
      .setFontWeight("bold").setFontColor("#ffffff").setBackground(this.HEADER_BG);

    const G = Glossary.ENTRIES;
    Formatter.note(sheet.getRange(headerRow, 4), G.cohortPairedTest.what + " " + G.cohortPairedTest.howToRead);
    Formatter.note(sheet.getRange(headerRow, 5),
      "Итоговая надежность результата: подтверждено ли изменение и достаточно ли пар в когорте, чтобы ему доверять.");

    rows.forEach((row, i) => {
      if (cohort.changes.rows[i].significant) {
        sheet.getRange(headerRow + 1 + i, 1, 1, header.length)
          .setBackground(cohort.changes.rows[i].meanDiff < 0 ? "#ffc7ce" : "#c6efce");
      }
      sheet.getRange(headerRow + 1 + i, 5).setBackground(statuses[i].color).setFontWeight("bold");
    });

    [280, 190, 60, 60, 190, 80, 80, 110, 380].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

    const compositionEntry = analytics.composition.find(entry => entry.shifts.length);

    const examples = {
      cohortPairedTest: Glossary.EXAMPLE.cohortPairedTest(
        (cohort.changes.rows || []).find(row => row.t !== null && row.t !== undefined)),
      compositionShift: Glossary.EXAMPLE.compositionShift(compositionEntry)
    };

    const lastDataRow = headerRow + rows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, header.length,
      ["cohortPairedTest", "compositionShift"], examples);

    sheet.setHiddenGridlines(true);

  },

  /**
   * Сырые данные для листа "Сервисные vs доменные" — самостоятельная
   * загрузка (как ManagerTeamReport.prepare_), не зависит от analytics/
   * фильтров текущего запуска: сравнение всегда строится по всей
   * компании 2026/2025 (см. заголовок TeamTypeComparison.gs).
   * Отсутствие листа "Ответы 2025" не считается ошибкой — сравнение
   * строится только по 2026, годовая динамика групп в этом случае
   * пуста (см. TeamTypeComparison.build/hasPrevious).
   */
  prepareTeamTypeComparison_() {

    const survey2026 = loadEnrichedSurveyData_("2026", true);

    let rows2025 = null;
    let headers2025 = null;

    try {
      const survey2025 = loadEnrichedSurveyData_("2025", true);
      rows2025 = survey2025.data;
      headers2025 = survey2025.headers;
    } catch (error) {
      rows2025 = null;
      headers2025 = null;
    }

    const questions = Questions.getAll().filter(
      question => question.report && question.type !== "text" && question.type !== "single"
    );

    return TeamTypeComparison.build(survey2026.data, survey2026.headers, rows2025, headers2025, questions);

  },

  /**
   * Чистая (без SpreadsheetApp) сборка структуры листа "Сервисные vs
   * доменные" — заголовок, паспорт и строки таблицы, все ровно
   * `numCols` элементов в ширину. Вынесено отдельно от write*, чтобы
   * длину строк можно было проверить unit-тестом без реального листа
   * (см. TeamTypeComparisonSheetModelTest.gs) — раньше `numCols` был
   * захардкожен (17) отдельно от фактической ширины таблицы (18 после
   * добавления колонки "Комментарий"), и паспорт/заголовок расходились
   * по ширине с самой таблицей.
   *
   * @returns {{header, fullHeader, numCols, passportRows, tableRows, widths}}
   */
  buildTeamTypeComparisonSheetModel_(comparison) {

    const header = [
      "Раздел", "Показатель", "Ед.",
      comparison.groupALabel + " 2026", "n серв. 2026", comparison.groupALabel + " 2025", "n серв. 2025",
      "Δ серв. год к году", "Значимость Δ серв.",
      comparison.groupBLabel + " 2026", "n дом. 2026", comparison.groupBLabel + " 2025", "n дом. 2025",
      "Δ дом. год к году", "Значимость Δ дом.",
      "Разрыв 2026: серв. − дом.", "Значимость разрыва 2026"
    ];

    const fullHeader = header.concat(["Комментарий"]);
    const numCols = fullHeader.length;

    // Строка произвольной длины -> ровно numCols элементов (лишнее
    // обрезается, недостающее дополняется "") — та же гарантия длины
    // строки, что dump_ даёт таблице ниже (см. dump_/normalized).
    const padRow_ = cells => {
      const copy = cells.slice(0, numCols);
      while (copy.length < numCols) copy.push("");
      return copy;
    };

    const passport = comparison.passport;

    const passportRows = [
      padRow_(["Управление", passport.division]),
      padRow_(["", "Группа", "n 2026", "Приглашены 2026", "Явка 2026, %", "n 2025", "Приглашены 2025", "Явка 2025, %"]),
      padRow_(["", passport.a.label, passport.a.n2026, passport.a.invited2026 !== null ? passport.a.invited2026 : "",
        passport.a.responseRate2026 !== null ? passport.a.responseRate2026 : "",
        passport.a.n2025 !== null ? passport.a.n2025 : "",
        passport.a.invited2025 !== null ? passport.a.invited2025 : "",
        passport.a.responseRate2025 !== null ? passport.a.responseRate2025 : ""]),
      padRow_(["", passport.b.label, passport.b.n2026, passport.b.invited2026 !== null ? passport.b.invited2026 : "",
        passport.b.responseRate2026 !== null ? passport.b.responseRate2026 : "",
        passport.b.n2025 !== null ? passport.b.n2025 : "",
        passport.b.invited2025 !== null ? passport.b.invited2025 : "",
        passport.b.responseRate2025 !== null ? passport.b.responseRate2025 : ""]),
      padRow_(["", passport.note]),
      padRow_([])
    ];

    const significanceLabel = value => value === true ? "значимо" : value === false ? "в пределах погрешности" : "";

    const tableRows = comparison.rows.map(row => padRow_([
      row.group,
      row.question,
      row.unit,
      row.a.current ? row.a.current.value : "",
      row.a.current ? row.a.current.n : "",
      row.a.previous ? row.a.previous.value : "",
      row.a.previous ? row.a.previous.n : "",
      row.a.delta !== null ? row.a.delta : "",
      significanceLabel(row.a.significant),
      row.b.current ? row.b.current.value : "",
      row.b.current ? row.b.current.n : "",
      row.b.previous ? row.b.previous.value : "",
      row.b.previous ? row.b.previous.n : "",
      row.b.delta !== null ? row.b.delta : "",
      significanceLabel(row.b.significant),
      row.gapCurrent !== null ? row.gapCurrent : "",
      significanceLabel(row.gapSignificant),
      row.comment
    ]));

    return {
      header: header,
      fullHeader: fullHeader,
      numCols: numCols,
      passportRows: passportRows,
      tableRows: tableRows,
      widths: [140, 260, 55, 110, 65, 110, 65, 90, 140, 110, 65, 110, 65, 90, 140, 130, 140, 480]
    };

  },

  /**
   * Цвет ячеек "Разрыв 2026"/"Значимость разрыва 2026" для одной строки
   * таблицы — зависит от направления шкалы метрики (`row.higherIsBetter`,
   * см. TeamTypeComparison.metricFor_/Norms.THRESHOLDS[scaleKey].direction),
   * а НЕ от одного лишь знака gapCurrent: для риск-метрик (выгорание,
   * смена работы) более высокое значение у сервисных команд — это ХУЖЕ,
   * а не лучше. Незначимый или нулевой разрыв не подсвечивается вовсе
   * (нейтральный статус) — раньше здесь была одна безусловная красная
   * заливка для любого значимого разрыва независимо от смысла метрики.
   *
   * @returns {String|null} null — подсветки нет (нейтрально)
   */
  teamTypeComparisonGapColor_(row) {

    if (row.gapSignificant !== true || row.gapCurrent === null || row.gapCurrent === 0) return null;

    const servedBetter = row.higherIsBetter ? row.gapCurrent > 0 : row.gapCurrent < 0;

    return servedBetter ? Norms.COLORS[Norms.STATUS.EXCELLENT] : Norms.COLORS[Norms.STATUS.CRITICAL];

  },

  /**
   * Лист "Сервисные vs доменные": заголовок/описание (Formatter.
   * writeSheetIntro), паспорт и сама таблица занимают ОДИН И ТОТ ЖЕ
   * диапазон колонок A..R — numCols берётся из fullHeader.length в
   * ОДНОМ месте (buildTeamTypeComparisonSheetModel_), поэтому паспорт и
   * таблица не могут разъехаться по ширине.
   */
  writeTeamTypeComparison_() {

    const sheet = this.sheet_(this.SHEETS.TEAM_TYPE_COMPARISON);
    const comparison = this.prepareTeamTypeComparison_();
    const model = this.buildTeamTypeComparisonSheetModel_(comparison);
    const numCols = model.numCols;

    const startRow = Formatter.writeSheetIntro(sheet,
      "Сервисные команды против доменной разработки — " + comparison.division,
      "Прямое сравнение двух групп внутри " + comparison.division +
        ": обе группы за 2026 и 2025, годовая динамика каждой группы отдельно и разрыв между группами в 2026. " +
        "Сервисные команды других управлений и отделы без указанного типа команды в сравнение не входят.",
      numCols);

    sheet.getRange(startRow, 1, model.passportRows.length, numCols).setValues(model.passportRows);
    sheet.getRange(startRow, 1, 1, numCols).setFontWeight("bold");
    sheet.getRange(startRow + 1, 1, 1, numCols).setFontWeight("bold").setBackground("#ededed");
    sheet.getRange(startRow + 4, 1, 1, numCols).setFontStyle("italic").setFontColor(Formatter.MUTED_TEXT_COLOR);

    const tableStartRow = startRow + model.passportRows.length;

    this.dump_(sheet, model.fullHeader, model.tableRows, model.widths,
      tableStartRow, [
        [15, "Разница значений двух групп за 2026 год (Сервисная команда − Доменная разработка). Знак сам по себе не означает \"лучше\"/\"хуже\" — направление зависит от смысла метрики (см. цвет ячейки и подсказку следующей колонки)."],
        [16, "Подтвержден ли разрыв 2026 года статистически. Зелёный — у сервисных команд лучший результат по смыслу метрики (для риск-метрик, наоборот, меньшее значение — лучше); красный — у сервисных команд худший результат; без подсветки — разница не подтверждена статистически либо равна нулю."]
      ]);

    model.tableRows.forEach((row, i) => {

      const dataRow = tableStartRow + 1 + i;
      const color = this.teamTypeComparisonGapColor_(comparison.rows[i]);

      if (color) sheet.getRange(dataRow, 16, 1, 2).setBackground(color).setFontWeight("bold");

    });

    sheet.getRange(tableStartRow + 1, model.fullHeader.length, model.tableRows.length, 1)
      .setWrap(true).setVerticalAlignment("top");

    const exampleRow = comparison.rows.find(row => row.gapCurrent !== null);

    const examples = { teamTypeComparison: Glossary.EXAMPLE.teamTypeComparison(exampleRow) };

    const lastDataRow = tableStartRow + model.tableRows.length;
    Formatter.writeGlossaryBlock(sheet, lastDataRow + 2, model.fullHeader.length, ["teamTypeComparison"], examples);

    sheet.setHiddenGridlines(true);

  },

  /**
   * Построить и записать ОДИН лист расширенной аналитики вместо всех
   * сразу (см. runAdvancedAnalytics* в Menu.gs — пункты подменю
   * "Расширенная аналитика"). analytics строится заново при каждом
   * вызове (та же цена, что и внутри run(), просто не переиспользуется
   * между листами) — зато остальные листы остаются нетронутыми: только
   * лист key пересоздается (см. sheet_/ManagerTeamReport.sheet_), все
   * прочие листы отчета не трогаются.
   *
   * @param {String} key - одно из значений AnalyticsWriter.SHEETS
   * @returns {Object} analytics — для текста подтверждения в UI (n анкет)
   */
  writeOne_(key) {

    if (key === this.SHEETS.METHODOLOGY) {
      this.writeMethodology_();
      return null;
    }

    // Самостоятельный лист (как "Руководитель и команда") — не строится
    // из company-wide AnalyticsService.build ниже, а загружает свои
    // данные (см. prepareTeamTypeComparison_).
    if (key === this.SHEETS.TEAM_TYPE_COMPARISON) {
      this.writeTeamTypeComparison_();
      return null;
    }

    const analytics = AnalyticsService.build("2026", "2025", []);

    switch (key) {
      case this.SHEETS.FINDINGS:
        this.writeFindings_(analytics, AnalyticsService.findings(analytics));
        break;
      case this.SHEETS.TRAFFIC:
        this.writeTrafficLight_(analytics);
        break;
      case this.SHEETS.DRIVERS:
        this.writeDrivers_(analytics);
        break;
      case this.SHEETS.SEGMENTS:
        this.writeSegments_(analytics);
        break;
      case this.SHEETS.COHORT:
        this.writeCohort_(analytics);
        break;
      default:
        throw new Error('AnalyticsWriter.writeOne_: неизвестный лист "' + key + '"');
    }

    return analytics;

  }

};

/**
 * Пункты меню "Расширенная аналитика" (см. Menu.gs — подменю с этим же
 * названием). "Все сразу" строит analytics один раз и пишет все листы
 * (см. run()) — так же, как раньше работал единственный пункт меню.
 * Остальные пункты строят только один лист, не трогая остальные (см.
 * AnalyticsWriter.writeOne_).
 */
function runAdvancedAnalytics() {

  const ui = SpreadsheetApp.getUi();

  try {
    const analytics = AnalyticsWriter.run("2026", "2025", []);
    ui.alert("Готово",
      "Аналитика построена по " + analytics.meta.n + " анкетам.\n\n" +
      "Листы: Методика, Выводы, Светофор, Драйверы, Отклонения срезов, Связи срезов, Когорта, " +
      "Сервисные vs доменные, Руководитель и команда.",
      ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("Ошибка", String(error && error.message ? error.message : error), ui.ButtonSet.OK);
  }

}

/**
 * Общий обработчик одиночных пунктов подменю — строит analytics (если
 * нужно) и пишет только один лист key, с тем же UI-подтверждением/
 * обработкой ошибок, что и у "Все сразу".
 */
function runSingleAdvancedAnalyticsSheet_(key) {

  const ui = SpreadsheetApp.getUi();

  try {

    const analytics = AnalyticsWriter.writeOne_(key);

    ui.alert("Готово",
      'Лист "' + key + '" обновлен' +
      (analytics ? " по " + analytics.meta.n + " анкетам." : "."),
      ui.ButtonSet.OK);

  } catch (error) {
    ui.alert("Ошибка", String(error && error.message ? error.message : error), ui.ButtonSet.OK);
  }

}

function runMethodologyOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.METHODOLOGY); }
function runFindingsOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.FINDINGS); }
function runTrafficLightOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.TRAFFIC); }
function runDriversOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.DRIVERS); }
function runSegmentsOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.SEGMENTS); }
function runCohortOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.COHORT); }
function runTeamTypeComparisonOnly() { runSingleAdvancedAnalyticsSheet_(AnalyticsWriter.SHEETS.TEAM_TYPE_COMPARISON); }

/**
 * "Руководитель и команда" не входит в AnalyticsWriter.SHEETS (это
 * отдельный модуль ManagerTeamReport, не зависящий от AnalyticsService) —
 * поэтому свой отдельный обработчик, а не через writeOne_.
 */
function runManagerTeamOnly() {

  const ui = SpreadsheetApp.getUi();

  try {
    ManagerTeamReport.write();
    ui.alert("Готово", 'Лист "Руководитель и команда" обновлен.', ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("Ошибка", String(error && error.message ? error.message : error), ui.ButtonSet.OK);
  }

}
