/**
 * ==========================================================
 * Join срезового отчета с company-wide расширенным контуром
 * ==========================================================
 *
 * ЗАЧЕМ. Расширенный контур (AnalyticsService.build → Segments.analyze)
 * уже знает, какие отделы/города/группы стажа отклоняются от нормы по
 * компании, и есть ли там подтвержденная проблема (несколько плохих
 * отклонений сразу, а не случайный шум). Обычный срезовый отчет
 * (ReportService.buildReport) этого не считает — он строится только по
 * отфильтрованной выборке. Этот модуль ничего не пересчитывает: он
 * находит в уже готовой company-wide аналитике бакет, соответствующий
 * фильтру отчета, по имени.
 *
 * ОГРАНИЧЕНИЕ v1. Обогащение работает, только когда фильтр отчета
 * сужает выборку до РОВНО ОДНОГО значения измерения (одного отдела,
 * одной группы стажа и т.д.) — расширенный контур считает срезы по
 * единственным бакетам, а не по произвольным объединениям значений.
 */

const SegmentContext = {

  // Те же title, что перечислены в AnalyticsService.build (dimensions).
  // "Управление" не колонка анкеты (см. Segments.splitBy), но фильтр по
  // ней существует и должен матчиться так же, как остальные измерения.
  DIMENSIONS: [
    "Формат работы", "Стаж", "Город", "Отдел", "Управление", "Группа команд",
    "Соответствие ожиданиям", "Грейд", "Роль в отделе"
  ],

  /**
   * @param {String} source - '2026' | '2025'
   * @param {Array<Object>} filters - те же фильтры, что в buildReport
   * @returns {Array<Object>} найденные сегменты Segments.analyze (как
   *   есть, без копирования полей) — по одному на каждый однозначный
   *   фильтр измерения, для которого нашелся бакет.
   */
  forFilters(source, filters) {

    const candidates = (filters || []).filter(filter =>
      filter && Array.isArray(filter.values) && filter.values.length === 1 &&
      this.DIMENSIONS.some(title => Segments.normalizeKey_(title) === Segments.normalizeKey_(filter.question))
    );

    if (candidates.length === 0) return [];

    // 2025-only срезы не считает AnalyticsService.build для source=2025
    // предыдущего года у самого 2025 нет.
    const previousYear = source === '2026' ? '2025' : null;

    let analytics;

    try {
      analytics = AnalyticsService.buildCached_(source, previousYear);
    } catch (error) {
      return [];
    }

    const matches = [];

    candidates.forEach(filter => {

      const dimension = analytics.segments.find(entry =>
        Segments.normalizeKey_(entry.dimension) === Segments.normalizeKey_(filter.question)
      );

      if (!dimension) return;

      const rawValue = filter.values[0];
      const isDepartment = Segments.normalizeKey_(filter.question) === Segments.normalizeKey_("Отдел");
      const targetName = isDepartment ? Headcount.resolveDepartment(rawValue).name : rawValue;
      const targetKey = Segments.normalizeKey_(targetName);

      const segment = dimension.segments.find(s => Segments.normalizeKey_(s.name) === targetKey);

      if (segment) matches.push(segment);

    });

    return matches;

  }

};
