/**
 * ==========================================================
 * Описание доступных фильтров
 * ==========================================================
 */

const Filters = {

  /**
   * Операторы сравнения для числовых типов (rating5, enps)
   */
  operators: ["=", ">", ">=", "<", "<=", "!="],

  /**
   * Вопросы, доступные для фильтрации.
   *
   * Фильтры, обогащенные справочником "перформанс" (performanceOnly —
   * см. Questions.catalogue), доступны только для источника "2026":
   * в данных 2025 этих признаков нет (см. PerformanceDirectory.gs).
   *
   * @param {String} [source] - '2025' | '2026' | 'both'
   */
  getFilterableQuestions(source) {
    return Questions.getFilterQuestions().filter(
      question => !question.performanceOnly || source === "2026"
    );
  },

  /**
   * Варианты ответа вопроса для фильтра (single, scale4, scale5).
   * Questions.gs уже разбирает "answers" в массив.
   *
   * Для "Город" и "Отдел", если переданы данные текущего источника,
   * варианты сортируются по количеству ответов (по убыванию, при
   * равенстве — по алфавиту). Остальные вопросы — в исходном порядке.
   *
   * "Соответствие ожиданиям" и "Грейд" не имеют фиксированного списка
   * в Questions.catalogue (answers: "") — варианты берутся динамически
   * из фактических непустых значений листа "перформанс" (см.
   * PerformanceDirectory.distinctValues).
   */
  getValueOptions(question, headers, data, source) {

    if (this.isDynamicPerformanceQuestion(question)) {
      return PerformanceDirectory.distinctValues(question.title);
    }

    let options = question.answers || [];

    if (question.title === "Управление" && source && source !== "both") {
      options = Headcount.listDivisions(source).concat([Headcount.UNASSIGNED_LABEL]);
    } else if (question.title === "Группа команд" && source && source !== "both") {
      // Только реально существующие непустые группы (Управление + Тип
      // команды) этого года — без искусственного варианта "не указано"
      // (см. Headcount.listTeamGroups).
      options = Headcount.listTeamGroups(source);
    } else if (question.title === "Отдел" && source && source !== "both") {
      // Название из многолетнего справочника ставится первым: если
      // каталог анкеты ещё содержит старый вариант того же ID, в UI
      // должно остаться последнее фактическое название.
      options = Headcount.listDepartments(source).concat(options);
      options = options.filter((value, index, list) =>
        list.findIndex(candidate => Headcount.departmentKey(candidate) === Headcount.departmentKey(value)) === index
      );
    }

    if (this.isFrequencySorted(question) && headers && data) {
      return this.sortOptionsByFrequency(options, question.title, headers, data, source);
    }

    return options;

  },

  /**
   * Вопросы, чьи варианты ответа берутся динамически из листа
   * "перформанс", а не из Questions.catalogue.
   */
  isDynamicPerformanceQuestion(question) {
    return question.title === "Соответствие ожиданиям" || question.title === "Грейд";
  },

  /**
   * Вопросы, для которых варианты ответа сортируются по частоте
   */
  isFrequencySorted(question) {
    return question.title === "Город" || question.title === "Отдел" || question.title === "Управление";
  },

  /**
   * Отсортировать варианты ответа по количеству встречающихся значений
   * в текущих данных: сначала самое частое, при равенстве — по алфавиту.
   *
   * "Управление" — производный вопрос (см. Headcount.gs): в данных
   * ищем колонку "Отдел" и переводим каждое значение в управление
   * перед подсчетом.
   */
  sortOptionsByFrequency(options, questionTitle, headers, data, source) {

    const isDivision = questionTitle === "Управление";
    const headcountYear = source === "both" ? Headcount.INITIAL_YEAR : source;
    const lookupTitle = isDivision ? "Отдел" : questionTitle;
    const target = String(lookupTitle).trim().toLowerCase().replace(/\s+/g, " ");
    const columnIndex = headers.findIndex(
      h => String(h).trim().toLowerCase().replace(/\s+/g, " ") === target
    );

    if (columnIndex === -1) {
      return options;
    }

    const counts = {};

    data.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        return;
      }

      const key = isDivision
        ? String(Headcount.divisionOf(headcountYear, raw) || Headcount.UNASSIGNED_LABEL)
            .trim().toLowerCase().replace(/\s+/g, " ")
        : questionTitle === "Отдел" && source
          ? Headcount.departmentKey(raw)
          : String(raw).trim().toLowerCase().replace(/\s+/g, " ");

      counts[key] = (counts[key] || 0) + 1;

    });

    return options.slice().sort((a, b) => {

      const keyA = questionTitle === "Отдел" && source
        ? Headcount.departmentKey(a)
        : a.trim().toLowerCase().replace(/\s+/g, " ");
      const keyB = questionTitle === "Отдел" && source
        ? Headcount.departmentKey(b)
        : b.trim().toLowerCase().replace(/\s+/g, " ");
      const countA = counts[keyA] || 0;
      const countB = counts[keyB] || 0;

      if (countB !== countA) {
        return countB - countA;
      }

      return a.localeCompare(b, 'ru');

    });

  }

};
