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
 * команды; n>=MIN_TEAM_SIZE ИЛИ доля ответивших от всей команды >=
 * TEAM_COVERAGE_OK_RATIO — "достаточно данных"; иначе — статус называет
 * обе цифры ("ответили N из M"), не абстрактное "мало данных": 4 из 5
 * (80% команды) это полноценный результат, а 4 из 40 (10%) — нет, хотя
 * абсолютное n одинаковое. Автоматический вывод в колонке
 * "Интерпретация"/приоритет считаются только при статусе "достаточно
 * данных" — при меньшей доле результат остается видимым для
 * ориентировочного сравнения, но не подмешивается в выводы/рейтинги/
 * значимость. При n=1 средняя команды фактически раскрывает ответ
 * одного сотрудника —
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

  // Маленькие команды не исключаются из сравнения (n >= 1 уже
  // достаточно, чтобы посчитать среднюю и разницу). "Достаточно данных"
  // (STATUS.OK) — если ответили хотя бы MIN_TEAM_SIZE человек ЛИБО
  // ответила доля команды не ниже TEAM_COVERAGE_OK_RATIO (см.
  // reliabilityStatusFor_ ниже): 4 ответа из команды в 5 человек — это
  // вся команда, а не "мало данных"; 4 из 40 — это четыре человека, и
  // абсолютное n=4 тут ничем не отличается от первого случая, разница
  // только в доле. Раньше порог был абсолютным (n>=5) и не различал
  // эти два случая.
  MIN_TEAM_SIZE: 5,

  // Доля команды, ответившей на конкретный вопрос, при которой
  // результат считается достаточным независимо от абсолютного n.
  TEAM_COVERAGE_OK_RATIO: 0.6,

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
    // "Мало данных"/"очень мало данных" больше не отдельные статусы —
    // reliabilityStatusFor_ вместо них возвращает динамическую метку
    // "ответили N из M" (см. задачу 5 методики: доля команды важнее
    // абсолютного n).
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

  // Направление расхождения по конкретной теме (колонка "Кто оценивает
  // выше" в компактном листе) — считается напрямую по знаку diff
  // (managerLevel − teamLevel), см. whoScoresHigherFor_. Не путать с
  // величиной расхождения (столбец "Расхождение" показывает |diff|).
  WHO_HIGHER: {
    MANAGER: "Руководитель",
    TEAM: "Команда",
    EQUAL: "Оценки совпадают"
  },

  // Итоговое резюме по отделу (колонка "Кто в целом оценивает выше" в
  // компактном листе, итоговая строка отдела) — сравнение средней оценки
  // руководителя со средней оценкой команды по темам, где присутствуют
  // обе оценки (см. overallWhoScoresHigherFor_). Порог существенности —
  // тот же INTERPRETATION_THRESHOLDS.SMALL_DIFF, что уже используется в
  // interpretationFor_ для "оценки совпадают" по отдельной теме, новая
  // методика не вводится.
  OVERALL_WHO_HIGHER: {
    MANAGER: "Руководитель оценивает выше",
    TEAM: "Сотрудники оценивают выше",
    EQUAL: "Существенных расхождений нет",
    INSUFFICIENT: "Недостаточно данных"
  },

  // Общий статус отдела в свернутой итоговой строке — производный от
  // уже посчитанных significantCount/hasComparison (см. build()), не
  // новая методика: "Оценки близки" — hasComparison и significantCount=0,
  // "Есть расхождения" — hasComparison и significantCount>0,
  // "Недостаточно данных для сравнения" — !hasComparison (не путать с
  // значением "0 расхождений").
  SUMMARY_STATUS: {
    CLOSE: "Оценки близки",
    DISCREPANCIES: "Есть расхождения",
    INSUFFICIENT: "Недостаточно данных для сравнения"
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
   * @param {Function} [divisionResolver] - передается только рабочим
   *   write(); отсутствие сохраняет build() чистым для тестов
   * @returns {Array<Object>} по одной записи на отдел с ровно одним или
   *   несколькими отмеченными руководителями (отделы без руководителя
   *   в результат не попадают вообще)
   */
  build(headers, rows, directory, divisionResolver) {

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
      const division = typeof divisionResolver === "function"
        ? (divisionResolver(canonicalDepartment) || Headcount.UNASSIGNED_LABEL)
        : Headcount.UNASSIGNED_LABEL;

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
          status = this.reliabilityStatusFor_(teamN, teamRows.length);
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
        const whoScoresHigher = this.whoScoresHigherFor_(diff);

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
          priority: priority,
          whoScoresHigher: whoScoresHigher
        };

      });

      // Сохраняем исходный индекс вопроса (порядок анкеты) до сортировки —
      // это единственный способ дать стабильный тай-брейк для тем с
      // одинаковым |расхождение| (см. compareQuestionsByAbsDiff_ ниже),
      // не полагаясь неявно на стабильность Array.sort в рантайме.
      questionRows.forEach((row, i) => { row.originalIndex = i; });

      // Сортировка внутри отдела — по модулю расхождения (Оценка
      // руководителя − Средняя оценка команды), от большего к меньшему;
      // темы без числового сравнения (diff === null — руководитель не
      // ответил/затруднился/выбрал "не пользовался"/нераспознанный текст/
      // нет ответов команды) уходят в конец, сохраняя исходный порядок
      // анкеты между собой. Сам расчет diff/статуса этим не затрагивается
      // — сортировка только про порядок вывода строк.
      questionRows.sort((a, b) => this.compareQuestionsByAbsDiff_(a, b));

      // Существенное расхождение — только среди тем с полностью надежным
      // сравнением (status === STATUS.OK), с уже существующей категоризацией
      // interpretationFor_ (BLIND_SPOT/MANAGER_MORE_CRITICAL), без нового
      // порога поверх INTERPRETATION_THRESHOLDS.LARGE_DIFF. Темы, которые
      // сравнить нельзя, не входят ни в matchedCount, ни в significantCount
      // — отсутствие данных не приравнивается к нулю расхождений.
      const comparableQuestions = questionRows.filter(row => row.status === this.STATUS.OK);
      const significantCount = comparableQuestions.filter(row =>
        row.interpretation === this.INTERPRETATION.BLIND_SPOT ||
        row.interpretation === this.INTERPRETATION.MANAGER_MORE_CRITICAL
      ).length;
      const comparableCount = comparableQuestions.length;
      const matchedCount = comparableCount - significantCount;
      const hasComparison = comparableCount > 0;
      const overallWhoScoresHigher = this.overallWhoScoresHigherFor_(questionRows);

      results.push({
        division: division,
        department: department,
        managerAnswered: managerAnswered,
        teamSize: teamRows.length,
        questions: questionRows,
        hasComparison: hasComparison,
        comparableCount: comparableCount,
        matchedCount: matchedCount,
        significantCount: significantCount,
        overallWhoScoresHigher: overallWhoScoresHigher
      });

    });

    // Сохраняем исходный порядок отделов (см. departmentOrder.sort выше —
    // уже устоявшийся порядок текущего отчета) до финальной сортировки —
    // нужен как тай-брейк при равном числе существенных расхождений.
    results.forEach((department, i) => { department.originalIndex = i; });

    // Сортировка отделов — по количеству существенных расхождений, от
    // большего к меньшему; отделы без существенных расхождений — после
    // отделов с расхождениями; отделы, для которых сравнение вообще
    // невозможно (ошибка "несколько руководителей" или ни одной темы со
    // статусом OK), — в самом конце, отдельно от "0 расхождений".
    results.sort((a, b) => this.compareDepartmentsBySignificance_(a, b));

    return results;

  },

  /**
   * Стабильный компаратор тем внутри отдела — по |diff| от большего к
   * меньшему, темы без числового diff уходят в конец, между собой
   * сохраняя originalIndex (порядок анкеты).
   */
  compareQuestionsByAbsDiff_(a, b) {

    const aNull = a.diff === null;
    const bNull = b.diff === null;

    if (aNull !== bNull) return aNull ? 1 : -1;

    if (!aNull) {
      const av = Math.abs(a.diff);
      const bv = Math.abs(b.diff);
      if (av !== bv) return bv - av;
    }

    return a.originalIndex - b.originalIndex;

  },

  /**
   * Стабильный компаратор отделов — по significantCount от большего к
   * меньшему среди отделов с hasComparison, отделы без сравнения — в
   * конце; между собой равные по significantCount/hasComparison отделы
   * сохраняют originalIndex (текущий порядок отчета).
   */
  compareDepartmentsBySignificance_(a, b) {

    const aHas = !a.error && a.hasComparison;
    const bHas = !b.error && b.hasComparison;

    if (aHas !== bHas) return aHas ? -1 : 1;

    if (aHas && a.significantCount !== b.significantCount) {
      return b.significantCount - a.significantCount;
    }

    return a.originalIndex - b.originalIndex;

  },

  /**
   * "Руководитель" — числовая оценка руководителя выше; "Команда" —
   * выше команда; "Оценки совпадают" — разницы нет; пусто — числовое
   * сравнение невозможно (см. STATUS для причины — она уже отражена в
   * колонке "Статус"/"Статус надёжности").
   */
  whoScoresHigherFor_(diff) {
    if (diff === null || diff === undefined) return "";
    if (diff > 0) return this.WHO_HIGHER.MANAGER;
    if (diff < 0) return this.WHO_HIGHER.TEAM;
    return this.WHO_HIGHER.EQUAL;
  },

  /**
   * Итоговое резюме по отделу для колонки "Кто в целом оценивает выше" —
   * средняя оценка руководителя против средней оценки команды, только по
   * темам, где присутствуют обе оценки (managerLevel и teamLevel не
   * null — отсутствующие оценки не участвуют в среднем и не заменяются
   * нулем). Порог существенности — тот же SMALL_DIFF, что и в
   * interpretationFor_ (не новая методика).
   *
   * @param {Array<Object>} questionRows - questionRows из build() (до
   *   сортировки/после — не важно, функция не смотрит на порядок)
   * @returns {String} одно из OVERALL_WHO_HIGHER
   */
  overallWhoScoresHigherFor_(questionRows) {

    const comparable = questionRows.filter(row => row.managerLevel !== null && row.teamLevel !== null);

    if (comparable.length === 0) return this.OVERALL_WHO_HIGHER.INSUFFICIENT;

    const avgManager = comparable.reduce((sum, row) => sum + row.managerLevel, 0) / comparable.length;
    const avgTeam = comparable.reduce((sum, row) => sum + row.teamLevel, 0) / comparable.length;
    const diff = avgManager - avgTeam;

    if (Math.abs(diff) <= this.INTERPRETATION_THRESHOLDS.SMALL_DIFF) return this.OVERALL_WHO_HIGHER.EQUAL;

    return diff > 0 ? this.OVERALL_WHO_HIGHER.MANAGER : this.OVERALL_WHO_HIGHER.TEAM;

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

  /**
   * Статус надежности по n команды, ответившей на конкретный вопрос —
   * вызывается только когда руководитель сам ответил на этот вопрос
   * (иначе действуют MANAGER_DID_NOT_ANSWER/MANAGER_SKIPPED_QUESTION,
   * см. build). Команда не отсекается ни при каком n — статус только
   * маркирует надежность уже посчитанной средней/разницы.
   *
   * STATUS.OK — фиксированная метка (downstream-код сравнивает с ней
   * напрямую, см. interpretationFor_/priorityFor_/comparableQuestions),
   * "достаточно данных" при n>=MIN_TEAM_SIZE ИЛИ доле команды
   * >=TEAM_COVERAGE_OK_RATIO. Иначе — не общая фраза "мало данных", а
   * обе цифры: "ответили N из M" (M — team.length, вся команда,
   * ответившая на опрос вообще, не только на этот вопрос).
   *
   * @param {Number} teamN - ответивших на ЭТОТ вопрос
   * @param {Number} teamSize - вся команда (teamRows.length)
   */
  reliabilityStatusFor_(teamN, teamSize) {

    if (teamN === 0) return this.STATUS.NO_TEAM_ANSWERS;

    const ratio = teamSize > 0 ? teamN / teamSize : 0;

    if (teamN >= this.MIN_TEAM_SIZE || ratio >= this.TEAM_COVERAGE_OK_RATIO) return this.STATUS.OK;

    return "ответили " + teamN + " из " + teamSize;

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
    "нет ответов команды": "#d9d9d9"
  },

  // "Ответили N из M" (см. reliabilityStatusFor_) — не в
  // STATUS_COLORS_ (фиксированный словарь по точной строке не подходит
  // для строки с переменными числами), поэтому проверяется отдельным
  // префиксом.
  PARTIAL_TEAM_STATUS_PREFIX_: "ответили ",
  PARTIAL_TEAM_STATUS_COLOR_: "#ffe699",

  statusColor_(status) {
    if (this.STATUS_COLORS_.hasOwnProperty(status)) return this.STATUS_COLORS_[status];
    if (typeof status === "string" && status.indexOf(this.PARTIAL_TEAM_STATUS_PREFIX_) === 0) {
      return this.PARTIAL_TEAM_STATUS_COLOR_;
    }
    return null;
  },

  // Заливка ячейки "Статус" итоговой строки отдела — переиспользует ту
  // же цветовую логику проекта, что и Norms.COLORS (зеленый "отлично",
  // красный "критично"), плюс существующий серый "нет данных" (см.
  // STATUS_COLORS_.NO_TEAM_ANSWERS выше) — новой палитры не вводится.
  SUMMARY_STATUS_COLORS_: {
    "Оценки близки": "#c6efce",
    "Есть расхождения": "#ffc7ce",
    "Недостаточно данных для сравнения": "#d9d9d9"
  },

  /**
   * Общий статус сравнения руководителя и команды для итоговой строки
   * отдела — производный ярлык поверх уже посчитанных significantCount/
   * hasComparison, без новой методики: hasComparison=false — сравнение
   * невозможно (это НЕ то же самое, что significantCount=0).
   */
  overallStatusFor_(hasComparison, significantCount) {
    if (!hasComparison) return this.SUMMARY_STATUS.INSUFFICIENT;
    if (significantCount === 0) return this.SUMMARY_STATUS.CLOSE;
    return this.SUMMARY_STATUS.DISCREPANCIES;
  },

  /**
   * Цвет ячейки "Статус" — работает как для итоговых строк отдела
   * (SUMMARY_STATUS_COLORS_), так и для строк детализации по темам
   * (STATUS_COLORS_/statusColor_) — один и тот же физический столбец
   * листа переиспользуется для обоих типов строк (см. write()).
   */
  rowStatusColor_(status) {
    if (this.SUMMARY_STATUS_COLORS_.hasOwnProperty(status)) return this.SUMMARY_STATUS_COLORS_[status];
    return this.statusColor_(status);
  },

  /**
   * Русское склонение "N расхождение/расхождения/расхождений" — только
   * форматирование текста итоговой строки, само число (significantCount)
   * не меняется этой функцией.
   */
  discrepancyLabel_(count) {

    const mod10 = count % 10;
    const mod100 = count % 100;

    let word;

    if (mod10 === 1 && mod100 !== 11) {
      word = "расхождение";
    } else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
      word = "расхождения";
    } else {
      word = "расхождений";
    }

    return count + " " + word;

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
  /**
   * Лист "Руководитель и команда" удаляется и пересоздается на том же
   * месте целиком, а не очищается на месте — sheet.clear() (см.
   * AnalyticsWriter.sheet_) не удаляет группировку строк, и повторное
   * формирование отчета накапливало бы вложенные группы отделов (см.
   * тот же прием и его обоснование в ReportBuilder.createReport).
   */
  sheet_() {

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const existing = spreadsheet.getSheetByName(this.SHEET_NAME);

    if (existing) {
      const existingIndex = existing.getIndex() - 1; // getIndex() 1-based, insertSheet(index) 0-based
      spreadsheet.deleteSheet(existing);
      return spreadsheet.insertSheet(this.SHEET_NAME, existingIndex);
    }

    return spreadsheet.insertSheet(this.SHEET_NAME);

  },

  /**
   * Двумерный массив строк для записи на лист — по одной итоговой
   * строке на отдел (summaryRowNumbers содержит ее номер на листе) и,
   * сразу под ней, по одной строке на каждую тему отдела (для группировки
   * — см. write()). Отделы уже отсортированы (build()), темы внутри
   * отдела тоже — здесь только раскладка в плоский массив колонок,
   * без пересчета данных.
   *
   * @param {Array<Object>} results - build()
   * @param {Number} startRow - строка листа, где начинается таблица
   *   (строка заголовка колонок; данные начинаются со startRow + 1)
   * @returns {{rows: Array<Array>, summaryRowNumbers: Array<Number>,
   *   groupRanges: Array<{startRow: Number, numRows: Number}>,
   *   notes: Array<{row: Number, text: String}>}}
   */
  buildSheetRows_(results, startRow) {

    const rows = [];
    const summaryRowNumbers = [];
    const groupRanges = [];
    const notes = [];

    results.forEach(department => {

      const summaryRowNumber = startRow + 1 + rows.length;
      summaryRowNumbers.push(summaryRowNumber);

      if (department.error) {

        rows.push([department.department, department.error, "", "", "", "", ""]);
        notes.push({
          row: summaryRowNumber,
          text: 'Несколько отмеченных руководителей в справочнике "перформанс": ' + department.managerNames.join(", ")
        });
        return;

      }

      const overallStatus = this.overallStatusFor_(department.hasComparison, department.significantCount);

      rows.push([
        department.department,
        overallStatus,
        department.hasComparison ? ("Совпало " + department.matchedCount + " из " + department.comparableCount) : "",
        department.hasComparison ? this.discrepancyLabel_(department.significantCount) : "",
        "",
        department.overallWhoScoresHigher,
        department.teamSize
      ]);

      if (department.questions.length > 0) {

        const detailStartRow = startRow + 1 + rows.length;

        department.questions.forEach(row => {

          // managerLevel может быть null даже при непустом managerText —
          // "затрудняюсь ответить"/нераспознанный вариант текст показывают,
          // но числовую оценку по требованию задачи не считают (см. build).
          const managerCell = row.managerText
            ? (row.managerLevel !== null ? row.managerText + " (" + row.managerLevel + ")" : row.managerText)
            : "";
          const teamCell = row.teamText ? row.teamText + " (" + row.teamLevel + ")" : "";

          rows.push([
            row.question,
            row.status,
            managerCell,
            teamCell,
            row.diff !== null ? Math.abs(row.diff) : "",
            row.whoScoresHigher,
            row.teamN
          ]);

        });

        groupRanges.push({ startRow: detailStartRow, numRows: department.questions.length });

      }

    });

    return { rows: rows, summaryRowNumbers: summaryRowNumbers, groupRanges: groupRanges, notes: notes };

  },

  /**
   * Записать лист "Руководитель и команда". Строится по 2026 — отдел
   * берется из ответа респондента, руководитель — из справочника
   * "перформанс" (см. build). Отделы без отмеченного руководителя не
   * попадают на лист вообще; отделы с несколькими отмеченными
   * руководителями попадают как ошибка без анализа (см. STATUS.MULTIPLE_MANAGERS).
   *
   * Свернутый список: одна итоговая строка на отдел (см.
   * buildSheetRows_), под ней — сворачиваемая стандартной группировкой
   * Google Sheets группа строк с темами этого отдела. Отделы уже
   * отсортированы build() по числу существенных расхождений, темы
   * внутри отдела — по модулю расхождения; здесь порядок только
   * записывается на лист, не пересчитывается.
   */
  write() {

    const prepared = this.prepare_();
    const results = this.build(
      prepared.headers,
      prepared.data,
      prepared.directory,
      department => Headcount.divisionOf("2026", department)
    );

    const sheet = this.sheet_();

    const numCols = 7;

    const introStartRow = Formatter.writeSheetIntro(sheet,
      "Как результат руководителя соотносится с его командой",
      'Один руководитель — это конкретный человек, а не статистическая группа: для него не считается ни значимость, ни доверительный интервал, и он не попадает в "Отклонения срезов"/"Выводы". Средняя оценка и разница считаются при любом числе ответивших сотрудников (n ≥ 1) — маленькие команды не исключаются, но помечаются статусом надежности (n=0 — нет ответов команды; n≥' +
        this.MIN_TEAM_SIZE + ' ИЛИ доля ответивших от всей команды ≥' + Math.round(this.TEAM_COVERAGE_OK_RATIO * 100) +
        '% — достаточно данных; иначе статус называет обе цифры, например "ответили 4 из 40", а не абстрактное "мало данных" — 4 из 5 человек команды это полноценный результат, а 4 из 40 нет, хотя n одинаковое). Результаты со статусом "ответили N из M" — ориентировочное сравнение, а не устойчивый статистический вывод, и не участвуют в автоматических выводах/значимости (см. колонку "Статус"). ВАЖНО: при n=1 средняя оценка команды фактически раскрывает ответ одного конкретного сотрудника — доступ к этому листу должен быть ограничен так же, как к персональным данным. ФИО не выводится нигде на этом листе. Отделы без отмеченного в справочнике "перформанс" руководителя на этот лист не попадают. Каждый отдел свернут в одну итоговую строку — детализация по темам раскрывается нажатием "+" слева от строки отдела (стандартная группировка строк Google Sheets), отделы отсортированы по убыванию числа существенных расхождений.',
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

    // Один общий заголовок колонок на весь лист — строки детализации
    // используют те же колонки, что и итоговая строка отдела (см.
    // buildSheetRows_): для итоговой строки "Руководитель"/"Команда"
    // содержат "Совпало X из Y"/"N расхождений", для строки темы —
    // фактические оценку руководителя/команды по этой теме.
    const header = ["Отдел / Тема", "Статус", "Руководитель", "Команда", "Расхождение", "Кто в целом оценивает выше", "n команды"];

    const built = this.buildSheetRows_(results, startRow);

    AnalyticsWriter.dump_(sheet, header, built.rows,
      [260, 220, 230, 230, 110, 170, 90], startRow, [
        [0, "Итоговая строка — название отдела (свернуто по умолчанию, раскрыть — «+» слева). Строка темы — конкретный вопрос анкеты."],
        [1, "Итоговая строка — общий статус отдела: «" + this.SUMMARY_STATUS.CLOSE + "», «" + this.SUMMARY_STATUS.DISCREPANCIES +
          "» или «" + this.SUMMARY_STATUS.INSUFFICIENT + "» (сравнение невозможно — это не то же самое, что «0 расхождений»). Строка темы — статус надежности этой темы, см. подсказку колонки \"Кто в целом оценивает выше\" ниже."],
        [2, "Итоговая строка — «Совпало X из Y»: X тем без существенного расхождения из Y тем с полностью надежным сравнением (статус «" +
          this.STATUS.OK + "»). Строка темы — ближайший текстовый вариант ответа руководителя и Уровень 0-100 в скобках."],
        [3, "Итоговая строка — количество тем с существенным расхождением. Строка темы — ближайшая текстовая категория среднего ответа команды и Уровень 0-100 в скобках."],
        [4, "Строка темы — модуль разницы (|Оценка руководителя − Средняя оценка команды|) на шкале 0-100; направление — в колонке \"Кто в целом оценивает выше\"."],
        [5, "Итоговая строка — сравнение средней оценки руководителя со средней оценкой команды по темам, где присутствуют обе оценки (отсутствующие оценки не учитываются и не приравниваются к нулю): «" +
          this.OVERALL_WHO_HIGHER.MANAGER + "», «" + this.OVERALL_WHO_HIGHER.TEAM + "», «" + this.OVERALL_WHO_HIGHER.EQUAL +
          "» (расхождение в пределах ±" + this.INTERPRETATION_THRESHOLDS.SMALL_DIFF + " на шкале 0-100) или «" + this.OVERALL_WHO_HIGHER.INSUFFICIENT +
          "» (нет ни одной темы с обеими оценками). Строка темы — «" + this.WHO_HIGHER.MANAGER + "»/«" +
          this.WHO_HIGHER.TEAM + "»/«" + this.WHO_HIGHER.EQUAL + "» — у кого выше числовая оценка по этой теме; пусто, если числовое сравнение невозможно (см. статус в колонке \"Статус\": «" +
          this.STATUS.MANAGER_DID_NOT_ANSWER + "», «" + this.STATUS.MANAGER_SKIPPED_QUESTION + "», «" + this.STATUS.MANAGER_UNCERTAIN +
          "», «" + this.STATUS.MANAGER_NOT_USED + "», «" + this.STATUS.MANAGER_UNRECOGNIZED + "» или «" + this.STATUS.NO_TEAM_ANSWERS + "»)."],
        [6, "Итоговая строка — размер команды отдела. Строка темы — сколько сотрудников ответили именно на эту тему (n может быть меньше размера команды)."]
      ]);

    // Пакетное форматирование: один массив цветов на весь диапазон и
    // один вызов setBackgrounds — вместо getRange().setBackground()
    // построчно в цикле. Один и тот же столбец "Статус" переиспользуется
    // и итоговой строкой отдела (см. SUMMARY_STATUS_COLORS_), и строкой
    // темы (см. STATUS_COLORS_) — rowStatusColor_ различает их сама.
    if (built.rows.length) {
      const backgrounds = built.rows.map(row => [this.rowStatusColor_(row[1])]);
      sheet.getRange(startRow + 1, 2, built.rows.length, 1).setBackgrounds(backgrounds);
    }

    // Итоговые строки отделов — полужирный шрифт и легкая нейтральная
    // заливка (см. Formatter.STRIPE_BG — тот же цвет, что и в остальных
    // отчетах проекта, новая палитра не вводится), одним вызовом через
    // getRangeList вместо построчного форматирования.
    if (built.summaryRowNumbers.length) {
      const summaryA1 = built.summaryRowNumbers.map(row => "A" + row + ":G" + row);
      sheet.getRangeList(summaryA1)
        .setFontWeight("bold")
        .setBackground(Formatter.STRIPE_BG)
        .setBorder(false, false, true, false, false, false, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
    }

    built.notes.forEach(note => {
      sheet.getRange(note.row, 1).setNote(note.text);
    });

    // Toggle "+/-" должен относиться к строке отдела (стоять на ней),
    // а не появляться после последней темы — иначе визуально неясно, к
    // какому отделу относится раскрытие (см. требование задачи).
    sheet.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);

    // Группировка создается уже после того, как все строки записаны и
    // отсортированы (см. buildSheetRows_) — каждый диапазон строго внутри
    // одного отдела (groupRanges), итоговая строка отдела в диапазон не
    // входит. Лист каждый раз пересоздается заново (см. sheet_()), поэтому
    // здесь не может накопиться вложенная/задвоенная группировка с
    // прошлого формирования отчета.
    built.groupRanges.forEach(range => {
      Formatter.groupRows(sheet, range.startRow, range.numRows, true);
    });

    sheet.setHiddenGridlines(true);

  }

};
