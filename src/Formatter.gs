/**
 * ==========================================================
 * Оформление отчета
 * ==========================================================
 */

const Formatter = {

  // ----------------------------------------------------------------
  // Палитра редизайна отчета (макет "Вар3 светлый, средний отступ").
  // Используется ТОЛЬКО новыми report*/apply* методами ниже — методы,
  // которые переиспользует Summary.gs (applyBaseFont/formatTableHeader/
  // freezeHeader), палитру не трогают и остаются как были, чтобы не
  // затронуть внешний вид сводного листа (см. Summary.gs).
  // ----------------------------------------------------------------
  REPORT_FONT: "Calibri",
  TITLE_BG: "#2F6169",
  SECTION_BAND_BG: "#2F6169",
  LABEL_TEXT_COLOR: "#3D5A73",
  ACCENT_TEAL: "#3FB8B1",
  STRIPE_BG: "#F2F7F7",
  HIGHLIGHT_BG: "#EAF6F6",
  HIGHLIGHT_TEXT_COLOR: "#2C4054",
  MUTED_TEXT_COLOR: "#8C97A1",

  /**
   * Базовый шрифт для всего отчета (используется и Summary.gs — состав
   * и размер шрифта менять нельзя, см. REPORT_FONT/applyReportBaseFont
   * для нового вида отчетов ReportBuilder).
   */
  applyBaseFont(range) {
    range.setFontFamily("Arial").setFontSize(10);
  },

  /**
   * Базовый шрифт отчета ReportBuilder по новому макету — Calibri,
   * вместо applyBaseFont (тот переиспользует Summary.gs и не меняется).
   */
  applyReportBaseFont(range) {
    range.setFontFamily(this.REPORT_FONT).setFontSize(10);
  },

  /**
   * Главный заголовок отчета — синяя полоса на всю ширину, белый
   * жирный текст по центру (см. C1 макета). sheet нужен для
   * mergeAcross/высоты строки — сам заголовок пишется в одну ячейку
   * (см. ReportBuilder.renderHeader_), а полоса должна визуально
   * закрывать всю ширину таблицы.
   */
  formatReportMainTitle(sheet, range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(13)
      .setFontWeight("bold")
      .setFontColor("#FFFFFF")
      .setBackground(this.TITLE_BG)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .mergeAcross();
    sheet.setRowHeight(range.getRow(), 33.75);
  },

  /**
   * Название раздела — та же полоса-баннер, что и главный заголовок, но
   * чуть менее ярким синим (см. C5/C10/C18 макета: "Short Summary",
   * "КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ", "Состав выборки" и т.д.). Шрифт/размер — те
   * же, что у главного заголовка (formatReportMainTitle), для единого
   * вида всех названий блоков; полоса главного заголовка выделяется
   * большей высотой строки и выравниванием по центру (а не слева, как
   * у заголовков разделов).
   */
  formatSectionTitle(sheet, range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(13)
      .setFontWeight("bold")
      .setFontColor("#FFFFFF")
      .setBackground(this.SECTION_BAND_BG)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .mergeAcross();
    sheet.setRowHeight(range.getRow(), 24);
  },

  /**
   * Подпись-метка подраздела ("Город", "⭐ eNPS", "🏢 Офис" и т.д.) —
   * синий жирный текст с тонким бирюзовым подчеркиванием (см. C11/C19
   * макета). НЕ путать с обычным жирным текстом строки списка (см.
   * ReportBuilder.renderAverageScoreRankItem_/renderRankedAnswerList_ —
   * там жирный текст строки рейтинга оформляется отдельно, не через
   * formatLabel, кроме заголовка самого пункта рейтинга, который по
   * макету — такая же подпись-подраздел).
   */
  formatLabel(sheet, range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(11)
      .setFontWeight("bold")
      .setFontColor(this.LABEL_TEXT_COLOR)
      .setBorder(false, false, true, false, false, false, this.ACCENT_TEAL, SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(range.getRow(), 18);
  },

  /**
   * Заголовок таблицы: жирный текст, светло-серый фон. Используется и
   * Summary.gs — вид менять нельзя (см. applyBaseFont). Для нового
   * вида мини-таблиц отчета ReportBuilder см. formatReportTableHeader/
   * formatRawDataHeader.
   */
  formatTableHeader(range) {
    range
      .setFontWeight("bold")
      .setBackground("#f3f3f3");
  },

  /**
   * Заголовок мини-таблицы отчета ("Ответ" / "2026" / "Δ") — белый
   * жирный текст на бирюзовом фоне (см. C13/D13 макета).
   */
  formatReportTableHeader(range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(9)
      .setFontWeight("bold")
      .setFontColor("#FFFFFF")
      .setBackground(this.ACCENT_TEAL);
  },

  /**
   * Заголовок таблицы "Сырые данные" — та же бирюзовая заливка, что и
   * formatReportTableHeader, но крупнее (10pt), без переноса текста и с
   * фиксированной высотой строки (см. C526.. макета).
   */
  formatRawDataHeader(sheet, range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(10)
      .setFontWeight("bold")
      .setFontColor("#FFFFFF")
      .setBackground(this.ACCENT_TEAL)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .setWrap(false);
    sheet.setRowHeight(range.getRow(), 18);
  },

  /**
   * KPI-карточка крупного выделенного числа (eNPS, средняя оценка) —
   * бирюзовая рамка, бледно-бирюзовый фон, крупный жирный текст по
   * центру (см. C12/C358 макета).
   */
  applyReportHighlightCard(sheet, range) {
    range
      .setFontFamily(this.REPORT_FONT)
      .setFontSize(22)
      .setFontWeight("bold")
      .setFontColor(this.HIGHLIGHT_TEXT_COLOR)
      .setBackground(this.HIGHLIGHT_BG)
      .setBorder(true, true, true, true, false, false, this.ACCENT_TEAL, SpreadsheetApp.BorderStyle.SOLID)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(range.getRow(), 25.5);
  },

  /**
   * Чередующаяся заливка строк компактного списка ("зебра") — четные
   * (0-based) строки списка без заливки, нечетные — светло-серо-голубым
   * фоном (см. STRIPE_BG). rowIndex — позиция строки внутри конкретного
   * списка (с нуля), а не номер строки листа — у каждого списка своя
   * независимая нумерация.
   */
  applyZebraStripe(range, rowIndex) {
    range.setBackground(rowIndex % 2 === 1 ? this.STRIPE_BG : null);
  },

  /**
   * Ширина столбцов листа.
   * widths[i] задает ширину столбца (i + 1); пропуск элемента
   * (null/undefined) оставляет ширину столбца по умолчанию.
   */
  setColumnWidths(sheet, widths) {
    widths.forEach((width, index) => {
      if (width) {
        sheet.setColumnWidth(index + 1, width);
      }
    });
  },

  /**
   * Заморозить верхние строки и левые столбцы листа (например, чтобы
   * заголовок/паспорт/exec summary оставались видны при прокрутке).
   */
  freezeHeader(sheet, rows, columns) {
    sheet.setFrozenRows(rows);
    sheet.setFrozenColumns(columns);
  },

  /**
   * Свернуть/сгруппировать диапазон строк (например, секцию анкеты
   * или отдельный вопрос внутри нее) в сворачиваемую группу.
   */
  groupRows(sheet, startRow, numRows, collapsed) {

    sheet.getRange(startRow, 1, numRows).shiftRowGroupDepth(1);

    if (collapsed) {
      const group = sheet.getRowGroup(startRow, 1);
      if (group) {
        group.collapse();
      }
    }

  },

  /**
   * Стиль баннера предупреждения (например, о нерепрезентативной
   * выборке) — бледно-желтый фон, жирный текст. Данные при этом не
   * скрываются, баннер только привлекает внимание.
   */
  formatWarningBanner(range) {
    range.setBackground("#fff2cc").setFontWeight("bold");
  },

  /**
   * Подсказка при наведении на ячейку — тонкая обертка над setNote
   * для единообразия вызовов (см. Glossary.gs — тексты подсказок).
   */
  note(range, text) {
    range.setNote(text);
  },

  /**
   * Заголовок листа расширенной аналитики: строка 1 — двухчастное
   * название листа ("понятный смысл — термин", см. Glossary.gs),
   * строка 2 — короткое описание, что показывает лист и как им
   * пользоваться, строка 3 — пустая. Возвращает номер первой
   * свободной строки под таблицу (4), чтобы вызывающий код знал,
   * с какой строки писать dump_.
   */
  writeSheetIntro(sheet, title, description, numCols) {

    const titleRange = sheet.getRange(1, 1, 1, numCols);
    titleRange.setValue(title);
    titleRange
      .setFontWeight("bold")
      .setFontSize(13)
      .setFontColor("#ffffff")
      .setBackground(AnalyticsWriter.HEADER_BG)
      .setVerticalAlignment("middle")
      .mergeAcross();
    sheet.setRowHeight(1, 30);

    const descRange = sheet.getRange(2, 1, 1, numCols);
    descRange.setValue(description);
    descRange
      .setFontStyle("italic")
      .setFontColor(this.MUTED_TEXT_COLOR)
      .setWrap(true)
      .setVerticalAlignment("middle")
      .mergeAcross();
    sheet.setRowHeight(2, 30);

    return 4;

  },

  /**
   * Свёрнутый по умолчанию блок "Подробнее о расчете" под таблицей
   * листа расширенной аналитики: для каждого ключа из entryKeys берет
   * запись из Glossary.ENTRIES и печатает подзаголовок (двухчастное
   * title) и по одной строке на "зачем"/"формула"/"как читать"/
   * "на что обратить внимание". Возвращает число записанных строк.
   *
   * @param {Object} examples - {ключ методики: строка примера | null}.
   *   Строка приходит из Glossary.EXAMPLE.<ключ>(...), посчитанного
   *   вызывающим кодом (AnalyticsWriter.gs) из реальных данных этого
   *   запуска — здесь она просто печатается отдельной строкой, без
   *   собственных чисел из методички.
   */
  writeGlossaryBlock(sheet, startRow, numCols, entryKeys, examples) {

    examples = examples || {};
    const rows = [];

    entryKeys.forEach(key => {

      const entry = Glossary.ENTRIES[key];
      if (!entry) return;

      rows.push([entry.title, "heading"]);
      rows.push(["Зачем это нужно: " + entry.why, "text"]);
      rows.push(["Как рассчитывается: " + entry.formula, "text"]);
      rows.push(["Простыми словами: " + entry.formulaPlain, "text"]);
      rows.push(["Как читать результат: " + entry.howToRead, "text"]);
      rows.push(["На что обратить внимание: " + entry.limitations, "text"]);

      if (examples[key]) {
        rows.push([examples[key], "example"]);
      }

      rows.push(["", "spacer"]);

    });

    if (!rows.length) return 0;

    rows.forEach((row, i) => {

      const range = sheet.getRange(startRow + i, 1, 1, numCols);
      range.merge();
      range.setValue(row[0]);
      range.setWrap(true).setVerticalAlignment("top");

      if (row[1] === "heading") {
        range.setFontWeight("bold").setFontColor(this.LABEL_TEXT_COLOR).setFontSize(11);
      } else if (row[1] === "example") {
        range.setFontStyle("italic").setFontWeight("bold").setFontColor(this.HIGHLIGHT_TEXT_COLOR).setFontSize(9);
      } else {
        range.setFontSize(9).setFontColor(this.MUTED_TEXT_COLOR);
      }

    });

    this.groupRows(sheet, startRow, rows.length, true);

    return rows.length;

  },

  /**
   * Толстая верхняя граница — визуально отделяет крупный блок
   * (например, "Сырые данные") от всего, что расположено выше.
   */
  formatSectionDivider(range) {
    range.setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID_THICK);
  },

  /**
   * Подсветка ячеек динамики (Δ): зеленый фон при заметном росте,
   * красный при заметном снижении, без подсветки — если изменение
   * меньше порога. Порог передается вызывающей стороной (например,
   * ReportBuilder) — какой именно порог считать "заметным" для
   * конкретного показателя, это знание о предметной области отчета,
   * а не об оформлении.
   */
  applyDeltaHighlighting(sheet, range, threshold) {

    const positiveRule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(threshold)
      .setBackground("#d9ead3")
      .setFontColor("#274e13")
      .setRanges([range])
      .build();

    const negativeRule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThanOrEqualTo(-threshold)
      .setBackground("#f4cccc")
      .setFontColor("#990000")
      .setRanges([range])
      .build();

    const rules = sheet.getConditionalFormatRules();
    rules.push(positiveRule, negativeRule);
    sheet.setConditionalFormatRules(rules);

  },

  /**
   * Числовой формат для ячейки динамики: знак и стрелка (▲/▼/–)
   * встроены в формат самой ячейки, а не в текст — значение остается
   * числом (сортируется, к нему применимо условное форматирование
   * выше), но всегда читается со знаком и стрелкой, а не только по
   * цвету. suffix — необязательная подпись после числа (например
   * " п.п."), иначе используется как есть (например, для баллов).
   */
  applyDeltaNumberFormat(range, suffix) {

    const unit = suffix || "";

    range.setNumberFormat(
      '"▲ +"0.0"' + unit + '";"▼ "-0.0"' + unit + '";"– "0.0"' + unit + '"'
    );

  },

  /**
   * Мини-полоса прогресса 0..100% в ячейке: "█████░░░" — длина всей
   * полосы (segments * percent/100, зеленый) отражает percent, дальше
   * ячейка остается пустой (без серого "хвоста" на всю ширину) — по
   * этому длина полосы у разных строк отличается и явно читается на
   * глаз, как на остальных полосах отчета. Реализовано через
   * RichTextValue (посимвольная заливка одной строки из блочных
   * символов), а не SPARKLINE — так полоса выглядит как ряд сегментов,
   * а не как непрерывный залитый прямоугольник.
   */
  setBlockProgressBar(cell, percent, segments, color) {

    // 8 сегментов + уменьшенный (9pt вместо базовых 10pt) шрифт —
    // подобрано с запасом, чтобы полоса даже при 100% не доходила до
    // границы стандартной ширины столбца отчета (110px, см.
    // ReportBuilder createReport/setColumnWidths). color — цвет
    // закрашенных сегментов (по умолчанию базовый зеленый) — вызывающая
    // сторона может передать цвет по смыслу категории (например,
    // зеленый/желтый/красный у категорий eNPS, бирюзовый у обычных
    // Да/Нет списков), это знание о предметной области отчета, а не об
    // оформлении.
    const total = segments || 8;
    const fontSize = 9;
    const clamped = Math.max(0, Math.min(100, percent || 0));
    // Ненулевой процент никогда не округляется до 0 сегментов — иначе
    // полоса стала бы неотличима от настоящего 0% при малых процентах.
    let filled = Math.round(clamped / 100 * total);
    if (filled === 0 && clamped > 0) {
      filled = 1;
    }

    const builder = SpreadsheetApp.newRichTextValue().setText("█".repeat(filled));

    if (filled > 0) {
      builder.setTextStyle(0, filled,
        SpreadsheetApp.newTextStyle().setForegroundColor(color || "#34a853").setFontSize(fontSize).build());
    }

    cell.setRichTextValue(builder.build());

    // Обрезаем полосу по границе ячейки (а не даем ей "переливаться" в
    // соседнюю пустую ячейку) — иначе при малейшем расхождении реальной
    // ширины символов с расчетом (шрифт/масштаб/DPI) полоса визуально
    // выходит за пределы своей колонки.
    cell.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  },

  /**
   * Мелкий серый текст — например, справочная строка "2025: ..." под
   * основным (2026) списком, где акцент намеренно смещен на текущий год.
   */
  formatMutedSmall(range) {
    range.setFontFamily(this.REPORT_FONT).setFontColor(this.MUTED_TEXT_COLOR).setFontSize(9);
  },

  /**
   * Ячейка с текстом "префикс + остальной текст", где префикс выделен
   * своим цветом и жирным, а остальной текст — обычным (например,
   * "Самые высокие показатели: " зеленым перед списком значений).
   */
  setColoredPrefixText(cell, prefix, rest, prefixColor) {

    const builder = SpreadsheetApp.newRichTextValue().setText(prefix + rest);

    builder.setTextStyle(0, prefix.length,
      SpreadsheetApp.newTextStyle().setForegroundColor(prefixColor).setBold(true).build());

    cell.setRichTextValue(builder.build());

  },

  /**
   * Ячейка с целиком заданным текстом, где один фрагмент произвольной
   * позиции (не обязательно префикс, в отличие от setColoredPrefixText)
   * выделен своим цветом — например, слово "выше"/"ниже" посреди строки
   * "eNPS: 63 (выше на 7 п.п.) · ...". Без покраски вовсе, если start
   * равен null (фрагмента для выделения нет, например "eNPS на уровне
   * компании" — красить нечего).
   */
  setColoredSubstring(cell, text, start, length, color) {

    const builder = SpreadsheetApp.newRichTextValue().setText(text);

    if (start !== null && length > 0) {
      builder.setTextStyle(start, start + length,
        SpreadsheetApp.newTextStyle().setForegroundColor(color).build());
    }

    cell.setRichTextValue(builder.build());

  },

  DELTA_GOOD_COLOR: "#1F8A5F",
  DELTA_BAD_COLOR: "#D1483A",
  DELTA_NEUTRAL_COLOR: "#808A94",

  /**
   * Цвет текста Δ по смыслу изменения, а не только по математическому
   * знаку — знак/стрелка сами не меняются (это забота
   * applyCompactDeltaNumberFormat/applyDeltaNumberFormat), меняется
   * только то, каким цветом красится уже готовое число.
   *
   * desiredDirection — какое направление изменения для конкретного
   * варианта ответа считается улучшением (см. ReportBuilder.GOOD_DIRECTION_):
   *   "up"      — рост хорошо: Δ>0 зеленый, Δ<0 красный (как было раньше);
   *   "down"    — снижение хорошо: цвет инвертирован (Δ>0 красный, Δ<0 зеленый);
   *   "neutral" — направления нет, всегда серый вне зависимости от знака.
   * Δ = 0 или отсутствует — всегда серый, при любом desiredDirection.
   */
  resolveDeltaColor(delta, desiredDirection) {

    if (desiredDirection === "neutral" || delta === null || delta === undefined || delta === 0) {
      return this.DELTA_NEUTRAL_COLOR;
    }

    const isIncrease = delta > 0;
    const isGoodChange = desiredDirection === "down" ? !isIncrease : isIncrease;

    return isGoodChange ? this.DELTA_GOOD_COLOR : this.DELTA_BAD_COLOR;

  },

  /**
   * Установить цвет текста ячейки Δ по resolveDeltaColor. Красит
   * конкретную ячейку напрямую (а не через conditional format rule на
   * весь диапазон), т.к. desiredDirection может отличаться от строки к
   * строке одного и того же списка (например, "Да" и "Нет" в одном
   * компактном списке имеют разное желаемое направление).
   */
  setDeltaFontColor(cell, delta, desiredDirection) {
    cell.setFontColor(this.resolveDeltaColor(delta, desiredDirection));
  },

  /**
   * Числовой формат со знаком: положительные значения — с явным "+"
   * (отрицательные и так показывают "-" по умолчанию, ноль — без знака).
   * Для ячеек-значений, которые могут быть отрицательными (например,
   * eNPS от -100 до 100), где знак важен независимо от направления
   * "хорошо/плохо" (та задача — у Δ, см. resolveDeltaColor).
   */
  applySignedIntegerFormat(range) {
    range.setNumberFormat("+0;-0;0");
  },

  /**
   * Общий шаблон компактной дельты (стрелка + знак, без "–" перед
   * нулем) — digitPattern задает точность ("0.0" или "0"), остальное
   * одинаково для applyCompactDeltaNumberFormat/applyCompactDeltaIntegerFormat.
   * Стрелки/знаки/структура формата меняются только здесь, в одном месте.
   */
  buildCompactDeltaFormat_(digitPattern) {
    return '"▲ +"' + digitPattern + ';"▼ -"' + digitPattern + ';' + digitPattern;
  },

  /**
   * Числовой формат дельты без суффикса-единицы (единица вынесена в
   * заголовок столбца, например "Δ (п.п.)") и без "–" перед нулем —
   * нулевое значение показывается как простое "0,0", без стрелки.
   */
  applyCompactDeltaNumberFormat(range) {
    range.setNumberFormat(this.buildCompactDeltaFormat_("0.0"));
  },

  /**
   * То же самое, что applyCompactDeltaNumberFormat (стрелка, знак, без
   * "–" перед нулем), но без десятых — для дельт, где дробная часть не
   * нужна визуально (например, "▲ +4", а не "▲ +4,0").
   */
  applyCompactDeltaIntegerFormat(range) {
    range.setNumberFormat(this.buildCompactDeltaFormat_("0"));
  },

  /**
   * То же самое, но с двумя десятичными знаками — для дельт средних
   * оценок (шкала 1-5 с точностью до сотых), где одного знака
   * недостаточно и визуально завышает изменение (например, реальная
   * разница +0,05 иначе показывалась бы как "▲ +0,1").
   */
  applyCompactDeltaTwoDecimalFormat(range) {
    range.setNumberFormat(this.buildCompactDeltaFormat_("0.00"));
  },

};