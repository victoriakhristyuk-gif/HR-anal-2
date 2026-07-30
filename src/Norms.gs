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
    coverage: { direction: "up", excellent: 70, good: 50, watch: 35 }

  },

  /**
   * Насколько срез должен отличаться от нормы компании, чтобы это
   * считалось отклонением, а не рябью.
   *
   * Цифры не произвольные: это примерно два стандартных отклонения
   * выборочного среднего для группы в 15–30 человек. Меньшие
   * расхождения при таких размерах групп неотличимы от случайности.
   */
  DEVIATION: {
    ratingPoints: 0.20,   // баллы для rating5
    sharePp: 7,           // процентные пункты для долей
    enpsPoints: 15        // пункты для eNPS
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
   * Размер группы, ниже которого показатель помечается как
   * «сигнал, а не факт». Малые группы не скрываются: широкий
   * доверительный интервал показывается рядом с результатом.
   */
  FRAGILE_SEGMENT_SIZE: 25,

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
   * Отклонение среза от нормы компании с учетом типа показателя.
   *
   * @returns {Object|null} null, если отклонение в пределах допустимого
   */
  deviation(segmentValue, companyValue, kind, label) {

    if (segmentValue === null || companyValue === null) return null;

    const diff = segmentValue - companyValue;

    let limit;

    if (kind === "rating") limit = this.DEVIATION.ratingPoints;
    else if (kind === "enps") limit = this.DEVIATION.enpsPoints;
    else limit = this.DEVIATION.sharePp;

    if (Math.abs(diff) < limit) return null;

    return {
      label: label,
      value: segmentValue,
      norm: companyValue,
      diff: diff,
      direction: diff > 0 ? "выше нормы" : "ниже нормы",
      kind: kind
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
