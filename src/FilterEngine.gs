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
  applyFilters(data, headers, filters, year) {

    const groups = this.groupFilters(filters);

    return data.filter(row =>
      groups.every(group =>
        group.some(filter => this.matchesFilter(row, headers, filter, year))
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
  matchesFilter(row, headers, filter, year) {

    // "Управление" — не реальная колонка анкеты: считается по отделу
    // строки через справочник численности (см. Headcount.gs), поэтому
    // обрабатывается раньше поиска колонки по имени вопроса.
    if (this.normalize(filter.question) === this.normalize("Управление")) {
      return this.matchesDivisionFilter_(row, headers, filter, year);
    }

    // "Группа команд" — тоже не реальная колонка анкеты: считается по
    // отделу строки через справочник численности (см. Headcount.gs,
    // Headcount.teamGroupOf), как и "Управление" выше.
    if (this.normalize(filter.question) === this.normalize("Группа команд")) {
      return this.matchesTeamGroupFilter_(row, headers, filter, year);
    }

    // Сравнение без учета регистра/пробелов — те же расхождения
    // заголовков, что уже встречались в Statistics.calculateDistribution.
    const columnKey = filter.dataTitle || filter.question;
    const columnIndex = headers.findIndex(
      header => this.normalize(header) === this.normalize(columnKey)
    );

    if (columnIndex === -1) {
      throw new Error("Не найден вопрос \"" + filter.question + "\" в данных");
    }

    const value = row[columnIndex];

    if (filter.type === "rating5" || filter.type === "enps") {
      return this.matchesOperator(value, filter.operator, filter.value);
    }

    // "Отдел" — единственный вопрос, где сырые названия из разных лет
    // могут расходиться из-за переименований (см. DepartmentAliases).
    // Приводим и значение строки, и допустимые значения фильтра к
    // каноническому названию ДО сравнения — иначе фильтр, заданный в
    // терминах текущего названия, молча теряет строки года, где отдел
    // назывался иначе.
    if (this.normalize(headers[columnIndex]) === this.normalize("Отдел")) {
      if (year) {
        const valueKey = Headcount.departmentKey(value);
        return (filter.values || []).some(allowed => Headcount.departmentKey(allowed) === valueKey);
      }
      return this.matchesValues(
        DepartmentAliases.canonicalize(value),
        (filter.values || []).map(v => DepartmentAliases.canonicalize(v))
      );
    }

    return this.matchesValues(value, filter.values);

  },

  /**
   * Фильтр по "Управлению" — производный от "Отдел" (см. Headcount.gs).
   */
  matchesDivisionFilter_(row, headers, filter, year) {

    const departmentColumnIndex = headers.findIndex(
      header => this.normalize(header) === this.normalize("Отдел")
    );

    if (departmentColumnIndex === -1) {
      throw new Error("Не найден вопрос \"Отдел\" в данных (нужен для фильтра \"Управление\")");
    }

    if (!year) {
      throw new Error('Для фильтра "Управление" не указан год источника данных');
    }

    const division = Headcount.divisionOf(year, row[departmentColumnIndex]) || Headcount.UNASSIGNED_LABEL;

    return this.matchesValues(division, filter.values);

  },

  /**
   * Фильтр по "Группе команд" — производный от "Отдел" (см.
   * Headcount.teamGroupOf). В отличие от "Управления" у отдела без
   * указанного типа команды нет синтетической группы-заглушки: такой
   * отдел никогда не совпадает ни с одним значением этого фильтра
   * (см. заголовок Headcount.gs, правило 4 — не создавать группу
   * "Не указано").
   */
  matchesTeamGroupFilter_(row, headers, filter, year) {

    const departmentColumnIndex = headers.findIndex(
      header => this.normalize(header) === this.normalize("Отдел")
    );

    if (departmentColumnIndex === -1) {
      throw new Error("Не найден вопрос \"Отдел\" в данных (нужен для фильтра \"Группа команд\")");
    }

    if (!year) {
      throw new Error('Для фильтра "Группа команд" не указан год источника данных');
    }

    const group = Headcount.teamGroupOf(year, row[departmentColumnIndex]);

    if (!group) return false;

    return this.matchesValues(group, filter.values);

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
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  }

};
