/**
 * ==========================================================
 * Сравнение "Сервисные vs доменные" внутри Управления разработки ПО
 * ==========================================================
 *
 * ЗАЧЕМ. "Отклонения срезов" сравнивает каждую группу "Управление +
 * Тип команды" (см. Headcount.teamGroupOf, срез "Группа команд" в
 * Segments/AnalyticsService) с нормой ВСЕЙ компании. Это не отвечает
 * на конкретный вопрос HR: чем отличаются друг от друга сервисные
 * команды и доменная разработка ВНУТРИ одного управления — Управления
 * разработки ПО. Этот модуль строит такое прямое сравнение.
 *
 * ГРАНИЦЫ СРАВНЕНИЯ. Строго внутри TARGET_DIVISION: сервисные команды
 * ИТ-управления (или любого другого) сюда не попадают — группа
 * определяется составным ключом "Управление + Тип команды" (правило
 * 9-10 в заголовке Headcount.gs), а не одним лишь названием типа
 * команды.
 *
 * ЧИСТЫЙ МОДУЛЬ. Никаких обращений к SpreadsheetApp — только Headcount
 * (членство отделов в группах), Segments (нормализация ключей),
 * Scoring/MathStats/Norms (та же методика выбора метрики и проверки
 * значимости, что в AnalyticsService.trafficLight_/Segments.analyze —
 * никаких альтернативных формул). Запись и оформление листа —
 * AnalyticsWriter.gs.
 *
 * ПУСТЫЕ ДАННЫЕ НЕ СТАНОВЯТСЯ НУЛЕМ. Если у группы за год нет ни
 * одного ответа на вопрос, metricFor_ возвращает null, а не 0 — так
 * же, как это устроено в остальном проекте (Scoring/Segments).
 */

const TeamTypeComparison = {

  TARGET_DIVISION: "Управление разработки ПО",
  GROUP_A_LABEL: "Сервисная команда",
  GROUP_B_LABEL: "Доменная разработка",

  /**
   * @param {Array<Array>} rows2026
   * @param {Array<String>} headers2026
   * @param {Array<Array>|null} rows2025 - null, если данных 2025 нет
   * @param {Array<String>|null} headers2025
   * @param {Array<Object>} questions - вопросы для сравнения (см.
   *   AnalyticsWriter.prepareTeamTypeComparison_: те же report-вопросы,
   *   что в Светофоре/Segments.metricsFor, без text/single)
   * @returns {Object} паспорт + построчное сравнение по каждому вопросу
   */
  build(rows2026, headers2026, rows2025, headers2025, questions) {

    const hasPrevious = !!rows2025;

    const rowsA2026 = this.rowsForGroup_(rows2026, headers2026, "2026", this.GROUP_A_LABEL);
    const rowsB2026 = this.rowsForGroup_(rows2026, headers2026, "2026", this.GROUP_B_LABEL);
    const rowsA2025 = hasPrevious ? this.rowsForGroup_(rows2025, headers2025, "2025", this.GROUP_A_LABEL) : null;
    const rowsB2025 = hasPrevious ? this.rowsForGroup_(rows2025, headers2025, "2025", this.GROUP_B_LABEL) : null;

    const invitedA2026 = Headcount.forTeamGroup("2026", this.groupLabel_(this.GROUP_A_LABEL)).count;
    const invitedB2026 = Headcount.forTeamGroup("2026", this.groupLabel_(this.GROUP_B_LABEL)).count;
    const invitedA2025 = hasPrevious ? Headcount.forTeamGroup("2025", this.groupLabel_(this.GROUP_A_LABEL)).count : null;
    const invitedB2025 = hasPrevious ? Headcount.forTeamGroup("2025", this.groupLabel_(this.GROUP_B_LABEL)).count : null;

    const passport = {
      division: this.TARGET_DIVISION,
      a: this.passportSide_(this.GROUP_A_LABEL, rowsA2026.length, hasPrevious ? rowsA2025.length : null, invitedA2026, invitedA2025),
      b: this.passportSide_(this.GROUP_B_LABEL, rowsB2026.length, hasPrevious ? rowsB2025.length : null, invitedB2026, invitedB2025),
      note: "Отделы без указанного типа команды в этом сравнении не участвуют ни за один год " +
        "(см. Headcount.gs — поле «Тип команды» необязательное)."
    };

    const rows = questions.map(question => this.compareQuestion_(
      question, headers2026, headers2025, rowsA2026, rowsA2025, rowsB2026, rowsB2025, hasPrevious
    ));

    return {
      division: this.TARGET_DIVISION,
      groupALabel: this.GROUP_A_LABEL,
      groupBLabel: this.GROUP_B_LABEL,
      hasPrevious: hasPrevious,
      passport: passport,
      rows: rows
    };

  },

  groupLabel_(teamType) {
    return this.TARGET_DIVISION + Headcount.TEAM_GROUP_SEPARATOR + teamType;
  },

  passportSide_(label, n2026, n2025, invited2026, invited2025) {
    return {
      label: label,
      n2026: n2026,
      n2025: n2025,
      invited2026: invited2026,
      invited2025: invited2025,
      responseRate2026: invited2026 ? MathStats.round(n2026 / invited2026 * 100, 1) : null,
      responseRate2025: (invited2025 && n2025 !== null) ? MathStats.round(n2025 / invited2025 * 100, 1) : null
    };
  },

  /**
   * Строки одной группы ("Управление + Тип команды") за один год.
   * Принадлежность строки определяется по колонке "Отдел" через
   * Headcount.forDepartment для ЭТОГО года (правило 5 — годовая
   * принадлежность, нельзя переносить тип команды между годами).
   */
  rowsForGroup_(rows, headers, year, teamTypeLabel) {

    const departmentColumnIndex = headers.findIndex(
      h => Segments.normalizeKey_(h) === Segments.normalizeKey_("Отдел")
    );

    if (departmentColumnIndex === -1) return [];

    return rows.filter(row => {

      const entry = Headcount.forDepartment(year, row[departmentColumnIndex]);

      if (!entry || !entry.division || !entry.teamType) return false;

      return Segments.normalizeKey_(entry.division) === Segments.normalizeKey_(this.TARGET_DIVISION) &&
        Segments.normalizeKey_(entry.teamType) === Segments.normalizeKey_(teamTypeLabel);

    });

  },

  /**
   * Значение и n одной группы по одному вопросу — те же правила выбора
   * метрики, что и в Светофоре (AnalyticsService.trafficLight_):
   * eNPS — доверительный интервал; риск-вопросы (выгорание, смена
   * работы) — доля негатива (Norms.RISK_DENOMINATOR = "answered");
   * rating5 — среднее; обычные scale4/scale5 — доля позитива (два
   * верхних деления шкалы, см. Scoring.positiveShare). Не изобретает
   * новую математику — только уже существующие Scoring/MathStats/Norms.
   *
   * Каждый результат несёт `scaleKey` и `higherIsBetter` — направление
   * шкалы берётся из ЕДИНОГО источника (Norms.THRESHOLDS[scaleKey].direction),
   * а не отдельным правилом этого модуля: для риск-метрик (выгорание,
   * смена работы) рост числа — это ухудшение, для eNPS/rating5/обычных
   * scale4 — улучшение. Без этого признака разрыв «Сервисная − Доменная»
   * нельзя было бы корректно раскрасить (см. AnalyticsWriter.writeTeamTypeComparison_).
   *
   * @returns {Object|null} null — нет ни одного валидного ответа
   */
  metricFor_(question, rows, headers) {

    if (!rows || !rows.length) return null;

    const vector = Scoring.vector(rows, headers, question);
    const stats = MathStats.describe(vector);

    if (stats.n === 0) return null;

    const scaleKey = Norms.scaleKeyFor(question);
    const higherIsBetter = Norms.THRESHOLDS[scaleKey].direction === "up";

    if (question.type === "enps") {

      const valid = vector.filter(v => v !== null);
      const promoters = valid.filter(v => Scoring.enpsCategory(v) === "promoters").length;
      const detractors = valid.filter(v => Scoring.enpsCategory(v) === "detractors").length;
      const ci = MathStats.enpsConfidence(promoters, detractors, valid.length);

      if (ci.enps === null) return null;

      return {
        kind: "enps", scaleKey: scaleKey, higherIsBetter: higherIsBetter, unit: "пунктов", n: valid.length,
        value: MathStats.round(ci.enps, 1), margin: MathStats.round(ci.margin, 1)
      };

    }

    if (scaleKey === "burnoutRisk" || scaleKey === "leaveRisk") {

      const bad = vector.filter(v => v !== null && v <= 2).length;
      const valid = stats.n;

      return {
        kind: "share", scaleKey: scaleKey, higherIsBetter: higherIsBetter, unit: "%", n: valid,
        value: MathStats.round(bad / valid * 100, 1),
        _positive: bad, _valid: valid
      };

    }

    if (question.type === "rating5") {

      return {
        kind: "rating", scaleKey: scaleKey, higherIsBetter: higherIsBetter, unit: "балла", n: stats.n,
        value: MathStats.round(stats.mean, 2),
        _vector: vector
      };

    }

    // Остальные шкальные вопросы (scale4/scale5, не риск) — доля
    // позитива, как в Светофоре (два верхних деления шкалы).
    const share = Scoring.positiveShare(vector, 3);

    if (share.valid === 0) return null;

    return {
      kind: "share", scaleKey: scaleKey, higherIsBetter: higherIsBetter, unit: "%", n: share.valid,
      value: MathStats.round(share.percent, 1),
      _positive: share.positive, _valid: share.valid
    };

  },

  /**
   * Проверка значимости между двумя посчитанными metricFor_ — тест
   * выбирается по типу показателя: eNPS — сравнение доверительных
   * интервалов (MathStats.enpsChangeIsReal), средние — t-критерий
   * Уэлча (MathStats.welchTest), доли — z-критерий двух долей
   * (MathStats.zTestProportions). Те же функции, что использует
   * AnalyticsService.trafficLight_/Segments — не альтернативная формула.
   *
   * @returns {Boolean|null} null — сравнение невозможно (нет данных
   *   хотя бы с одной стороны), не то же самое, что false
   */
  significanceBetween_(x, y) {

    if (!x || !y) return null;

    if (x.kind === "enps") {
      return MathStats.enpsChangeIsReal(
        { enps: x.value, margin: x.margin }, { enps: y.value, margin: y.margin }
      );
    }

    if (x.kind === "rating") {
      const test = MathStats.welchTest(x._vector, y._vector);
      return test.t === null ? null : test.significant;
    }

    const test = MathStats.zTestProportions(x._positive, x._valid, y._positive, y._valid);
    return test.z === null ? null : test.significant;

  },

  roundDigitsFor_(kind) {
    return kind === "rating" ? 2 : 1;
  },

  deltaBetween_(current, previous) {
    if (!current || !previous) return null;
    return MathStats.round(current.value - previous.value, this.roundDigitsFor_(current.kind));
  },

  /**
   * Одна строка сравнения (один вопрос анкеты): обе группы за оба
   * года, годовая динамика каждой группы отдельно и разрыв между
   * группами за текущий (2026) год — каждое число со своим n,
   * значимость считается отдельно для каждой из трех проверок.
   */
  compareQuestion_(question, headers2026, headers2025, rowsA2026, rowsA2025, rowsB2026, rowsB2025, hasPrevious) {

    const a2026 = this.metricFor_(question, rowsA2026, headers2026);
    const a2025 = hasPrevious ? this.metricFor_(question, rowsA2025, headers2025) : null;
    const b2026 = this.metricFor_(question, rowsB2026, headers2026);
    const b2025 = hasPrevious ? this.metricFor_(question, rowsB2025, headers2025) : null;

    const reference = a2026 || b2026 || a2025 || b2025;
    const unit = reference ? reference.unit : "";
    const scaleKey = reference ? reference.scaleKey : null;
    const higherIsBetter = reference ? reference.higherIsBetter : null;
    const digits = this.roundDigitsFor_(reference ? reference.kind : null);

    // Разрыв всегда "Сервисная команда − Доменная разработка": знак сам
    // по себе не хороший и не плохой (см. заголовок метода comment_) —
    // хорошо это или плохо, решает higherIsBetter конкретной метрики.
    const gapCurrent = (a2026 && b2026) ? MathStats.round(a2026.value - b2026.value, digits) : null;

    const row = {
      question: question.title,
      group: question.group,
      subgroup: question.subgroup,
      unit: unit,
      scaleKey: scaleKey,
      higherIsBetter: higherIsBetter,
      hasPrevious: hasPrevious,
      a: {
        current: a2026, previous: a2025,
        delta: this.deltaBetween_(a2026, a2025),
        significant: this.significanceBetween_(a2026, a2025)
      },
      b: {
        current: b2026, previous: b2025,
        delta: this.deltaBetween_(b2026, b2025),
        significant: this.significanceBetween_(b2026, b2025)
      },
      gapCurrent: gapCurrent,
      gapSignificant: this.significanceBetween_(a2026, b2026)
    };

    row.comment = this.comment_(row);

    return row;

  },

  /**
   * Направление разрыва — нейтральная констатация "выше/ниже" по сырому
   * значению (Сервисная − Доменная), БЕЗ оценки "лучше/хуже": оценочный
   * смысл (хорошо это или плохо) несёт только раскраска ячейки в
   * AnalyticsWriter.writeTeamTypeComparison_ (через higherIsBetter), а
   * не эта фраза. Для риск-метрик (выгорание, смена работы) используется
   * отдельная формулировка "уровень риска выше/ниже" — рост риск-метрики
   * не то же самое, что рост обычного показателя.
   */
  directionPhrase_(servHigher, isRiskMetric) {

    if (isRiskMetric) {
      return servHigher ? "Уровень риска выше у сервисных команд" : "Уровень риска ниже у сервисных команд";
    }

    return servHigher ? "Сервисные команды выше доменной разработки" : "Сервисные команды ниже доменной разработки";

  },

  /**
   * Текстовое толкование строки — различает четыре исхода (см.
   * заголовок листа "Сервисные vs доменные" в требовании): статистически
   * подтвержденное различие, описательную разницу без подтверждения,
   * недостаточную базу, отсутствие данных одного из годов. Не использует
   * причинных формулировок ("потому что", "из-за") и не называет
   * отрицательную разницу автоматически плохой — направление описывается
   * нейтрально (directionPhrase_), оценка "лучше/хуже" остаётся только в
   * цвете ячейки (AnalyticsWriter), не в тексте.
   */
  comment_(row) {

    const parts = [];
    const a = row.a;
    const b = row.b;

    if (!a.current && !b.current) {
      return "Нет данных ни по одной из групп за 2026 год.";
    }

    if (!a.current) parts.push("Нет данных «" + this.GROUP_A_LABEL + "» за 2026.");
    if (!b.current) parts.push("Нет данных «" + this.GROUP_B_LABEL + "» за 2026.");

    if (a.current && b.current) {

      const smallBase = a.current.n < Norms.FRAGILE_SEGMENT_SIZE || b.current.n < Norms.FRAGILE_SEGMENT_SIZE;
      const isRiskMetric = row.scaleKey === "burnoutRisk" || row.scaleKey === "leaveRisk";

      if (row.gapCurrent === 0) {
        // Значения равны — не "разница есть в цифрах" (такой разницы
        // попросту нет), а прямая констатация отсутствия различия.
        parts.push(
          "Различий между группами в 2026 нет" +
          (smallBase ? " (малая база хотя бы в одной группе — учитывайте при интерпретации)." : ".")
        );
      } else if (row.gapSignificant === true) {
        parts.push(
          "Разрыв между группами в 2026 статистически подтвержден: " +
          this.directionPhrase_(row.gapCurrent > 0, isRiskMetric) + "." +
          (smallBase ? " Малая база хотя бы в одной группе — учитывайте при интерпретации." : "")
        );
      } else if (row.gapSignificant === false) {
        parts.push(
          this.directionPhrase_(row.gapCurrent > 0, isRiskMetric) +
          ", но статистически не подтверждено — описательное наблюдение."
        );
      }

    }

    [{ side: a, label: this.GROUP_A_LABEL }, { side: b, label: this.GROUP_B_LABEL }].forEach(item => {

      const side = item.side;

      if (!side.current) return;

      if (!row.hasPrevious || side.previous === null) {
        parts.push("«" + item.label + "»: данных 2025 нет — динамика год к году не считается.");
        return;
      }

      if (side.significant === true) {
        parts.push("«" + item.label + "»: изменение к 2025 значимо (Δ " +
          (side.delta > 0 ? "+" : "") + side.delta + ").");
      } else if (side.significant === false) {
        parts.push("«" + item.label + "»: изменение к 2025 в пределах погрешности.");
      }

    });

    return parts.join(" ");

  }

};
