/**
 * ==========================================================
 * Руководитель и команда
 * ==========================================================
 *
 * Отдельный аналитический лист: Вся компания → Управление → Отдел →
 * Руководитель отдела / Сотрудники отдела. Строится ТОЛЬКО по ответам
 * 2026 — отдел берется из собственного ответа респондента на "Отдел", а
 * руководитель отдела определяется чекбоксом "Руководитель отдела" в
 * справочнике "перформанс" (см. PerformanceDirectory.gs), сопоставленным
 * по ФИО. В 2025 году поля "Роль в отделе"/справочника не существует —
 * поведение 2025 не меняется этим модулем вообще.
 *
 * Правила по отделу (см. PerformanceDirectory.managerIssuesFor_):
 *  - ни одного отмеченного руководителя  → отдел молча пропускается
 *    (это не ошибка — в компании не у каждого отдела в справочнике
 *    обязательно проставлен руководитель).
 *  - ровно один отмеченный руководитель  → отдел анализируется.
 *  - несколько отмеченных руководителей  → отдел попадает в отчет как
 *    ошибка (со списком имен), без анализа.
 *
 * Команда отдела — ВСЕ респонденты "Ответы 2026" с этим отделом в
 * анкете, кроме строки отмеченного руководителя (сопоставление по ФИО).
 * Отдельная строка сотрудника в справочнике "перформанс" для этого не
 * требуется — отсутствие сотрудника в справочнике не блокирует отчет и
 * не исключает его из команды (влияет только на срезы по
 * перформансу/грейду, которых в этом отчете нет).
 *
 * ПРИНЦИПИАЛЬНО: результат одного руководителя (n=1) — это отдельный
 * человек, а не статистический сегмент. Для него НЕ считается ни
 * значимость, ни доверительный интервал, и он никогда не попадает в
 * Segments.analyze/AnalyticsService.findings — этот модуль полностью
 * independent от пайплайна срезов/автовыводов.
 *
 * МАЛЕНЬКИЕ КОМАНДЫ НЕ ИСКЛЮЧАЮТСЯ. Средняя оценка команды и разница
 * считаются при любом n >= 1 (n — число ответивших на конкретный
 * вопрос, отдельно по каждому вопросу), но помечаются статусом
 * надежности (см. STATUS/reliabilityStatusFor_): n=0 — нет ответов
 * команды, n=1-2 — очень мало данных, n=3-4 — мало данных, n>=
 * MIN_TEAM_SIZE — достаточно данных. Автоматический вывод в колонке
 * "Интерпретация"/приоритет считаются только при статусе "достаточно
 * данных" — при меньшем n результат остается видимым для ориентировочного
 * сравнения, но не подмешивается в выводы/рейтинги/значимость. При n=1
 * средняя команды фактически раскрывает ответ одного сотрудника —
 * доступ к листу должен быть ограничен так же, как к персональным данным
 * (см. предупреждение в write()).
 *
 * "ЗАТРУДНЯЮСЬ ОТВЕТИТЬ"/"НЕ ПОЛЬЗОВАЛСЯ" — НЕ ПРОПУСК ВОПРОСА.
 * Scoring.vector дает managerValue===null сразу для четырех разных
 * сырых ситуаций: реально пустая ячейка, осознанный ответ "Затрудняюсь
 * ответить" (шкала "Выгорание"), осознанный ответ "Не пользовался"
 * (rating5-вопросы про офис/льготы) — оба намеренно исключены из
 * числовой шкалы, см. Scoring.NOT_A_SCALE_POINT — и опечатка/незнакомый
 * текст в ячейке. Scoring эти случаи не различает и не должен — это не
 * его ответственность. Различение — здесь, по сырой ячейке напрямую
 * (см. managerRawAnswer_/managerAnswerCaseFor_), в четыре отдельных
 * статуса (MANAGER_SKIPPED_QUESTION / MANAGER_UNCERTAIN /
 * MANAGER_NOT_USED / MANAGER_UNRECOGNIZED). Ни один из четырех не
 * считает числовую оценку/разницу и не участвует в автоматическом
 * выводе — это гарантирует общая проверка interpretationFor_/
 * priorityFor_ на STATUS.OK.
 *
 * Кодирование ответов и "Уровень 0-100" — существующие Scoring/Norms,
 * новая методика расчета не создается.
 */

const ManagerTeamReport = {

  SHEET_NAME: "Руководитель и команда",

  // Маленькие команды больше не исключаются из сравнения (n >= 1 уже
  // достаточно, чтобы посчитать среднюю и разницу) — вместо порога
  // отсечения это теперь только граница "полной" надежности статуса
  // STATUS.OK (см. reliabilityStatusFor_/VERY_LOW_TEAM_MAX/LOW_TEAM_MAX
  // ниже). Значение не изменилось (5), поэтому старое поведение при
  // n >= 5 остается прежним.
  MIN_TEAM_SIZE: 5,

  // Верхние границы n для промежуточных статусов надежности —
  // n=0 отдельный случай (NO_TEAM_ANSWERS), n=1..VERY_LOW_TEAM_MAX —
  // VERY_LOW_TEAM, n=(VERY_LOW_TEAM_MAX+1)..LOW_TEAM_MAX — LOW_TEAM,
  // n > LOW_TEAM_MAX (т.е. n >= MIN_TEAM_SIZE) — OK.
  VERY_LOW_TEAM_MAX: 2,
  LOW_TEAM_MAX: 4,

  STATUS: {
    MANAGER_DID_NOT_ANSWER: "руководитель не ответил",
    MANAGER_SKIPPED_QUESTION: "руководитель не ответил на этот вопрос",
    // Статусы ниже разбирают то, что раньше молча схлопывалось в
    // MANAGER_SKIPPED_QUESTION вместе с реально пустой ячейкой — см.
    // managerAnswerCaseFor_/UNCERTAIN_ANSWER_TEXT_/NOT_USED_ANSWER_TEXT_.
    // Scoring.vector дает managerValue===null во всех трех случаях (это
    // его законное поведение, см. Scoring.NOT_A_SCALE_POINT), поэтому
    // различать их приходится здесь, по сырой ячейке.
    MANAGER_UNCERTAIN: "руководитель затруднился ответить",
    MANAGER_NOT_USED: "руководитель не пользовался",
    MANAGER_UNRECOGNIZED: "нераспознанный вариант ответа",
    NO_TEAM_ANSWERS: "нет ответов команды",
    VERY_LOW_TEAM: "очень мало данных",
    LOW_TEAM: "мало данных",
    OK: "достаточно данных",
    MULTIPLE_MANAGERS: "ошибка: несколько руководителей"
  },

  // Варианты ответа анкеты, которые специально исключены из числовой
  // шкалы (см. Scoring.NOT_A_SCALE_POINT), но при этом являются
  // осознанным содержательным ответом руководителя, а не пропуском
  // вопроса: "затрудняюсь ответить" ("Выгорание") и "не пользовался"
  // (rating5-вопросы про офис/льготы — "Рабочий стол", "ДМС" и т.д.).
  // Сравнение — по нормализованному тексту (см. normalize_), как и
  // everywhere в проекте.
  UNCERTAIN_ANSWER_TEXT_: "затрудняюсь ответить",
  NOT_USED_ANSWER_TEXT_: "не пользовался",

  MANAGER_ANSWER_CASE_: {
    EMPTY: "empty",
    VALID: "valid",
    UNCERTAIN: "uncertain",
    NOT_USED: "not_used",
    UNRECOGNIZED: "unrecognized"
  },

  // Пороги для колонки "Интерпретация"/поля "Приоритет" — заданы
  // методикой задачи поверх уже существующего Уровня 0-100 и разницы
  // (Оценка руководителя - Средняя оценка команды). Сам расчет уровня
  // и разницы этим не затрагивается.
  INTERPRETATION_THRESHOLDS: {
    LOW_LEVEL: 60,     // "низкая" оценка по шкале 0-100
    SMALL_DIFF: 10,    // разница, воспринимаемая как совпадение
    LARGE_DIFF: 20     // разница, воспринимаемая как значимая
  },

  INTERPRETATION: {
    MATCH: "Восприятие руководителя и команды совпадает",
    BLIND_SPOT: "Возможная слепая зона руководителя: руководитель оценивает ситуацию заметно лучше команды",
    SHARED_CONCERN: "Общая зона внимания: проблему одинаково видят обе стороны",
    MANAGER_MORE_CRITICAL: "Руководитель оценивает ситуацию критичнее команды",
    MODERATE: "Расхождение восприятия умеренное, вне выделенных зон",
    INSUFFICIENT: "Недостаточно данных"
  },

  PRIORITY: {
    HIGH: "Высокий",
    MEDIUM: "Средний",
    LOW: "Низкий"
  },

  /**
   * Чистый расчет — без обращений к SpreadsheetApp. Принимает "сырые"
   * (необогащенные) headers/rows источника "Ответы 2026" и уже
   * разобранный справочник "перформанс" (см. PerformanceDirectory.parse_).
   * Тестируется на литеральных массивах (см. ManagerTeamReportTest.gs).
   *
   * @param {Array<String>} headers
   * @param {Array<Array>} rows
   * @param {{departments: Object}} directory - PerformanceDirectory.parse_/load результат
   * @returns {Array<Object>} по одной записи на отдел с ровно одним или
   *   несколькими отмеченными руководителями (отделы без руководителя
   *   в результат не попадают вообще)
   */
  build(headers, rows, directory) {

    const departmentIndex = headers.findIndex(
      h => this.normalize_(h) === this.normalize_(PerformanceDirectory.COLUMNS.DEPARTMENT)
    );
    const nameIndex = headers.findIndex(
      h => this.normalize_(h) === this.normalize_(PerformanceDirectory.COLUMNS.NAME)
    );

    if (departmentIndex === -1 || nameIndex === -1) {
      throw new Error(
        'Для отчета "' + this.SHEET_NAME + '" нужны столбцы "' + PerformanceDirectory.COLUMNS.DEPARTMENT +
        '" и "' + PerformanceDirectory.COLUMNS.NAME + '" — источник должен быть "Ответы 2026".'
      );
    }

    // Только вопросы, которые система уже умеет превращать в числовую
    // шкалу (см. Scoring.gs) — текстовые и профильные исключены, тот же
    // критерий, что и в AnalyticsService.trafficLight_/Cohort.changes.
    const questions = Questions.getAll().filter(
      question => question.report && question.type !== "text" && question.type !== "single"
    );

    const byDepartment = {};
    const departmentOrder = [];

    rows.forEach(row => {

      const rawDepartment = row[departmentIndex];

      if (rawDepartment === "" || rawDepartment === null || rawDepartment === undefined) return;

      const department = String(rawDepartment).trim();

      if (!byDepartment[department]) {
        byDepartment[department] = [];
        departmentOrder.push(department);
      }

      byDepartment[department].push(row);

    });

    departmentOrder.sort((a, b) => a.localeCompare(b, "ru"));

    const results = [];

    departmentOrder.forEach(department => {

      const departmentRows = byDepartment[department];
      const deptKey = PerformanceDirectory.normalizeText_(department);
      const directoryEntry = (directory.departments || {})[deptKey];
      const managers = directoryEntry ? directoryEntry.managers : [];

      // Ни одного отмеченного руководителя в справочнике — отдел молча
      // пропускается, это не ошибка (см. заголовок модуля).
      if (managers.length === 0) return;

      const canonicalDepartment = DepartmentAliases.canonicalize(department);
      const division = Headcount.divisionOf(canonicalDepartment) || Headcount.UNASSIGNED_LABEL;

      if (managers.length > 1) {
        results.push({
          division: division,
          department: department,
          error: this.STATUS.MULTIPLE_MANAGERS,
          managerNames: managers.map(m => m.name)
        });
        return;
      }

      const managerKey = PerformanceDirectory.normalizeName_(managers[0].name);

      const managerRow = departmentRows.find(
        row => PerformanceDirectory.normalizeName_(row[nameIndex]) === managerKey
      ) || null;
      const managerAnswered = !!managerRow;

      // Команда — все респонденты этого отдела из "Ответы 2026", кроме
      // отмеченного руководителя. Отдельная строка в справочнике
      // "перформанс" для этого не нужна.
      const teamRows = departmentRows.filter(row => row !== managerRow);

      const questionRows = questions.map(question => {

        const min = Scoring.minFor(question);
        const max = Scoring.maxFor(question);

        let managerValue = null;
        let managerLevel = null;
        let managerRaw = null;
        let managerCase = null; // null, пока managerRow нет вообще (см. STATUS.MANAGER_DID_NOT_ANSWER)

        if (managerRow) {
          managerValue = Scoring.vector([managerRow], headers, question)[0];
          managerLevel = managerValue === null
            ? null
            : MathStats.round(Norms.normalizeLevel(managerValue, min, max), 1);

          // managerValue===null у Scoring — законный результат сразу для
          // трех разных сырых ситуаций (пустая ячейка / "затрудняюсь
          // ответить" / опечатка в справочнике вариантов), которые сам
          // Scoring.vector не различает (и не должен — это не его
          // ответственность). Различаем здесь, по сырой ячейке напрямую,
          // не трогая методику Scoring (см. managerRawAnswer_ ниже).
          managerRaw = this.managerRawAnswer_(managerRow, headers, question);
          managerCase = this.managerAnswerCaseFor_(managerRaw, managerValue);
        }

        // Маленькие команды не исключаются: средняя и разница считаются
        // при любом n >= 1, а n=0 — единственный случай, когда команда
        // реально не отвечала на этот вопрос (см. STATUS/reliabilityStatusFor_
        // для градации надежности вместо старого бинарного отсечения).
        const teamVector = Scoring.vector(teamRows, headers, question).filter(v => v !== null);
        const teamN = teamVector.length;

        let teamMean = null;
        let teamLevel = null;
        let diff = null;

        if (teamN >= 1) {

          teamMean = teamVector.reduce((sum, v) => sum + v, 0) / teamN;
          teamLevel = MathStats.round(Norms.normalizeLevel(teamMean, min, max), 1);

          if (managerLevel !== null) {
            diff = MathStats.round(managerLevel - teamLevel, 1);
          }

        }

        // Приоритет статусов: сначала проблемы с ответом руководителя
        // (не участвовал в опросе вовсе / реально пустая ячейка /
        // осознанно выбрал "затрудняюсь ответить" или "не пользовался" /
        // нераспознанный текст в ячейке) — это отдельные причины
        // ненадежности, не связанные с размером команды. Иначе —
        // градация надежности по n команды.
        let status;

        if (!managerAnswered) {
          status = this.STATUS.MANAGER_DID_NOT_ANSWER;
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.EMPTY) {
          status = this.STATUS.MANAGER_SKIPPED_QUESTION;
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.UNCERTAIN) {
          status = this.STATUS.MANAGER_UNCERTAIN;
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.NOT_USED) {
          status = this.STATUS.MANAGER_NOT_USED;
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.UNRECOGNIZED) {
          status = this.STATUS.MANAGER_UNRECOGNIZED;
        } else {
          status = this.reliabilityStatusFor_(teamN);
        }

        // Текстовая интерпретация ответа руководителя зависит от case:
        // валидный ответ — обычная ближайшая категория (как раньше);
        // "затрудняюсь ответить"/"не пользовался" — сам этот текст, с
        // большой буквы; нераспознанный текст — исходная сырая ячейка
        // как есть, чтобы можно было найти и поправить опечатку в
        // справочнике вариантов (см. заголовок STATUS.MANAGER_UNRECOGNIZED).
        // Ни в одном из трех последних случаев числовая оценка не
        // считается (managerLevel остался null выше) — только читаемая
        // подпись вместо пустой ячейки.
        let managerText = null;

        if (managerCase === this.MANAGER_ANSWER_CASE_.VALID) {
          managerText = this.answerLabel_(question, managerValue);
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.UNCERTAIN) {
          managerText = this.capitalize_(this.UNCERTAIN_ANSWER_TEXT_);
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.NOT_USED) {
          managerText = this.capitalize_(this.NOT_USED_ANSWER_TEXT_);
        } else if (managerCase === this.MANAGER_ANSWER_CASE_.UNRECOGNIZED) {
          managerText = managerRaw;
        }

        const teamText = (teamMean !== null)
          ? this.answerLabel_(question, teamMean)
          : null;

        const interpretation = this.interpretationFor_(status, managerLevel, teamLevel, diff);
        const priority = this.priorityFor_(status, teamLevel, diff);

        return {
          question: question.title,
          managerLevel: managerAnswered ? managerLevel : null,
          teamLevel: teamLevel,
          managerText: managerText,
          teamText: teamText,
          teamN: teamN,
          diff: diff,
          status: status,
          interpretation: interpretation,
          priority: priority
        };

      });

      // Сортировка по приоритету (Высокий → Средний → Низкий) — только
      // порядок вывода внутри отдела, расчеты по вопросам не меняются.
      questionRows.sort((a, b) => this.priorityRank_(a.priority) - this.priorityRank_(b.priority));

      results.push({
        division: division,
        department: department,
        managerAnswered: managerAnswered,
        teamSize: teamRows.length,
        questions: questionRows
      });

    });

    return results;

  },

  normalize_(value) {
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  },

  /**
   * Сырое (не прошедшее через Scoring) значение ячейки руководителя по
   * конкретному вопросу — та же логика поиска колонки, что и в
   * Scoring.columnIndex_ (dataTitle||title, нормализованное сравнение),
   * но реализована локально: Scoring остается нетронутым, вся логика
   * различения "пусто"/"затрудняюсь ответить"/"нераспознанный вариант"
   * — в ManagerTeamReport (см. managerAnswerCaseFor_).
   *
   * @returns {String|null} обрезанный текст ячейки или null, если ячейка
   *   реально пуста (или колонка вопроса не найдена в headers)
   */
  managerRawAnswer_(row, headers, question) {

    const target = this.normalize_(question.dataTitle || question.title);
    const columnIndex = headers.findIndex(h => this.normalize_(h) === target);

    if (columnIndex === -1) return null;

    const raw = row[columnIndex];

    if (raw === "" || raw === null || raw === undefined) return null;

    return String(raw).trim();

  },

  /**
   * Классифицирует сырой ответ руководителя на конкретный вопрос —
   * различает три причины managerValue===null (Scoring дает null и для
   * пустой ячейки, и для "затрудняюсь ответить", и для нераспознанного
   * текста — сам Scoring это различать не должен, см. заголовок STATUS).
   *
   * @param {String|null} managerRaw - managerRawAnswer_(...)
   * @param {Number|null} managerValue - Scoring.vector(...)[0] для той же ячейки
   * @returns {String} одно из MANAGER_ANSWER_CASE_
   */
  managerAnswerCaseFor_(managerRaw, managerValue) {

    if (managerRaw === null) return this.MANAGER_ANSWER_CASE_.EMPTY;
    if (managerValue !== null) return this.MANAGER_ANSWER_CASE_.VALID;

    const normalized = this.normalize_(managerRaw);

    if (normalized === this.UNCERTAIN_ANSWER_TEXT_) return this.MANAGER_ANSWER_CASE_.UNCERTAIN;
    if (normalized === this.NOT_USED_ANSWER_TEXT_) return this.MANAGER_ANSWER_CASE_.NOT_USED;

    return this.MANAGER_ANSWER_CASE_.UNRECOGNIZED;

  },

  /**
   * Текстовый вариант ответа, ближайший к сырому значению на исходной
   * шкале вопроса (Scoring.vector) — используется как для одиночного
   * ответа руководителя, так и (при некратном среднем) для средней
   * оценки команды: берется ближайшая категория. Уровень 0-100 при
   * этом не трогается — это только читаемая подпись рядом с числом.
   *
   * @param {Object} question - запись Questions.getAll()
   * @param {Number|null} rawValue - значение на исходной шкале вопроса
   *   (для команды — среднее, не округленное заранее)
   * @returns {String|null}
   */
  answerLabel_(question, rawValue) {

    if (rawValue === null || rawValue === undefined) return null;

    // Вопросы с текстовой шкалой (да/скорее да/…, выгорание, смена
    // работы) — находим вариант, чье кодовое число ближе всего к
    // сырому значению (для дробного среднего команды это и есть
    // "ближайшая категория" из требования задачи).
    const map = Scoring.mapFor(question);

    if (map) {

      let bestLabel = null;
      let bestDiff = Infinity;

      Object.keys(map).forEach(label => {
        const diff = Math.abs(map[label] - rawValue);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestLabel = label;
        }
      });

      return this.capitalize_(bestLabel);

    }

    // Числовые шкалы без текстовых вариантов (rating5, eNPS) — сам
    // исходный балл и есть "ответ", округляем только для дробного
    // среднего команды.
    const rounded = Math.round(rawValue);

    if (question.type === "enps") return rounded + " из 10";
    if (question.type === "rating5") return rounded + " из 5";

    return String(rounded);

  },

  capitalize_(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  /**
   * Колонка "Интерпретация" — автоматический вывод по разнице между
   * Уровнем 0-100 руководителя и команды. Приоритет условий заранее
   * задан методикой задачи (см. заголовок раздела в тех.задании):
   * совпадение → слепая зона → общая зона внимания → руководитель
   * критичнее → (оставшиеся случаи, явно не описанные методикой) →
   * недостаточно данных.
   */
  interpretationFor_(status, managerLevel, teamLevel, diff) {

    if (status !== this.STATUS.OK) return this.INTERPRETATION.INSUFFICIENT;

    const t = this.INTERPRETATION_THRESHOLDS;

    if (Math.abs(diff) <= t.SMALL_DIFF) return this.INTERPRETATION.MATCH;
    if (teamLevel < t.LOW_LEVEL && diff > t.LARGE_DIFF) return this.INTERPRETATION.BLIND_SPOT;
    if (managerLevel < t.LOW_LEVEL && teamLevel < t.LOW_LEVEL && diff < t.LARGE_DIFF) return this.INTERPRETATION.SHARED_CONCERN;
    if (diff < -t.LARGE_DIFF) return this.INTERPRETATION.MANAGER_MORE_CRITICAL;

    return this.INTERPRETATION.MODERATE;

  },

  /**
   * Техническое поле "Приоритет" — используется только для сортировки
   * вопросов внутри отдела (см. build), не является выводом об
   * эффективности руководителя.
   */
  priorityFor_(status, teamLevel, diff) {

    if (status !== this.STATUS.OK) return this.PRIORITY.LOW;

    const t = this.INTERPRETATION_THRESHOLDS;

    if (teamLevel < t.LOW_LEVEL && diff > t.LARGE_DIFF) return this.PRIORITY.HIGH;
    if (diff > t.LARGE_DIFF && teamLevel >= t.LOW_LEVEL) return this.PRIORITY.MEDIUM;

    return this.PRIORITY.LOW;

  },

  priorityRank_(priority) {
    if (priority === this.PRIORITY.HIGH) return 0;
    if (priority === this.PRIORITY.MEDIUM) return 1;
    return 2;
  },

  /**
   * Статус надежности по n команды, ответившей на конкретный вопрос —
   * вызывается только когда руководитель сам ответил на этот вопрос
   * (иначе действуют MANAGER_DID_NOT_ANSWER/MANAGER_SKIPPED_QUESTION,
   * см. build). Команда не отсекается ни при каком n — статус только
   * маркирует надежность уже посчитанной средней/разницы.
   */
  reliabilityStatusFor_(teamN) {
    if (teamN === 0) return this.STATUS.NO_TEAM_ANSWERS;
    if (teamN <= this.VERY_LOW_TEAM_MAX) return this.STATUS.VERY_LOW_TEAM;
    if (teamN <= this.LOW_TEAM_MAX) return this.STATUS.LOW_TEAM;
    return this.STATUS.OK;
  },

  /**
   * Заливка колонки "Статус надёжности" — см. требование задачи:
   * n=0 серый, n=1-2 оранжевый, n=3-4 желтый, n>=5 без заливки,
   * несколько руководителей — существующая красная ошибка. Проблемы
   * с ответом руководителя (не ответил вовсе/пропустил вопрос/затруднился
   * ответить/не пользовался) не описаны в требовании отдельно — сохраняют
   * прежний "предупреждающий" персиковый цвет, чтобы не потерять сигнал о
   * непригодности сравнения. Нераспознанный вариант — отдельный
   * лиловый цвет: это не проблема с ответом руководителя, а сигнал
   * поправить справочник вариантов вопроса.
   */
  STATUS_COLORS_: {
    "ошибка: несколько руководителей": "#f4c7c3",
    "руководитель не ответил": "#fcd5b4",
    "руководитель не ответил на этот вопрос": "#fcd5b4",
    "руководитель затруднился ответить": "#fcd5b4",
    "руководитель не пользовался": "#fcd5b4",
    "нераспознанный вариант ответа": "#d9d2e9",
    "нет ответов команды": "#d9d9d9",
    "очень мало данных": "#f8cbad",
    "мало данных": "#ffe699"
  },

  statusColor_(status) {
    return this.STATUS_COLORS_.hasOwnProperty(status) ? this.STATUS_COLORS_[status] : null;
  },

  /**
   * Показатели для блока-обзора сверху листа (см. write()). Считаются
   * по уже построенному results — дополнительных проходов по сырым
   * ответам не требуется.
   */
  computeOverview_(results) {

    let departmentsAnalyzed = 0;
    let managersAnswered = 0;
    let bigGapDepartments = 0;
    let insufficientDepartments = 0;

    results.forEach(department => {

      if (department.error) return;

      departmentsAnalyzed++;

      if (department.managerAnswered) managersAnswered++;
      if (department.teamSize < this.MIN_TEAM_SIZE) insufficientDepartments++;
      if (department.questions.some(q => q.priority === this.PRIORITY.HIGH)) bigGapDepartments++;

    });

    return {
      departmentsAnalyzed: departmentsAnalyzed,
      managersAnswered: managersAnswered,
      bigGapDepartments: bigGapDepartments,
      insufficientDepartments: insufficientDepartments
    };

  },

  /**
   * Загрузить справочник "перформанс" и "сырые" ответы 2026 для build().
   * В отличие от прежней строгой версии, здесь НЕ бросается исключение
   * из-за отделов без руководителя/с несколькими руководителями (это
   * обрабатывается для каждого отдела отдельно внутри build) и из-за
   * сотрудников, не найденных в справочнике (это не блокирует отчет —
   * см. заголовок модуля). Единственное, что все еще может бросить
   * исключение, — структурные проблемы самого листа "перформанс"
   * (не найден лист / нет обязательных столбцов), см. PerformanceDirectory.load.
   *
   * @returns {{headers: Array<String>, data: Array<Array>, directory: Object}}
   */
  prepare_() {

    const directory = PerformanceDirectory.load();
    const survey = loadSurveyData("2026", true);

    return { headers: survey.headers, data: survey.data, directory: directory };

  },

  /**
   * Записать лист "Руководитель и команда". Строится по 2026 — отдел
   * берется из ответа респондента, руководитель — из справочника
   * "перформанс" (см. build). Отделы без отмеченного руководителя не
   * попадают на лист вообще; отделы с несколькими отмеченными
   * руководителями попадают как ошибка без анализа (см. STATUS.MULTIPLE_MANAGERS).
   */
  write() {

    const prepared = this.prepare_();
    const results = this.build(prepared.headers, prepared.data, prepared.directory);

    const sheet = AnalyticsWriter.sheet_(this.SHEET_NAME);

    const numCols = 10;

    const introStartRow = Formatter.writeSheetIntro(sheet,
      "Как результат руководителя соотносится с его командой",
      'Один руководитель — это конкретный человек, а не статистическая группа: для него не считается ни значимость, ни доверительный интервал, и он не попадает в "Отклонения срезов"/"Выводы". Средняя оценка и разница считаются при любом числе ответивших сотрудников (n ≥ 1) — маленькие команды не исключаются, но помечаются статусом надежности (n=0 — нет ответов команды; n=1-2 — очень мало данных; n=3-4 — мало данных; n≥' +
        this.MIN_TEAM_SIZE + ' — достаточно данных). Результаты при n=1-4 — ориентировочное сравнение, а не устойчивый статистический вывод, и не участвуют в автоматических выводах/рейтингах/значимости (см. колонку "Интерпретация"). ВАЖНО: при n=1 средняя оценка команды фактически раскрывает ответ одного конкретного сотрудника — доступ к этому листу должен быть ограничен так же, как к персональным данным. ФИО не выводится нигде на этом листе. Отделы без отмеченного в справочнике "перформанс" руководителя на этот лист не попадают.',
      numCols);

    // Блок-обзор сверху — только счетчики по уже посчитанному results,
    // детальная таблица ниже не меняется по составу строк.
    const overview = this.computeOverview_(results);

    const overviewTitleRange = sheet.getRange(introStartRow, 1, 1, numCols);
    overviewTitleRange.setValue("Руководитель и команда — обзор")
      .setFontWeight("bold")
      .setFontSize(12)
      .mergeAcross();

    const overviewRows = [
      ["Отделов с анализом", overview.departmentsAnalyzed],
      ["Руководителей, участвовавших в опросе", overview.managersAnswered],
      ["Отделов с крупными расхождениями", overview.bigGapDepartments],
      ["Отделов с недостаточным количеством ответов", overview.insufficientDepartments]
    ];

    sheet.getRange(introStartRow + 1, 1, overviewRows.length, 2).setValues(overviewRows);
    sheet.getRange(introStartRow + 1, 1, overviewRows.length, 1).setFontWeight("bold");

    const startRow = introStartRow + overviewRows.length + 2; // +1 заголовок обзора, +1 пустая строка

    const header = ["Управление", "Отдел", "Вопрос", "Оценка руководителя", "Средняя оценка сотрудников",
      "n сотрудников", "Разница", "Интерпретация", "Приоритет", "Статус надёжности"];

    const rows = [];

    results.forEach(department => {

      if (department.error) {
        rows.push([
          department.division,
          department.department,
          'Несколько отмеченных руководителей в справочнике "перформанс": ' + department.managerNames.join(", "),
          "", "", "", "", "", "",
          department.error
        ]);
        return;
      }

      department.questions.forEach(row => {

        // managerLevel может быть null даже при непустом managerText —
        // "затрудняюсь ответить"/нераспознанный вариант текст показывают,
        // но числовую оценку по требованию задачи не считают (см. build).
        const managerCell = row.managerText
          ? (row.managerLevel !== null ? row.managerText + " (" + row.managerLevel + ")" : row.managerText)
          : "";
        const teamCell = row.teamText ? row.teamText + " (" + row.teamLevel + ")" : "";

        rows.push([
          department.division,
          department.department,
          row.question,
          managerCell,
          teamCell,
          row.teamN,
          row.diff !== null ? row.diff : "",
          row.interpretation,
          row.priority,
          row.status
        ]);

      });

    });

    AnalyticsWriter.dump_(sheet, header, rows,
      [190, 260, 220, 190, 210, 100, 90, 340, 100, 220], startRow, [
        [3, "Ближайший текстовый вариант ответа руководителя и Уровень 0-100 (Norms.normalizeLevel) в скобках — один человек, не среднее. Если руководитель выбрал «Затрудняюсь ответить»/«Не пользовался» или ячейка содержит нераспознанный текст, число в скобках не показывается — см. колонку \"Статус надёжности\"."],
        [4, "Ближайшая текстовая категория среднего ответа команды и Уровень 0-100 в скобках — считается при любом n ≥ 1, надежность см. в колонке \"Статус надёжности\"."],
        [7, "Автоматический вывод по разнице (Оценка руководителя − Средняя оценка команды) на шкале 0-100: не является оценкой эффективности руководителя, только поиск расхождений восприятия. Считается только при статусе «" +
          this.STATUS.OK + "» (n ≥ " + this.MIN_TEAM_SIZE + ") — при меньшем n, а также при «" + this.STATUS.MANAGER_UNCERTAIN +
          "»/«" + this.STATUS.MANAGER_NOT_USED + "»/«" + this.STATUS.MANAGER_UNRECOGNIZED + "» не участвует в автоматическом выводе."],
        [8, "Техническое поле для сортировки строк внутри отдела (Высокий → Средний → Низкий), колонка скрыта."],
        [9, "«" + this.STATUS.MANAGER_DID_NOT_ANSWER + "» — руководитель не найден среди ответов своего отдела; «" +
          this.STATUS.MANAGER_SKIPPED_QUESTION + "» — руководитель ответил в опросе, но ячейка по этому вопросу пуста; «" +
          this.STATUS.MANAGER_UNCERTAIN + "» — руководитель осознанно выбрал «Затрудняюсь ответить» (это не пропуск вопроса, числовая оценка по методике не считается); «" +
          this.STATUS.MANAGER_NOT_USED + "» — руководитель осознанно выбрал «Не пользовался» (тоже не пропуск вопроса, числовая оценка не считается); «" +
          this.STATUS.MANAGER_UNRECOGNIZED + "» — ячейка непустая, но текст не входит в известные варианты ответа (см. текст в колонке \"Оценка руководителя\" и поправьте справочник вариантов); «" +
          this.STATUS.NO_TEAM_ANSWERS + "» (n=0), «" + this.STATUS.VERY_LOW_TEAM + "» (n=1-2), «" + this.STATUS.LOW_TEAM +
          "» (n=3-4) — команда ответила, но выборка маленькая, сравнение ориентировочное; «" + this.STATUS.OK +
          "» (n≥" + this.MIN_TEAM_SIZE + ") — можно сравнивать уверенно; «" + this.STATUS.MULTIPLE_MANAGERS +
          "» — в справочнике \"перформанс\" в этом отделе отмечено больше одного руководителя."]
      ]);

    // Пакетное форматирование: один массив цветов на весь диапазон и
    // один вызов setBackgrounds — вместо getRange().setBackground()
    // построчно в цикле. Цвет определяется по статусу (см. STATUS_COLORS_/
    // statusColor_) — n=0 серый, n=1-2 оранжевый, n=3-4 желтый, n>=5 без
    // заливки, несколько руководителей — красная ошибка.
    if (rows.length) {

      const backgrounds = rows.map(row => [this.statusColor_(row[9])]);

      sheet.getRange(startRow + 1, 10, rows.length, 1).setBackgrounds(backgrounds);

    }

    sheet.hideColumns(9);
    sheet.setHiddenGridlines(true);

  }

};
