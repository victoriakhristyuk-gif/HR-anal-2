/**
 * ==========================================================
 * Движок фильтрации
 * ==========================================================
 */

const FilterEngine = {

  /**
   * Применить фильтры к массиву строк
   *
   * @param {Array<Array>} data
   * @param {Array<String>} headers
   * @param {Array<Object>} filters
   * @returns {Array<Array>}
   */
  applyFilters(data, headers, filters) {

    return data.filter(row =>
      filters.every(filter => this.matchesFilter(row, headers, filter))
    );

  },

  /**
   * Проверить одну строку на соответствие одному фильтру
   */
  matchesFilter(row, headers, filter) {

    const columnIndex = headers.indexOf(filter.question);

    if (columnIndex === -1) {
      throw new Error("Не найден вопрос \"" + filter.question + "\" в данных");
    }

    const value = row[columnIndex];

    if (filter.type === "rating5" || filter.type === "enps") {
      return this.matchesOperator(value, filter.operator, filter.value);
    }

    return this.matchesValues(value, filter.values);

  },

  /**
   * Фильтр по списку значений (single, scale4, scale5).
   * Сравнение без учета регистра и лишних пробелов — в реальных
   * ответах "Да" и "да" встречаются вперемешку для одного и того
   * же логического значения.
   */
  matchesValues(value, allowedValues) {

    if (!allowedValues || allowedValues.length === 0) {
      return true;
    }

    const normalizedValue = this.normalize(value);

    return allowedValues.some(
      allowed => this.normalize(allowed) === normalizedValue
    );

  },

  /**
   * Фильтр по оператору сравнения (rating5, enps)
   */
  matchesOperator(rawValue, operator, rawTarget) {

    const value = Number(rawValue);
    const target = Number(rawTarget);

    if (isNaN(value)) {
      return false;
    }

    switch (operator) {
      case "=": return value === target;
      case ">": return value > target;
      case ">=": return value >= target;
      case "<": return value < target;
      case "<=": return value <= target;
      case "!=": return value !== target;
      default:
        throw new Error("Неизвестный оператор фильтра: " + operator);
    }

  },

  /**
   * Нормализация строки для регистронезависимого сравнения
   */
  normalize(value) {
    return String(value).trim().toLowerCase();
  }

};