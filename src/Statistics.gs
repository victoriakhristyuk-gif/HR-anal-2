/**
 * ==========================================================
 * Статистика
 * ==========================================================
 */

const Statistics = {

  /**
   * Расчет eNPS
   *
   * HR-002: категоризация (Scoring.enpsCategory) и знаменатель
   * (Scoring.vector) — те же, что в AnalyticsService/Segments/Cohort/
   * Drivers, поэтому основной отчет, сводная и расширенная аналитика
   * больше не могут разойтись по eNPS/категориям/базе. Раньше здесь
   * читали Number(row[enpsColumn]) напрямую и отсеивали только isNaN —
   * а Number("") === 0, из-за чего пустая ячейка eNPS молча считалась
   * критиком. Scoring.vector корректно возвращает для нее null.
   */
  calculateENPS(rows, headers) {

    const enpsQuestion = Questions.getAll().find(question => question.type === "enps");

    // Сравнение без учета регистра/пробелов — см. calculateDistribution.
    const enpsColumn = headers.findIndex(header => this.normalize_(header) === "enps");

    if (!enpsQuestion || enpsColumn === -1) {
      throw new Error("Не найден столбец eNPS");
    }

    const vector = Scoring.vector(rows, headers, enpsQuestion);

    let promoters = 0;
    let neutrals = 0;
    let detractors = 0;

    vector.forEach(value => {

      const category = Scoring.enpsCategory(value);

      if (category === "promoters") promoters++;
      else if (category === "neutrals") neutrals++;
      else if (category === "detractors") detractors++;

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
        ? Math.round(MathStats.enpsConfidence(promoters, detractors, total).enps)
        : 0
    };

  },

  /**
   * Средние оценки
   */
  calculateAverageRatings(rows, headers) {

    const questions = Questions.getAverageQuestions();
    const result = [];

    questions.forEach(question => {

      const columnTitle = question.dataTitle || question.title;
      const column = headers.findIndex(header => this.normalize_(header) === this.normalize_(columnTitle));

      if (column === -1) return;

      const min = Scoring.minFor(question);
      const max = Scoring.maxFor(question);
      let sum = 0;
      let count = 0;

      rows.forEach(row => {

        const raw = row[column];

        if (raw === "" || raw === null || raw === undefined) {
          return;
        }

        const value = Number(raw);

        if (isNaN(value)) return;

        if (value < min || value > max) {
          console.warn("Statistics: значение " + value + " вне шкалы [" + min + "–" + max + "] для «" + question.title + "», пропущено");
          return;
        }

        sum += value;
        count++;

      });

      result.push({
        question: question.title,
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
      header => this.normalize_(header) === this.normalize_(question.dataTitle || question.title)
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
        console.warn("Statistics: ответ «" + raw + "» не входит в шкалу для «" + (question.dataTitle || question.title) + "», пропущен");
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
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
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
      header => this.normalize_(header) === this.normalize_(question.dataTitle || question.title)
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
   * ТОП-5 самых популярных ответов на открытый вопрос — из уже
   * посчитанных полных частот (calculateAnswerFrequencies), а не по
   * сырым строкам заново: те же частоты нужны и для сравнения годов,
   * поэтому считаются один раз в ReportService и передаются сюда.
   * При равенстве количества сохраняется порядок появления
   * в данных (п.17 спеки).
   *
   * percent считается от validCount (количество респондентов с непустым
   * ответом на вопрос), а не от суммы выборов — один респондент может
   * выбрать несколько вариантов сразу, см. calculateAnswerFrequencies.
   * Тот же знаменатель, что и в Comparison.compareTopAnswerItems, чтобы
   * процент за текущий год и процент в сравнении годов означали одно и
   * то же. Если валидных ответов на вопрос нет — percent null, а не
   * фиктивный 0% (та же схема, что и в Comparison.gs).
   */
  selectTopAnswers(frequencies, limit) {

    return frequencies.items
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, limit || 5)
      .map(item => ({
        answer: item.answer,
        count: item.count,
        percent: frequencies.validCount > 0
          ? Math.round(item.count / frequencies.validCount * 100)
          : null
      }));

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