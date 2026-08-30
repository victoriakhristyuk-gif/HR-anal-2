/**
 * ==========================================================
 * Нормы и светофор
 * ==========================================================
 *
 * ТРИ ОРИЕНТИРА, А НЕ ОДИН. На любом одном показатель читается
 * неверно:
 *
 *   – только абсолют → «всё хорошо, везде выше 4» и ноль выводов;
 *   – только динамика → шум объявляется трендом каждый год;
 *   – только внутреннее сравнение → у половины срезов «ниже среднего»
 *     по определению, и это ни о чем не говорит.
 *
 * Поэтому статус вопроса собирается из трех слоев:
 *   1) АБСОЛЮТНЫЙ УРОВЕНЬ — светофор по порогам;
 *   2) ДИНАМИКА к прошлому году, но только значимая;
 *   3) ВНУТРЕННЯЯ НОРМА — среднее по компании за текущий год, от
 *      которого отсчитываются отклонения срезов.
 *
 * ПОЧЕМУ ПОРОГИ ИМЕННО ТАКИЕ. Они откалиброваны под этот датасет,
 * а не взяты из учебника. Средние по rating5 лежат в диапазоне
 * 4,06–4,69 — при учебниковой границе «4,0 = хорошо» ВСЕ вопросы
 * попали бы в зеленую зону, и светофор перестал бы что-либо
 * различать. Пороги выбраны так, чтобы примерно поровну разделить
 * реальный разброс: верхняя треть, середина, нижняя треть, хвост.
 *
 * КАК ПЕРЕСМАТРИВАТЬ. Раз в год после сбора данных: посмотреть
 * фактический разброс средних и сдвинуть пороги, если он уехал.
 * Менять пороги ЧАЩЕ раза в год нельзя — иначе динамика статусов
 * между отчетами станет несопоставимой.
 */

const Norms = {

  STATUS: {
    EXCELLENT: "ОТЛИЧНО",
    GOOD: "ХОРОШО",
    WATCH: "ВНИМАНИЕ",
    CRITICAL: "КРИТИЧНО"
  },

  COLORS: {
    "ОТЛИЧНО": "#c6efce",
    "ХОРОШО": "#ffeb9c",
    "ВНИМАНИЕ": "#fcd5b4",
    "КРИТИЧНО": "#ffc7ce"
  },

  // Эмодзи-светофор тех же четырех статусов — для компактных строк
  // отчета, где нет заливки ячейки (например "Общая оценка раздела",
  // см. ReportBuilder.sectionScore_/renderSectionScoreRow_).
  STATUS_EMOJI: {
    "ОТЛИЧНО": "🟢",
    "ХОРОШО": "🟡",
    "ВНИМАНИЕ": "🟠",
    "КРИТИЧНО": "🔴"
  },

  /**
   * Пороги абсолютного уровня.
   * Направление "up" — чем больше, тем лучше; "down" — наоборот.
   */
  THRESHOLDS: {

    // Средний балл rating5 (1–5), «не пользовался» исключен.
    rating5: { direction: "up", excellent: 4.50, good: 4.30, watch: 4.10 },

    // Доля «да» + «скорее да» в процентах.
    scale4: { direction: "up", excellent: 95, good: 90, watch: 85 },

    // eNPS в пунктах.
    enps: { direction: "up", excellent: 60, good: 40, watch: 20 },

    // Доля выгорающих «регулярно» + «постоянно», проценты.
    burnoutRisk: { direction: "down", excellent: 10, good: 15, watch: 20 },

    // Доля думающих об уходе «время от времени» + «постоянно».
    leaveRisk: { direction: "down", excellent: 5, good: 10, watch: 15 },

    // Охват льготы — доля тех, у кого есть опыт.
    coverage: { direction: "up", excellent: 70, good: 50, watch: 35 },

    // "Общая оценка раздела" (ReportBuilder.sectionScore_) — среднее
    // normalizeLevel-оценок вопросов РАЗНЫХ типов внутри одного раздела
    // (rating5 вперемешку со scale4 и т.п.). Ни один из порогов выше
    // нельзя использовать напрямую: они калиброваны каждый под свою
    // метрику и в пространстве normalizeLevel расходятся — "отлично"
    // rating5 (4,50 из 5) превращается в 87,5%, а "отлично" scale4 —
    // уже само 95%, потому что это доля позитива, а не нормализованное
    // среднее. Пороги ниже — компромисс между этими двумя ориентирами,
    // округленный до целых; пересматривать не чаще раза в год, как и
    // остальные пороги файла.
    sectionScore: { direction: "up", excellent: 85, good: 75, watch: 65 }

  },

  /**
   * УПРАВЛЕНЧЕСКИЙ порог заметности — решение компании, ЧТО считать
   * достаточно крупной разницей, чтобы ей заниматься, а не статистика.
   *
   * Отличается от вопроса "отличается ли группа от нормы статистически" —
   * тот решается пересечением скорректированных ДИ (см.
   * statisticallyDifferent ниже), без фиксированного порога, для
   * группы ЛЮБОГО размера.
   *
   * enpsPoints: 15 ≈ 0,75 стандартного отклонения eNPS между отделами
   * компании (SD = 19,8 п. по отделам с n ≥ 8) — то есть примерно
   * три четверти типичного разброса между отделами. Не откалибровано
   * под конкретный размер группы (в отличие от прежней версии, которая
   * молчаливо предполагала группу 15-30 человек и одинаково
   * применялась что к отделу из 3, что из 289 человек) — порог один и
   * тот же для всех размеров, потому что это управленческое решение
   * "разница какого масштаба заслуживает внимания", а не статистическая
   * граница обнаружения.
   */
  DEVIATION: {
    ratingPoints: 0.20,   // баллы для rating5
    sharePp: 7,           // процентные пункты для долей
    enpsPoints: 15        // пункты для eNPS (≈ 0,75 SD между отделами)
  },

  /**
   * ЗНАМЕНАТЕЛЬ ДЛЯ РИСК-МЕТРИК — решение, которое надо принять
   * сознательно и один раз, потому что оно двигает цифру.
   *
   *   "answered" — от тех, кто выбрал точку шкалы. «Затрудняюсь
   *                ответить» не попадает ни в числитель, ни
   *                в знаменатель. Выгорание 2026 = 17,8%.
   *   "all"      — от всех респондентов. «Затрудняюсь» в знаменателе,
   *                но не в числителе. Выгорание 2026 = 16,5%.
   *
   * Разница 1,3 п.п. — не мелочь, когда порог «внимание/критично»
   * стоит на 20%.
   *
   * Выбран "answered": метрика отвечает на вопрос «какая доля тех,
   * кто может оценить своё состояние, выгорает», и не размывается
   * ростом числа уклонившихся.
   *
   * ОБЯЗАТЕЛЬНОЕ ДОПОЛНЕНИЕ. Группа «затрудняюсь ответить» не должна
   * просто исчезать: в данных 2026 это 31 человек (7,4%) с eNPS +32,3
   * и 19,4% критиков — вторая по проблемности группа после постоянно
   * выгорающих. Её надо показывать отдельной строкой, а не прятать
   * в «нет данных».
   */
  RISK_DENOMINATOR: "answered",

  /**
   * Статистика группы «затрудняюсь ответить» — реализация обязательного
   * дополнения из комментария к RISK_DENOMINATOR выше. Группа не входит
   * в риск-метрику, но должна быть видна отдельной строкой, а не
   * молча пропадать в null.
   *
   * @param {Array<Boolean>} mask - Scoring.uncertainMask по этому вопросу
   * @param {Number} validScaleCount - валидных точек шкалы (знаменатель
   *   риск-метрики, "answered") — вместе с n затруднившихся дает
   *   правильный знаменатель для percent
   * @param {Array<Number|null>} enpsVector - вектор eNPS той же выборки
   * @returns {Object|null} null, если затруднившихся нет
   */
  uncertainGroupStats(mask, validScaleCount, enpsVector) {

    const n = mask.filter(Boolean).length;

    if (n === 0) return null;

    const enpsValues = [];

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && enpsVector[i] !== null && enpsVector[i] !== undefined) {
        enpsValues.push(enpsVector[i]);
      }
    }

    const promoters = enpsValues.filter(v => v >= 9).length;
    const detractors = enpsValues.filter(v => v <= 6).length;

    const ci = MathStats.enpsConfidence(promoters, detractors, enpsValues.length);

    return {
      n: n,
      percent: MathStats.round(n / (validScaleCount + n) * 100, 1),
      enps: MathStats.round(ci.enps, 1),
      enpsMargin: MathStats.round(ci.margin, 1),
      enpsBase: enpsValues.length,
      criticsPercent: enpsValues.length ? MathStats.round(detractors / enpsValues.length * 100, 1) : null
    };

  },

  /**
   * КЛАСС НАДЁЖНОСТИ — функция ФАКТИЧЕСКОЙ ширины скорректированного
   * ДИ по eNPS (см. MathStats.enpsConfidence: Лаплас + FPC), а не
   * абстрактного размера группы.
   *
   * ПОЧЕМУ НЕ РАЗМЕР ГРУППЫ (как было раньше, FRAGILE_SEGMENT_SIZE=25).
   * Прежний порог не видел ни явку, ни фактическую точность: отдел
   * 24 из 25 (охват 96%, ДИ ±4,7 после поправки) помечался "малой
   * группой" наравне с отделом из 26 при НЕИЗВЕСТНОМ знаменателе.
   * Компания небольшая (отделы по 5-30 человек) — малые группы это
   * структура компании, а не дефект выборки, и не должны получать
   * ярлык "недостаточно данных" по одному только n.
   *
   * КАЛИБРОВКА (из данных этой компании, не из учебника): стандартное
   * отклонение eNPS по отделам с n≥8 равно 19,8 пункта, медианное
   * абсолютное отклонение отдела от нормы — 12,0 пунктов. Значит
   * типичная разница, которую нужно уметь различать — порядка 12-20
   * пунктов, отсюда границы классов ниже.
   *
   * НИ ОДИН КЛАСС НЕ ОЗНАЧАЕТ "НЕ ПОКАЗЫВАТЬ" — группа показывается
   * всегда, класс только указывает, как читать цифру.
   */
  /**
   * УСТАРЕВШИЙ порог — оставлен только для модулей, которые еще не
   * переведены на RELIABILITY_CLASS/reliabilityClass ниже: CrossSegments.gs
   * ("Матрица отдел×перформанс") и TeamTypeComparison.gs ("Сервисные
   * vs доменные"). Segments.gs/AnalyticsWriter.gs ("Отклонения срезов",
   * "Выводы", "Светофор") на него больше не опираются — они используют
   * reliabilityClass(enpsMargin, fullCoverage), которая видит явку и
   * фактическую ширину ДИ, а не только n. Не удалять, пока эти два
   * модуля не мигрированы на ту же логику.
   */
  FRAGILE_SEGMENT_SIZE: 25,

  /**
   * Явка, ниже которой срез считается "малая часть группы" —
   * используется в Norms.coverageQuality (нижняя граница 50%, см.
   * ниже) и в Segments.coverageCaveat (текстовые пояснения). Порог
   * тот же, что и raньше — 50% отделяет "молчали не все" от "молчала
   * бо́льшая часть группы".
   */
  LOW_COVERAGE_THRESHOLD_PERCENT: 50,

  RELIABILITY_CLASS: {
    FULL_COVERAGE: "Полный охват",
    PRECISE: "Точная оценка",
    WORKING: "Рабочая оценка",
    ROUGH: "Грубая оценка",
    INDICATIVE: "Ориентировочная"
  },

  RELIABILITY_TEXT: {
    "Полный охват": "Опрошены все N сотрудников. Это не оценка, а факт на момент опроса.",
    "Точная оценка": "Оценка точная: типичные различия между отделами (около 12 пунктов) видны уверенно.",
    "Рабочая оценка": "Оценка рабочая: различия от 12 пунктов видны, меньшие — нет.",
    "Грубая оценка": "Оценка грубая: интервал сопоставим с разбросом между отделами.",
    "Ориентировочная": "Интервал шире, чем разброс между отделами: цифру можно читать только вместе с открытой ОС."
  },

  /**
   * Границы классов надёжности по ширине ДИ eNPS (в пунктах, после
   * FPC+Лаплас). См. RELIABILITY_CLASS/RELIABILITY_TEXT выше.
   */
  RELIABILITY_WIDTH: {
    precise: 6,     // ДИ ≤ 6 → "Точная оценка"
    working: 12,    // 6 < ДИ ≤ 12 → "Рабочая оценка"
    rough: 20       // 12 < ДИ ≤ 20 → "Грубая оценка"; > 20 → "Ориентировочная"
  },

  /**
   * Класс надёжности по ширине скорректированного ДИ eNPS.
   *
   * @param {Number|null} enpsMargin - segment.metrics.enpsMargin (уже с
   *   FPC+Лаплас, см. MathStats.enpsConfidence)
   * @param {Boolean} fullCoverage - явка 100% (FPC=0)
   * @returns {String|null} ключ из RELIABILITY_CLASS, null — если ДИ
   *   посчитать нельзя (нет ни одного ответа)
   */
  reliabilityClass(enpsMargin, fullCoverage) {

    if (fullCoverage) return this.RELIABILITY_CLASS.FULL_COVERAGE;
    if (enpsMargin === null || enpsMargin === undefined) return null;

    if (enpsMargin <= this.RELIABILITY_WIDTH.precise) return this.RELIABILITY_CLASS.PRECISE;
    if (enpsMargin <= this.RELIABILITY_WIDTH.working) return this.RELIABILITY_CLASS.WORKING;
    if (enpsMargin <= this.RELIABILITY_WIDTH.rough) return this.RELIABILITY_CLASS.ROUGH;

    return this.RELIABILITY_CLASS.INDICATIVE;

  },

  /**
   * КАЧЕСТВО ОХВАТА — отдельный столбец, НЕ смешивается с классом
   * надёжности выше. Надёжность отвечает "насколько точна цифра для
   * тех, кто ответил"; охват отвечает "насколько ответившие похожи на
   * всю группу" (смещение неответивших — то, что FPC принципиально не
   * лечит, см. MathStats.finitePopulationCorrection).
   *
   * @param {Number|null} responseRatePercent
   * @param {Boolean} headcountKnown - есть ли знаменатель вообще
   * @returns {String}
   */
  coverageQuality(responseRatePercent, headcountKnown) {

    if (!headcountKnown || responseRatePercent === null || responseRatePercent === undefined) {
      return "явка для этого среза не считается";
    }
    if (responseRatePercent >= 80) return "охват полный или почти полный";
    if (responseRatePercent >= 50) return "ответили не все; молчавшие могли отличаться от ответивших";
    return "ответила меньшая часть группы; результат описывает ответивших, а не группу";

  },

  /**
   * Статус по абсолютному уровню.
   *
   * @param {Number} value
   * @param {String} scaleKey - ключ из THRESHOLDS
   */
  status(value, scaleKey) {

    const t = this.THRESHOLDS[scaleKey];

    if (!t || value === null || value === undefined) return null;

    if (t.direction === "up") {
      if (value >= t.excellent) return this.STATUS.EXCELLENT;
      if (value >= t.good) return this.STATUS.GOOD;
      if (value >= t.watch) return this.STATUS.WATCH;
      return this.STATUS.CRITICAL;
    }

    if (value <= t.excellent) return this.STATUS.EXCELLENT;
    if (value <= t.good) return this.STATUS.GOOD;
    if (value <= t.watch) return this.STATUS.WATCH;
    return this.STATUS.CRITICAL;

  },

  /**
   * Какой ключ порогов применять к вопросу.
   */
  scaleKeyFor(question) {

    const title = String(question.title).trim().toLowerCase();

    if (question.type === "enps") return "enps";
    if (question.type === "rating5") return "rating5";
    if (title === "выгорание") return "burnoutRisk";
    if (title === "смена работы") return "leaveRisk";

    return "scale4";

  },

  /**
   * Приведение любого показателя к общей шкале 0–100.
   *
   * ЗАЧЕМ. Чтобы поставить в один ряд «ЗП 4,16 из 5» и «Цели компании
   * 80,6% позитива», нужна общая линейка. Без нее нельзя построить
   * матрицу приоритетов: непонятно, что «ниже», а что «выше».
   *
   * ФОРМУЛА: (среднее − минимум шкалы) / (максимум − минимум) × 100
   *
   * ПРИМЕР: ЗП 4,16 при шкале 1–5 → (4,16−1)/(5−1)×100 = 79,0.
   *          Цели компании 3,14 при шкале 1–4 → (3,14−1)/3×100 = 71,4.
   * Теперь видно, что цели компании реально ниже, хотя «80,6%»
   * на глаз выглядели солиднее «4,16».
   */
  normalizeLevel(mean, min, max) {

    if (mean === null || mean === undefined) return null;
    if (max === min) return null;

    return (mean - min) / (max - min) * 100;

  },

  /**
   * Отклонение среза от нормы (компании или "компания минус сам
   * срез" — см. Segments.analyze) с учетом типа показателя.
   *
   * ДВА РАЗНЫХ ВОПРОСА, СЧИТАЮТСЯ ОТДЕЛЬНО:
   *   – УПРАВЛЕНЧЕСКИЙ: превышает ли разница фиксированный порог
   *     DEVIATION (15 пунктов eNPS / 7 п.п. долей / 0,20 балла) — это
   *     РЕШЕНИЕ КОМПАНИИ "заслуживает ли разница внимания", а не
   *     статистика (см. комментарий у DEVIATION). Именно этот порог
   *     определяет, попадает ли отклонение в список (и в badCount/
   *     confirmed — правило "≥2 согласованных плохих отклонений" не
   *     меняется, оно про множественные сравнения, а не про размер
   *     группы).
   *   – СТАТИСТИЧЕСКИЙ: отличается ли группа от нормы вообще — по
   *     пересечению скорректированных ДИ (см. MathStats.enpsConfidence/
   *     proportionConfidence/meanConfidence), без фиксированного
   *     порога, для группы любого размера. Считается, только если
   *     оба margin переданы; иначе statisticallySignificant = null
   *     (не то же самое, что false — "неизвестно", а не "нет").
   *
   * @returns {Object|null} null, если управленческий порог не
   *   превышен — отклонение не считается достаточно крупным, чтобы
   *   им заниматься.
   */
  deviation(segmentValue, companyValue, kind, label, segmentMargin, companyMargin) {

    if (segmentValue === null || companyValue === null) return null;

    const diff = segmentValue - companyValue;

    let limit;

    if (kind === "rating") limit = this.DEVIATION.ratingPoints;
    else if (kind === "enps") limit = this.DEVIATION.enpsPoints;
    else limit = this.DEVIATION.sharePp;

    if (Math.abs(diff) < limit) return null;

    const hasMargins = segmentMargin !== null && segmentMargin !== undefined &&
      companyMargin !== null && companyMargin !== undefined;

    return {
      label: label,
      value: segmentValue,
      norm: companyValue,
      diff: diff,
      direction: diff > 0 ? "выше нормы" : "ниже нормы",
      kind: kind,
      statisticallySignificant: hasMargins
        ? Math.abs(diff) > Math.sqrt(segmentMargin * segmentMargin + companyMargin * companyMargin)
        : null
    };

  },

  /**
   * Словесная расшифровка статуса — чтобы в отчете не пришлось
   * объяснять, что означает цвет.
   */
  explain(status, scaleKey) {

    const t = this.THRESHOLDS[scaleKey];

    if (!t) return "";

    const unit = (scaleKey === "rating5") ? " балла" : (scaleKey === "enps" ? " пунктов" : "%");
    const sign = t.direction === "up" ? "≥" : "≤";

    if (status === this.STATUS.EXCELLENT) return "уровень " + sign + " " + t.excellent + unit + " — держать, ресурсы не нужны";
    if (status === this.STATUS.GOOD) return "уровень " + sign + " " + t.good + unit + " — норма, поддерживать";
    if (status === this.STATUS.WATCH) return "уровень " + sign + " " + t.watch + unit + " — под наблюдение";

    return "за порогом " + t.watch + unit + " — требует решения";

  }

};
