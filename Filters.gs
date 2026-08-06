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
   */
  getValueOptions(question) {
    return question.answers || [];
  }

};