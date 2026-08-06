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

    const enpsColumn = headers.indexOf("eNPS");

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

      const column = headers.indexOf(question);

      if (column === -1) return;

      let sum = 0;
      let count = 0;

      rows.forEach(row => {

        const value = Number(row[column]);

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

    const columnIndex = headers.indexOf(question.title);

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
   * ТОП-5 самых популярных ответов на открытый вопрос.
   * В одной ячейке может быть несколько выбранных вариантов,
   * склеенных через ".," — они разбираются по отдельности.
   * При равенстве количества сохраняется порядок появления
   * в данных (п.17 спеки).
   */
  calculateTopAnswers(rows, headers, question, limit) {

    const columnIndex = headers.indexOf(question.title);

    if (columnIndex === -1) {
      return [];
    }

    const items = [];
    const indexByAnswer = {};

    rows.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        return;
      }

      this.parseMultiAnswer_(raw).forEach(answer => {

        if (!(answer in indexByAnswer)) {
          indexByAnswer[answer] = items.length;
          items.push({ answer: answer, count: 0 });
        }

        items[indexByAnswer[answer]].count++;

      });

    });

    return items
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

  },

  /**
   * ==========================================================
   * НОВАЯ ФУНКЦИЯ: расчёт изменений для rating5 (2025 vs 2026)
   * ==========================================================
   */
  calculateRatingChanges(rows2025, rows2026, headers) {

    // Получаем все вопросы со средними (только rating5)
    const questions = Questions.getAverageQuestions();

    const changes = [];

    questions.forEach(question => {
      const column = headers.indexOf(question.title);
      if (column === -1) return;

      // Среднее 2025
      let sum2025 = 0, count2025 = 0;
      rows2025.forEach(row => {
        const val = Number(row[column]);
        if (!isNaN(val)) { sum2025 += val; count2025++; }
      });
      const avg2025 = count2025 ? sum2025 / count2025 : 0;

      // Среднее 2026
      let sum2026 = 0, count2026 = 0;
      rows2026.forEach(row => {
        const val = Number(row[column]);
        if (!isNaN(val)) { sum2026 += val; count2026++; }
      });
      const avg2026 = count2026 ? sum2026 / count2026 : 0;

      const change = avg2026 - avg2025;
      changes.push({
        question: question.title,
        avg2025: avg2025,
        avg2026: avg2026,
        change: change
      });
    });

    // Сортируем по изменению (по убыванию – лучшие изменения сверху)
    const sorted = changes.slice().sort((a, b) => b.change - a.change);

    // Топ-3 улучшения (положительная дельта)
    const improvements = sorted.filter(item => item.change > 0).slice(0, 3);

    // Топ-3 ухудшения (отрицательная дельта) – берём последние три (самые маленькие)
    const deteriorations = sorted.filter(item => item.change < 0).slice(-3).reverse();

    return {
      improvements: improvements,
      deteriorations: deteriorations
    };
  }

};