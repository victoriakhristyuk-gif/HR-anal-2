/**
 * ==========================================================
 * Статистика
 * ==========================================================
 */

const Statistics = {

  /**
   * Расчет eNPS
   */
  calculateENPS(rows, headers) {

    // Сравнение без учета регистра/пробелов — см. calculateDistribution.
    const enpsColumn = headers.findIndex(header => this.normalize_(header) === "enps");

    if (enpsColumn === -1) {
      throw new Error("Не найден столбец eNPS");
    }

    let promoters = 0;
    let neutrals = 0;
    let detractors = 0;

    rows.forEach(row => {

      const value = Number(row[enpsColumn]);

      if (isNaN(value)) return;

      if (value >= 9) {
        promoters++;
      } else if (value >= 7) {
        neutrals++;
      } else {
        detractors++;
      }

    });

    const total = promoters + neutrals + detractors;

    return {
      promoters,
      neutrals,
      detractors,
      total,

      promotersPercent: total ? Math.round(promoters / total * 100) : 0,
      neutralsPercent: total ? Math.round(neutrals / total * 100) : 0,
      detractorsPercent: total ? Math.round(detractors / total * 100) : 0,

      enps: total
        ? Math.round(((promoters - detractors) / total) * 100)
        : 0
    };

  },

  /**
   * Средние оценки
   */
  calculateAverageRatings(rows, headers) {

    const questions = Questions
      .getAverageQuestions()
      .map(q => q.title);

    const result = [];

    questions.forEach(question => {

      // Сравнение без учета регистра/пробелов — см. calculateDistribution.
      const column = headers.findIndex(header => this.normalize_(header) === this.normalize_(question));

      if (column === -1) return;

      let sum = 0;
      let count = 0;

      rows.forEach(row => {

        const raw = row[column];

        // Пустой ответ нужно исключить ДО Number(): Number("") === 0,
        // поэтому без этой проверки пропущенный вопрос молча считался
        // бы оценкой "0" и занижал среднее (тот же случай пропусков,
        // что уже обрабатывается в calculateDistribution).
        if (raw === "" || raw === null || raw === undefined) {
          return;
        }

        const value = Number(raw);

        if (isNaN(value)) return;

        sum += value;
        count++;

      });

      result.push({
        question: question,
        average: count ? +(sum / count).toFixed(2) : 0,
        count: count
      });

    });

    return result;

  },

  /**
   * Распределение ответов по вопросу.
   * Порядок ответов фиксированный (п.5.13 спеки), не сортируется.
   */
  calculateDistribution(rows, headers, question) {

    // Сравнение без учета регистра/пробелов — в заголовках реальной
    // таблицы встречаются расхождения по регистру с названием в
    // Questions.gs (например, "о жизни компании" вместо "О жизни
    // компании"), из-за которых indexOf() не находил столбец.
    const columnIndex = headers.findIndex(
      header => this.normalize_(header) === this.normalize_(question.title)
    );

    if (columnIndex === -1) {
      return [];
    }

    const order = this.getDistributionOrder_(question);
    const normalizedOrder = order.map(answer => this.normalize_(answer));

    const counts = normalizedOrder.map(() => 0);
    let total = 0;

    rows.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        return;
      }

      const index = normalizedOrder.indexOf(this.normalize_(raw));

      if (index === -1) {
        return;
      }

      counts[index]++;
      total++;

    });

    return order.map((answer, index) => ({
      answer: answer,
      count: counts[index],
      percent: total ? Math.round(counts[index] / total * 100) : 0
    }));

  },

  /**
   * Фиксированный порядок ответов для распределения.
   * rating5 — по убыванию (5..1), плюс "не пользовался", если он
   * есть среди ответов вопроса. Остальные типы — порядок из карты
   * вопросов.
   */
  getDistributionOrder_(question) {

    if (question.type === "rating5") {

      const order = ["5", "4", "3", "2", "1"];

      if (question.answers.some(a => this.normalize_(a) === "не пользовался")) {
        order.push("не пользовался");
      }

      return order;

    }

    return question.answers;

  },

  /**
   * Нормализация строки для сравнения без учета регистра и пробелов
   */
  normalize_(value) {
    return String(value).trim().toLowerCase();
  },

  /**
   * Полные (неусеченные) частоты ответов на открытый вопрос с
   * множественным выбором, плюс количество валидных ответов на
   * вопрос (респондентов с непустой ячейкой) — знаменатель для
   * процентов. В одной ячейке может быть несколько выбранных
   * вариантов, склеенных через ".," — они разбираются по отдельности,
   * поэтому сумма count по вариантам может быть больше validCount.
   */
  calculateAnswerFrequencies(rows, headers, question) {

    // Сравнение без учета регистра/пробелов — см. calculateDistribution.
    const columnIndex = headers.findIndex(
      header => this.normalize_(header) === this.normalize_(question.title)
    );

    if (columnIndex === -1) {
      return { items: [], validCount: 0 };
    }

    const items = [];
    const indexByAnswer = {};
    let validCount = 0;

    rows.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        return;
      }

      validCount++;

      this.parseMultiAnswer_(raw).forEach(answer => {

        if (!(answer in indexByAnswer)) {
          indexByAnswer[answer] = items.length;
          items.push({ answer: answer, count: 0 });
        }

        items[indexByAnswer[answer]].count++;

      });

    });

    return { items: items, validCount: validCount };

  },

  /**
   * ТОП-5 самых популярных ответов на открытый вопрос.
   * При равенстве количества сохраняется порядок появления
   * в данных (п.17 спеки).
   */
  calculateTopAnswers(rows, headers, question, limit) {

    const frequencies = this.calculateAnswerFrequencies(rows, headers, question);

    return frequencies.items
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, limit || 5);

  },

  /**
   * Разбор ячейки с несколькими выбранными вариантами ответа
   */
  parseMultiAnswer_(raw) {

    const text = String(raw).trim();

    if (!text) {
      return [];
    }

    return text
      .split(/\.,\s*/)
      .map(part => part.trim().replace(/\.$/, "").trim())
      .filter(part => part.length > 0);

  }

};