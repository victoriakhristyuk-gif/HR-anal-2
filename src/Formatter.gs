/**
 * ==========================================================
 * Оформление отчета
 * ==========================================================
 */

const Formatter = {

  /**
   * Базовый шрифт для всего отчета
   */
  applyBaseFont(range) {
    range.setFontFamily("Arial").setFontSize(10);
  },

  /**
   * Главный заголовок отчета (16 pt, жирный)
   */
  formatMainTitle(range) {
    range.setFontSize(16).setFontWeight("bold");
  },

  /**
   * Название раздела (13 pt, жирный)
   */
  formatSectionTitle(range) {
    range.setFontSize(13).setFontWeight("bold");
  },

  /**
   * Подпись-метка (жирный текст)
   */
  formatLabel(range) {
    range.setFontWeight("bold");
  },

  /**
   * Заголовок таблицы: жирный текст, светло-серый фон
   */
  formatTableHeader(range) {
    range
      .setFontWeight("bold")
      .setBackground("#f3f3f3");
  },

  /**
   * Крупное выделенное число (например, итоговый eNPS)
   */
  formatHighlightNumber(range) {
    range.setFontSize(18).setFontWeight("bold");
  },

  /**
   * Внешняя и внутренняя рамка таблицы
   */
  addTableBorder(range) {
    range.setBorder(true, true, true, true, true, true);
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
   * Толстая верхняя граница — визуально отделяет крупный блок
   * (например, "Сырые данные") от всего, что расположено выше.
   */
  formatSectionDivider(range) {
    range.setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID_THICK);
  },

  /**
   * Цветовая шкала на диапазоне значений (например, средние оценки
   * 1-5 или проценты 0-100) — добавляется к уже существующим правилам
   * условного форматирования листа, не заменяя их.
   *
   * У ConditionalFormatRuleBuilder нет простого setGradientMidpoint(color)
   * (в отличие от Min/Max у него нет однозначного значения по умолчанию) —
   * средняя точка обязательно задается через setGradientMidpointWithValue
   * с явным типом интерполяции; берем 50% между минимумом и максимумом
   * диапазона.
   */
  applyColorScale(sheet, range, minColor, midColor, maxColor) {

    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(minColor)
      .setGradientMidpointWithValue(midColor, SpreadsheetApp.InterpolationType.PERCENT, "50")
      .setGradientMaxpoint(maxColor)
      .setRanges([range])
      .build();

    const rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);

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
   * Компактный горизонтальный мини-бар в ячейке (вместо отдельного
   * графика на каждую строку таблицы) — например, для наглядности
   * средней оценки на шкале 0..max в общем обзоре средних.
   */
  setBarFormula(cell, value, max) {
    cell.setFormula('=SPARKLINE(' + value + ',{"charttype","bar";"max",' + max + '})');
  },

  /**
   * Мини-полоса прогресса 0..100% в ячейке: "██████████░░░░░░░░" —
   * закрашенная часть (segments * percent/100, зеленый) отражает
   * percent, остаток до конца полосы — светло-серый. Реализовано через
   * RichTextValue (посимвольная заливка одной строки из блочных
   * символов), а не SPARKLINE — так полоса выглядит как ряд сегментов,
   * а не как непрерывный залитый прямоугольник.
   */
  setBlockProgressBar(cell, percent, segments) {

    // 11 сегментов + уменьшенный (9pt вместо базовых 10pt) шрифт —
    // подобрано так, чтобы полоса помещалась в стандартную ширину
    // столбца отчета (110px, см. ReportBuilder createReport/
    // setColumnWidths) с небольшим правым запасом (4-8px), и последний
    // серый сегмент не касался границы ячейки.
    const total = segments || 11;
    const fontSize = 9;
    const clamped = Math.max(0, Math.min(100, percent || 0));
    // Ненулевой процент никогда не округляется до 0 сегментов — иначе
    // полоса стала бы неотличима от настоящего 0% при малых процентах.
    let filled = Math.round(clamped / 100 * total);
    if (filled === 0 && clamped > 0) {
      filled = 1;
    }
    const text = "█".repeat(total);

    const builder = SpreadsheetApp.newRichTextValue().setText(text);

    if (filled > 0) {
      builder.setTextStyle(0, filled,
        SpreadsheetApp.newTextStyle().setForegroundColor("#34a853").setFontSize(fontSize).build());
    }

    if (filled < total) {
      builder.setTextStyle(filled, total,
        SpreadsheetApp.newTextStyle().setForegroundColor("#d9d9d9").setFontSize(fontSize).build());
    }

    cell.setRichTextValue(builder.build());

  },

  /**
   * Мелкий серый текст — например, справочная строка "2025: ..." под
   * основным (2026) списком, где акцент намеренно смещен на текущий год.
   */
  formatMutedSmall(range) {
    range.setFontColor("#999999").setFontSize(9);
  },

  DELTA_GOOD_COLOR: "#38761d",
  DELTA_BAD_COLOR: "#cc0000",
  DELTA_NEUTRAL_COLOR: "#666666",

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

  /**
   * Тонкая нижняя граница диапазона (например, разделитель строк в
   * компактном списке или под его заголовком) — в отличие от
   * addTableBorder/formatSectionDivider, не затрагивает остальные
   * стороны и не претендует на вид "таблицы".
   */
  addBottomBorder(range, color) {
    range.setBorder(false, false, true, false, false, false, color || "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
  }

};