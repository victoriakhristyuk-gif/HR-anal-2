/**
 * ==========================================================
 * Кодирование ответов в числа
 * ==========================================================
 *
 * ФУНДАМЕНТ ВСЕЙ АНАЛИТИКИ. Корреляции, значимость, отклонения,
 * матрица драйверов — всё это операции над ЧИСЛОВЫМИ векторами.
 * Пока ответ лежит в таблице строкой «скорее да», ни один из этих
 * расчетов невозможен. Поэтому первым шагом любого анализа каждый
 * вопрос превращается в массив чисел одной длины с массивом строк
 * выборки, где пропуск = null (а не 0 — см. ниже).
 *
 * ВАЖНО ПРО null. Пропуск, «не пользовался» и «затрудняюсь ответить»
 * кодируются как null и исключаются из средних. Ноль тут недопустим:
 * Number("") === 0, и без явной проверки неотвеченный вопрос молча
 * стал бы оценкой «0» и обрушил среднее. Та же ловушка уже описана
 * в Statistics.calculateAverageRatings.
 *
 * ВАЖНО ПРО ШКАЛУ. Конкретные числа для порядковых шкал (4/3/2/1
 * против 100/50/20/0) влияют ТОЛЬКО на среднее. Корреляция Спирмена
 * считается по рангам, поэтому любое монотонное преобразование шкалы
 * дает ровно тот же коэффициент. Это освобождает от спора «а почему
 * скорее да = 3, а не 3.5».
 */

const Scoring = {

  /**
   * Ответы, которые НЕ являются точкой шкалы и должны выпадать из
   * расчетов, а не считаться низкой оценкой.
   *
   * «не пользовался» — человек не имеет опыта, а не оценил плохо.
   * «затрудняюсь ответить» — по выгоранию это отдельная группа риска
   * (см. Norms.RISK_UNKNOWN_*), но точкой шкалы она не является.
   */
  NOT_A_SCALE_POINT: ["не пользовался", "затрудняюсь ответить", "-", "—"],

  /**
   * Карты кодирования по вопросам с нечисловой шкалой.
   * Ключи нормализованы (trim + lowerCase), как везде в проекте.
   */
  MAPS: {

    // Шкала согласия «да / скорее да / скорее нет / нет».
    // Используется большинством scale4-вопросов.
    yesNo: {
      "да": 4,
      "скорее да": 3,
      "скорее нет": 2,
      "нет": 1
    },

    // Выгорание. Обратите внимание: шкала ПЕРЕВЕРНУТА относительно
    // текста ответа — больше балл значит ЛУЧШЕ (меньше выгорания).
    // Это обязательное условие: если часть вопросов «чем больше, тем
    // лучше», а часть наоборот, знаки корреляций перестанут читаться.
    // Все шкалы проекта приведены к «больше = лучше».
    burnout: {
      "совсем не чувствовал": 5,
      "чувствовал редко": 4,
      "чувствовал регулярно": 2,
      "чувствовал постоянно и чувствую сейчас": 1
    },

    // Намерение сменить работу, тоже «больше = лучше».
    retention: {
      "совсем не задумывался": 4,
      "очень редко, но такие мысли были": 3,
      "задумывался время от времени": 2,
      "постоянно и думаю об этом сейчас": 1
    }

  },

  /**
   * Какую карту применять к вопросу. Определяется по названию для
   * двух особых вопросов и по типу — для всех остальных.
   */
  mapFor(question) {

    const title = this.normalize_(question.title);

    if (title === "выгорание") return this.MAPS.burnout;
    if (title === "смена работы") return this.MAPS.retention;

    if (question.type === "scale4") return this.MAPS.yesNo;

    return null;

  },

  /**
   * Максимум шкалы вопроса — нужен для нормализации разных шкал
   * к общему виду 0–100 (см. Norms.normalizeLevel).
   */
  maxFor(question) {

    const title = this.normalize_(question.title);

    if (question.type === "rating5") return 5;
    if (question.type === "enps") return 10;
    if (title === "выгорание") return 5;

    return 4;

  },

  /**
   * Минимум шкалы. Для eNPS — 0, для остальных — 1.
   */
  minFor(question) {
    return question.type === "enps" ? 0 : 1;
  },

  /**
   * Числовой вектор ответов на один вопрос.
   *
   * Длина результата РАВНА длине rows: позиция i в векторе всегда
   * соответствует строке i выборки. Это критично — иначе нельзя
   * будет сопоставить два вопроса построчно для корреляции.
   *
   * @param {Array<Array>} rows
   * @param {Array<String>} headers
   * @param {Object} question - запись из Questions.getAll()
   * @returns {Array<Number|null>}
   */
  vector(rows, headers, question) {

    const columnIndex = this.columnIndex_(headers, question.dataTitle || question.title);

    if (columnIndex === -1) {
      return rows.map(() => null);
    }

    const map = this.mapFor(question);

    if (map) {
      return rows.map(row => this.score_(row[columnIndex], map));
    }

    const min = this.minFor(question);
    const max = this.maxFor(question);

    return rows.map(row => {
      const score = this.score_(row[columnIndex], null);
      if (score !== null && (score < min || score > max)) {
        console.warn("Scoring: значение " + score + " вне шкалы [" + min + "–" + max + "] для «" + question.title + "», пропущено");
        return null;
      }
      return score;
    });

  },

  /**
   * Оценка одной ячейки.
   */
  score_(raw, map) {

    if (raw === "" || raw === null || raw === undefined) {
      return null;
    }

    const text = this.normalize_(raw);

    if (this.NOT_A_SCALE_POINT.indexOf(text) !== -1) {
      return null;
    }

    if (map) {
      return map.hasOwnProperty(text) ? map[text] : null;
    }

    const value = Number(raw);

    return isNaN(value) ? null : value;

  },

  /**
   * Охват — доля людей, у которых по вопросу ЕСТЬ опыт.
   *
   * Самостоятельная метрика, а не служебная. Средняя оценка льготы
   * считается только по пользовавшимся, поэтому «Обучение 4,28»
   * может означать «четверым из десяти нравится, остальные шестеро
   * до обучения не добрались». Без охвата такая оценка вводит
   * в заблуждение.
   *
   * @returns {Object} {covered, notCovered, empty, total, coveredPercent}
   */
  coverage(rows, headers, question) {

    const columnIndex = this.columnIndex_(headers, question.dataTitle || question.title);

    if (columnIndex === -1) {
      return { covered: 0, notCovered: 0, empty: rows.length, total: rows.length, coveredPercent: null };
    }

    let covered = 0;
    let notCovered = 0;
    let empty = 0;

    rows.forEach(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) {
        empty++;
        return;
      }

      if (this.NOT_A_SCALE_POINT.indexOf(this.normalize_(raw)) !== -1) {
        notCovered++;
        return;
      }

      covered++;

    });

    const answered = covered + notCovered;

    return {
      covered: covered,
      notCovered: notCovered,
      empty: empty,
      total: rows.length,
      coveredPercent: answered > 0 ? covered / answered * 100 : null
    };

  },

  /**
   * Маска «затрудняюсь ответить» — булев массив длиной rows.length,
   * true там, где сырой ответ нормализуется РОВНО в этот вариант.
   *
   * ЗАЧЕМ ОТДЕЛЬНО ОТ NOT_A_SCALE_POINT. По выгоранию и смене работы
   * эта группа — не техническая пропущенная точка, а содержательная
   * группа риска (см. Norms.RISK_DENOMINATOR): её незачем терять
   * среди «не пользовался» и пустых ячеек, если задача — посчитать
   * именно её, а не выкинуть из выборки.
   *
   * @returns {Array<Boolean>}
   */
  uncertainMask(rows, headers, question) {

    const columnIndex = this.columnIndex_(headers, question.dataTitle || question.title);

    if (columnIndex === -1) {
      return rows.map(() => false);
    }

    return rows.map(row => {

      const raw = row[columnIndex];

      if (raw === "" || raw === null || raw === undefined) return false;

      return this.normalize_(raw) === "затрудняюсь ответить";

    });

  },

  /**
   * Доля позитива для порядковых шкал: сколько процентов выбрали
   * два верхних деления шкалы.
   *
   * Почему доля, а не среднее. У scale4 всего четыре деления, среднее
   * по ним плохо интерпретируется руководителем («3,41 из 4» ни о чем
   * не говорит), а «94% ответили да или скорее да» — говорит сразу.
   * Среднее при этом тоже считается, но для корреляций.
   *
   * @param {Array<Number|null>} vector
   * @param {Number} threshold - минимальный балл, считающийся позитивом
   */
  positiveShare(vector, threshold) {

    let positive = 0;
    let valid = 0;

    vector.forEach(value => {
      if (value === null) return;
      valid++;
      if (value >= threshold) positive++;
    });

    return {
      positive: positive,
      valid: valid,
      percent: valid > 0 ? positive / valid * 100 : null
    };

  },

  /**
   * Доля «дна» шкалы — сколько выбрали самый нижний вариант.
   *
   * Отдельная метрика, потому что среднее умеет прятать хвост:
   * у «ОС от руководителя» доля позитива 89,5% выглядит терпимо,
   * но 5,5% жестких «нет» означают, что есть руководители, которые
   * не дают обратную связь ВООБЩЕ. Это адресная проблема, а не
   * «показатель чуть ниже нормы».
   */
  bottomShare(vector, bottomValue) {

    let bottom = 0;
    let valid = 0;

    vector.forEach(value => {
      if (value === null) return;
      valid++;
      if (value === bottomValue) bottom++;
    });

    return {
      bottom: bottom,
      valid: valid,
      percent: valid > 0 ? bottom / valid * 100 : null
    };

  },

  columnIndex_(headers, title) {
    const target = this.normalize_(title);
    return headers.findIndex(header => this.normalize_(header) === target);
  },

  normalize_(value) {
    return String(value).trim().toLowerCase();
  }

};
