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
   * Вопросы, доступные для фильтрации
   */
  getFilterableQuestions() {
    return Questions.getFilterQuestions();
  },

  /**
   * Варианты ответа вопроса для фильтра (single, scale4, scale5).
   * Questions.gs уже разбирает "answers" в массив.
   *
   * Для "Город" и "Отдел", если переданы данные текущего источника,
   * варианты сортируются по количеству ответов (по убыванию, при
   * равенстве — по алфавиту). Остальные вопросы — в исходном порядке.
   */
  getValueOptions(question, headers, data) {

    const options = question.answers || [];

    if (this.isFrequencySorted(question) && headers && data) {
      return this.sortOptionsByFrequency(options, question.title, headers, data);
    }

    return options;

  },

  /**
   * Вопросы, для которых варианты ответа сортируются по частоте
   */
  isFrequencySorted(question) {
    return question.title === "Город" || question.title === "Отдел";
  },

  /**
   * Отсортировать варианты ответа по количеству встречающихся значений
   * в текущих данных: сначала самое частое, при равенстве — по алфавиту.
   */
  sortOptionsByFrequency(options, questionTitle, headers, data) {

    const columnIndex = headers.indexOf(questionTitle);

    if (columnIndex === -1) {
      return options;
    }

    const counts = {};

    data.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        return;
      }

      const key = String(raw).trim().toLowerCase();
      counts[key] = (counts[key] || 0) + 1;

    });

    return options.slice().sort((a, b) => {

      const countA = counts[a.trim().toLowerCase()] || 0;
      const countB = counts[b.trim().toLowerCase()] || 0;

      if (countB !== countA) {
        return countB - countA;
      }

      return a.localeCompare(b, 'ru');

    });

  }

};