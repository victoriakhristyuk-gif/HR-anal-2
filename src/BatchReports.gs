/**
 * ==========================================================
 * Пакетное построение отчетов
 * ==========================================================
 *
 * Надстройка над существующим buildReport(): раскладывает набор
 * фильтров на несколько независимых наборов и строит обычный отчет по
 * каждому из них. Сам buildReport() о пакетном режиме не знает — он
 * по-прежнему получает один плоский набор фильтров и строит один отчет
 * (вместе со сводной аналитикой, поэтому она обновляется для каждого
 * отчета пакета автоматически).
 *
 * Пакетный режим включается на уровне ОТДЕЛЬНОГО фильтра: у фильтра по
 * значениям (single, scale4, scale5) появляется поле mode:
 *
 *   "single" (по умолчанию) — выбранные значения работают как одна
 *                             выборка, поведение полностью прежнее;
 *   "split"                 — по отдельному отчету на каждое значение.
 *
 * Фильтры в режиме "split" обрабатываются НЕЗАВИСИМО друг от друга:
 * комбинации значений разных фильтров не строятся (Город × Отдел дает
 * не 6 отчетов, а 2 + 3).
 */

const BatchReports = {

  SPLIT_MODE: "split",

  /**
   * Построить отчет или пакет отчетов.
   *
   * @returns {{source: String, batch: Boolean, reports: Array<Object>}}
   */
  run(source, filters, compareWith2025, customReportName) {

    const filterSets = this.expandFilterSets(filters);

    // Пакетных фильтров нет — прежний путь без единого изменения:
    // один вызов buildReport, ошибка построения (как и раньше) уходит
    // наверх в сайдбар, а не превращается в "0 отчетов".
    if (filterSets.length === 0) {

      const result = buildReport(source, filters, compareWith2025, customReportName);

      return {
        source: source,
        batch: false,
        reports: [this.describeSuccess_(result, null)]
      };

    }

    // Пользовательское название применимо, только когда отчет в итоге
    // ровно один: на нескольких отчетах одно название сделало бы их
    // неразличимыми, поэтому каждый именуется автоматически — то есть
    // своим значением (см. ReportBuilder.generateReportName).
    //
    // Одно выбранное значение специальным случаем не является и идет
    // тем же пакетным путем, что и любое другое, — но результат его
    // построения ничем не отличается от обычного отчета, поэтому и имя
    // ему задается так же, как в обычном режиме.
    const batchReportName = filterSets.length === 1 ? customReportName : "";

    // Неудача одного значения не должна отменять уже построенные и
    // оставшиеся отчеты — она запоминается и попадает в итоговую сводку.
    const reports = filterSets.map(filterSet => {

      try {

        const result = buildReport(source, filterSet.filters, compareWith2025, batchReportName);

        return this.describeSuccess_(result, filterSet.label);

      } catch (error) {

        return {
          label: filterSet.label,
          ok: false,
          sheetName: null,
          employees: null,
          filters: filterSet.filters,
          summaryError: null,
          error: error.message
        };

      }

    });

    return {
      source: source,
      batch: true,
      reports: reports
    };

  },

  /**
   * Разложить фильтры на наборы для пакетного построения.
   *
   * Возвращает пустой массив, если ни один фильтр не переведен в режим
   * "отдельный отчет на значение" — это признак того, что пакетный
   * режим не нужен вовсе.
   *
   * Для каждого пакетного фильтра и каждого его значения формируется
   * свой набор: все НЕпакетные фильтры без изменений плюс этот фильтр,
   * суженный до одного значения. Остальные пакетные фильтры в набор не
   * попадают — иначе получились бы комбинации.
   */
  expandFilterSets(filters) {

    const allFilters = filters || [];
    const splitFilters = allFilters.filter(filter => this.isSplitFilter(filter));

    if (splitFilters.length === 0) {
      return [];
    }

    const baseFilters = allFilters.filter(filter => !this.isSplitFilter(filter));

    const filterSets = [];

    splitFilters.forEach(filter => {

      filter.values.forEach(value => {

        filterSets.push({
          label: value,
          filters: baseFilters.concat([this.withSingleValue_(filter, value)])
        });

      });

    });

    return filterSets;

  },

  /**
   * Работает ли фильтр в режиме "отдельный отчет на каждое значение".
   * Режим есть только у фильтров по значениям; фильтры-операторы
   * (rating5, enps) выбора значений не имеют и всегда обычные.
   */
  isSplitFilter(filter) {

    return !!filter
      && filter.mode === this.SPLIT_MODE
      && Array.isArray(filter.values)
      && filter.values.length > 0;

  },

  /**
   * Копия фильтра, суженная до одного значения. Служебное поле mode
   * удаляется: ниже по стеку о пакетном режиме никто не знает, и в
   * сигнатуру отчета оно попасть не должно.
   */
  withSingleValue_(filter, value) {

    const singleValueFilter = Object.assign({}, filter, { values: [value] });

    delete singleValueFilter.mode;

    return singleValueFilter;

  },

  /**
   * Результат buildReport в едином для сайдбара виде. Для одиночного
   * отчета подписью служит имя листа — отдельного значения у него нет.
   */
  describeSuccess_(result, label) {

    return {
      label: label === null ? result.sheetName : label,
      ok: true,
      sheetName: result.sheetName,
      employees: result.employees,
      filters: result.filters,
      summaryError: result.summaryError,
      error: null
    };

  }

};
