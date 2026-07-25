/**
 * ==========================================================
 * Движок фильтрации
 * ==========================================================
 */

const FilterEngine = {

  /**
   * Применить фильтры к массиву строк.
   *
   * Несколько фильтров по значениям (single, scale4, scale5) для
   * ОДНОГО и того же вопроса объединяются через OR — строка проходит,
   * если совпадает хотя бы с одним из выбранных значений. Фильтры по
   * РАЗНЫМ вопросам (а также фильтры-операторы rating5/enps) по-прежнему
   * объединяются через AND.
   *
   * @param {Array<Array>} data
   * @param {Array<String>} headers
   * @param {Array<Object>} filters
   * @returns {Array<Array>}
   */
  applyFilters(data, headers, filters) {

    const groups = this.groupFilters(filters);

    return data.filter(row =>
      groups.every(group =>
        group.some(filter => this.matchesFilter(row, headers, filter))
      )
    );

  },

  /**
   * Сгруппировать фильтры для комбинирования OR/AND.
   *
   * Фильтры по значениям (имеют "values") с одинаковым "question"
   * попадают в одну группу (OR внутри группы). Фильтры-операторы
   * (rating5, enps) всегда образуют свою отдельную группу из одного
   * элемента, поэтому между ними сохраняется прежнее поведение AND.
   */
  groupFilters(filters) {

    const groups = [];
    const groupIndexByQuestion = {};

    filters.forEach(filter => {

      const isValueFilter = Array.isArray(filter.values);

      if (isValueFilter && groupIndexByQuestion.hasOwnProperty(filter.question)) {
        groups[groupIndexByQuestion[filter.question]].push(filter);
        return;
      }

      groups.push([filter]);

      if (isValueFilter) {
        groupIndexByQuestion[filter.question] = groups.length - 1;
      }

    });

    return groups;

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