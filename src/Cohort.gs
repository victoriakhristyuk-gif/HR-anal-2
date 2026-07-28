/**
 * ==========================================================
 * Сквозная когорта — сравнение одних и тех же людей
 * ==========================================================
 *
 * САМЫЙ ЧЕСТНЫЙ СПОСОБ ИЗМЕРИТЬ ДИНАМИКУ.
 *
 * Обычное сравнение годов смешивает два разных эффекта:
 *   1) люди стали относиться иначе;
 *   2) отвечать пришли другие люди.
 *
 * Разделить их можно только одним способом: взять тех, кто ответил
 * ОБА года, и посмотреть, что изменилось внутри каждого человека.
 *
 * ЧТО ЭТО ДАЛО НА ДАННЫХ 2026:
 *
 *   Выгорание. По всей выборке улучшение с 22,0% до 16,5%, z = −1,97,
 *   формально значимо. На когорте из 142 человек изменение +0,008 балла,
 *   то есть ровно ноль. Вывод: «улучшение» почти целиком объясняется
 *   тем, что в этом году пришли отвечать другие люди.
 *
 *   Корпоративы. По всей выборке −0,09, шум. На когорте −0,21 при
 *   t = −2,07 — единственное статистически значимое падение года.
 *   Общая цифра его прятала.
 *
 * ОГРАНИЧЕНИЕ, О КОТОРОМ НАДО ПИСАТЬ В ОТЧЕТЕ. Когорта строится по
 * подписанным анкетам, а подписываются более лояльные: eNPS когорты
 * +65,5 против +55,7 по всей выборке. Поэтому УРОВЕНЬ по когорте
 * читать нельзя — только ИЗМЕНЕНИЕ. Внутри когорты смещение
 * одинаково в оба года и на разности сокращается.
 */

const Cohort = {

  /**
   * Ключ сопоставления людей между годами.
   *
   * Сейчас — ФИО. Это работает, но хрупко: опечатки, смена фамилии,
   * «Иванов И.» против «Иванов Иван» дадут промах. Если в анкете
   * появится табельный номер или корпоративная почта — переключить
   * сюда, и когорта станет заметно полнее.
   */
  KEY_QUESTION: "Фамилия Имя",

  /**
   * Построить когорту: строки обоих лет, выровненные по людям.
   *
   * Результат — два массива ОДИНАКОВОЙ длины, где позиция i в обоих
   * относится к одному человеку. Именно это требуется для парного
   * критерия.
   */
  build(rowsNow, rowsBefore, headers) {

    const columnIndex = headers.findIndex(
      h => String(h).trim().toLowerCase() === this.KEY_QUESTION.trim().toLowerCase()
    );

    if (columnIndex === -1) {
      return { now: [], before: [], size: 0, reason: "не найден столбец с ключом сопоставления" };
    }

    const indexBefore = {};
    const duplicates = {};

    rowsBefore.forEach(row => {

      const key = this.key_(row[columnIndex]);

      if (!key) return;

      // Дубли ключа делают сопоставление неоднозначным — такие
      // записи выбрасываются целиком, а не берется первая попавшаяся.
      if (indexBefore.hasOwnProperty(key)) {
        duplicates[key] = true;
        return;
      }

      indexBefore[key] = row;

    });

    const now = [];
    const before = [];
    const seen = {};

    rowsNow.forEach(row => {

      const key = this.key_(row[columnIndex]);

      if (!key || duplicates[key] || seen[key]) return;
      if (!indexBefore.hasOwnProperty(key)) return;

      seen[key] = true;
      now.push(row);
      before.push(indexBefore[key]);

    });

    return {
      now: now,
      before: before,
      size: now.length,
      droppedDuplicates: Object.keys(duplicates).length,
      signedNow: rowsNow.filter(r => this.key_(r[columnIndex])).length,
      signedBefore: rowsBefore.filter(r => this.key_(r[columnIndex])).length
    };

  },

  /**
   * Парные изменения по всем шкальным вопросам.
   *
   * Возвращает только вопросы, где когорта достаточна, отсортированные
   * по величине изменения. Значимые изменения помечены.
   */
  changes(cohort, headers, questions) {

    if (cohort.size < 30) {
      return { rows: [], reason: "когорта меньше 30 человек — парный анализ ненадежен", size: cohort.size };
    }

    const rows = [];

    questions.forEach(question => {

      if (question.type === "text" || question.type === "single") return;

      const after = Scoring.vector(cohort.now, headers, question);
      const beforeVector = Scoring.vector(cohort.before, headers, question);

      const test = MathStats.pairedTest(after, beforeVector);

      if (test.t === null) return;

      rows.push({
        question: question.title,
        group: question.group,
        meanDiff: MathStats.round(test.meanDiff, 3),
        n: test.n,
        t: MathStats.round(test.t, 2),
        up: test.up,
        down: test.down,
        same: test.same,
        significant: test.significant,
        verdict: test.significant
          ? (test.meanDiff > 0 ? "значимый рост у одних и тех же людей" : "значимое падение у одних и тех же людей")
          : "изменений нет (в пределах шума)"
      });

    });

    rows.sort((a, b) => a.meanDiff - b.meanDiff);

    return { rows: rows, size: cohort.size };

  },

  /**
   * eNPS когорты обоих лет.
   *
   * Смотреть надо на ДЕЛЬТУ и на структуру переходов (сколько человек
   * подняли оценку, сколько опустили), а не на уровень.
   */
  enpsChange(cohort, headers, questions) {

    const enpsQuestion = questions.find(q => q.type === "enps");

    if (!enpsQuestion || cohort.size === 0) return null;

    const after = Scoring.vector(cohort.now, headers, enpsQuestion);
    const before = Scoring.vector(cohort.before, headers, enpsQuestion);

    const score = vector => {
      const valid = vector.filter(v => v !== null);
      const promoters = valid.filter(v => v >= 9).length;
      const detractors = valid.filter(v => v <= 6).length;
      return MathStats.enpsConfidence(promoters, detractors, valid.length);
    };

    const now = score(after);
    const previous = score(before);
    const paired = MathStats.pairedTest(after, before);

    return {
      enpsNow: MathStats.round(now.enps, 1),
      enpsBefore: MathStats.round(previous.enps, 1),
      delta: MathStats.round(now.enps - previous.enps, 1),
      meanScoreShift: MathStats.round(paired.meanDiff, 2),
      up: paired.up,
      down: paired.down,
      same: paired.same,
      significant: paired.significant,
      size: cohort.size
    };

  },

  key_(value) {

    if (value === null || value === undefined) return "";

    return String(value)
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ");

  }

};
