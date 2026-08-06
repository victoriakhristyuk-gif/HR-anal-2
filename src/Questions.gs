/**
 * ==========================================================
 * Работа с вопросами анкеты
 * ==========================================================
 */

const Questions = {

  catalogue: [
    { column: "A", title: "Фамилия Имя", type: "text", group: "Служебные", subgroup: "ФИО", report: false, filter: false, average: false, display: "❌", compare: false, answers: "❌" },
    { column: "B", title: "Город", type: "single", group: "Профиль", subgroup: "Город", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "Азнакаево\nАстана\nАстана/Караганда\nБарнаул\nБратск\nБрянск\nВладимир\nВолгоград\nВологда\nВоронеж\nГурьевск\nДушанбе\nЕкатеринбург\nИваново\nИркутск\nКазань\nКалининград\nКалуга\nКраснодар\nКурган\nЛенинградская область\nМинск\nМосква\nМосква/Сочи\nМосковская область\nМуром\nНабережные Челны\nНижний Новгород\nОмутнинск\nПенза\nПермь\nПетропавловск\nПодгорица\nПодольск\nПятигорск\nРостов-на-Дону\nСанкт-Петербург\nСаров\nСергиев Посад\nСевастополь\nСимферополь\nСтепное Озеро\nСунжа\nТамбов\nТомск\nТольятти\nТула\nТверь\nТюмень\nУфа\nУссурийск\nХабаровск\nЧебоксары\nЧелябинск\nЧерняховск\nЯрославль" },
    { column: "C", title: "Отдел", type: "single", group: "Профиль", subgroup: "Отдел", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "HR-отдел\nPR-отдел\nАдминистрация IT\nОтдел аналитики и управления данными\nОтдел автоматизации операционной деятельности\nОтдел бизнес-анализа\nОтдел внедрения и обслуживания учетных систем\nОтдел информационной безопасности инфраструктуры\nОтдел локализации и перевода\nОтдел обслуживания платежных систем\nОтдел обучения\nОтдел поддержки и управления сервисами IP-телефонии\nОтдел поддержки прикладного программного обеспечения\nОтдел программируемых микроконтроллеров\nОтдел промышленной автоматизации\nОтдел проектирования и дизайна интерфейсов\nОтдел разработки биллинг сервисов\nОтдел разработки водительских сервисов\nОтдел разработки гео сервисов\nОтдел разработки интегрированных систем\nОтдел разработки инфраструктурных сервисов\nОтдел разработки клиентских сервисов\nОтдел разработки мобильного ПО\nОтдел разработки сервисов заказа\nОтдел разработки сайтов\nОтдел разработки технической документации\nОтдел развития продуктов\nОтдел связи\nОтдел серверных решений и СХД\nОтдел сетевых технологий\nОтдел системного администрирования\nОтдел системного анализа\nОтдел технической поддержки\nОтдел тестирования ПО\nОтдел управления процессами\nОтдел эксплуатации сети" },
    // "Управление" — не колонка анкеты: значение вычисляется из "Отдел"
    // через справочник численности (см. Headcount.gs). report:false и
    // display:"❌", потому что для него нет собственных ответов анкеты,
    // которые можно свести в таблицу распределения — как срез он
    // участвует через отдельный список dimensions в AnalyticsService.
    { column: null, title: "Управление", type: "single", group: "Профиль", subgroup: "Управление", report: false, filter: true, average: false, display: "❌", compare: false, answers: "Управление разработки ПО\nИТ-управление\nНе отнесено к управлению" },
    // "Группа команд" — тоже не колонка анкеты: значение — сочетание
    // "Управление + Тип команды" отдела (см. Headcount.teamGroupOf), не
    // просто "Тип команды" — одинаковое название типа команды в разных
    // управлениях не должно объединяться в одну группу. Поле в листе
    // "Численность" необязательное, поэтому вариантов заранее не
    // фиксируем (answers: "") — они читаются динамически из справочника
    // для выбранного года (см. Filters.getValueOptions, Headcount.listTeamGroups).
    { column: null, title: "Группа команд", type: "single", group: "Профиль", subgroup: "Группа команд", report: false, filter: true, average: false, display: "❌", compare: false, answers: "" },
    { column: "D", title: "Стаж", type: "single", group: "Профиль", subgroup: "Стаж", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "менее 3х месяцев; от 3х месяцев до 1 года; от 1 года до 3х лет; от 3х до 6 лет; от 6 до 10 лет; более 10 лет" },
    { column: "E", title: "Формат работы", type: "single", group: "Профиль", subgroup: "Формат", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "полностью удаленно; полностью из офиса; в гибридном (удаленка/офис)" },
    { column: "F", title: "Рабочий стол", type: "rating5", group: "Офис", subgroup: "Рабочее место", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "G", title: "Рабочее кресло", type: "rating5", group: "Офис", subgroup: "Рабочее место", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "H", title: "Расположение рабочего места", type: "rating5", group: "Офис", subgroup: "Рабочее место", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "I", title: "Офисное пространство", type: "rating5", group: "Офис", subgroup: "Рабочее место", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "J", title: "Отдых в офисе", type: "rating5", group: "Офис", subgroup: "Комфорт", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "K", title: "Переговорки", type: "rating5", group: "Офис", subgroup: "Инфраструктура", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "L", title: "Питание и возможность перекусить, выпить чай, кофе", type: "rating5", group: "Офис", subgroup: "Инфраструктура", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "M", title: "Атмосфера в офисе", type: "rating5", group: "Офис", subgroup: "Атмосфера", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "N", title: "Рабочая техника", type: "rating5", group: "Офис", subgroup: "Оснащение", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "O", title: "Корпоративы", type: "rating5", group: "Льготы", subgroup: "Активности", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "P", title: "Обучение", type: "rating5", group: "Льготы", subgroup: "Развитие", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "Q", title: "Курсы английского", type: "rating5", group: "Льготы", subgroup: "Развитие", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "R", title: "ДМС", type: "rating5", group: "Льготы", subgroup: "Бенефиты", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "S", title: "Мерч за достижения", type: "rating5", group: "Льготы", subgroup: "Бенефиты", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5, не пользовался" },
    { column: "T", title: "Work-life balance", dataTitle: "График", type: "scale4", group: "Работа", subgroup: "Условия", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "U", title: "Задачи", type: "scale4", group: "Работа", subgroup: "Работа", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "V", title: "Ожидания", type: "scale4", group: "Работа", subgroup: "Работа", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "W", title: "Проф мнение", type: "scale4", group: "Работа", subgroup: "Развитие", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "X", title: "Возможности роста", type: "scale4", group: "Работа", subgroup: "Карьера", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "Y", title: "ОС от руководителя", type: "scale4", group: "Руководитель", subgroup: "Обратная связь", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "Z", title: "Удовлетворенность рабочими задачами", dataTitle: "Задачи 2", type: "rating5", group: "Работа", subgroup: "Нагрузка", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5" },
    { column: "AA", title: "ЗП", type: "rating5", group: "Вознаграждение", subgroup: "Компенсация", report: true, filter: true, average: true, display: "Распределение", compare: true, answers: "1, 2, 3, 4, 5" },
    { column: "AB", title: "Выгорание", type: "scale5", group: "Риски", subgroup: "Благополучие", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "совсем не чувствовал; чувствовал редко; чувствовал регулярно; чувствовал постоянно и чувствую сейчас; затрудняюсь ответить" },
    { column: "AC", title: "Смена работы", type: "scale4", group: "Риски", subgroup: "Удержание", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "совсем не задумывался; очень редко, но такие мысли были; задумывался время от времени; постоянно и думаю об этом сейчас" },
    { column: "AD", title: "Ценишь в компании", type: "text", group: "Компания", subgroup: "Сильные стороны", report: true, filter: false, average: false, display: "Топ 5", compare: true, answers: "Сильный бренд компании на рынке труда\nТехнологичность, инновационность компании\nЭффективность и оптимальность рабочих процессов\nДружная команда, комфортная атмосфера\nПрофессионализм и качество работы сотрудников, команды\nПрофессионализм руководства компании\nИнтересные амбициозные задачи и проекты\nВозможность своей работой приносить пользу людям, обществу\nУровень бюрократии в компании\nПерспективы карьерного роста\nВозможности для обучения и профессионального развития\nКомфортные условия работы\nМесторасположение офиса\nОфисное пространство\nСтабильность\nГибкий формат работы\nОклад, пересмотр зарплаты\nБенефиты\nНематериальные поощрения" },
    { column: "AE", title: "Зоны роста компании", type: "text", group: "Компания", subgroup: "Улучшения", report: true, filter: false, average: false, display: "Топ 5", compare: true, answers: "Сильный бренд компании на рынке труда\nТехнологичность, инновационность компании\nЭффективность и оптимальность рабочих процессов\nДружная команда, комфортная атмосфера\nПрофессионализм и качество работы сотрудников, команды\nПрофессионализм руководства компании\nИнтересные амбициозные задачи и проекты\nВозможность своей работой приносить пользу людям, обществу\nУровень бюрократии в компании\nПерспективы карьерного роста\nВозможности для обучения и профессионального развития\nКомфортные условия работы\nМесторасположение офиса\nОфисное пространство\nСтабильность\nГибкий формат работы\nОклад, пересмотр зарплаты\nБенефиты\nНематериальные поощрения" },
    { column: "AF", title: "Ценности", type: "scale4", group: "Компания", subgroup: "Культура", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AG", title: "О жизни компании", type: "scale4", group: "Компания", subgroup: "Коммуникации", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AH", title: "Цели компании", type: "scale4", group: "Компания", subgroup: "Стратегия", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AI", title: "Вклад", type: "scale4", group: "Компания", subgroup: "Причастность", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AJ", title: "Атмосфера в отделе", type: "scale4", group: "Команда", subgroup: "Команда", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AK", title: "Межкомандное взаимодействие", type: "scale4", group: "Команда", subgroup: "Взаимодействие", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AL", title: "Неформальное общение", type: "scale4", group: "Команда", subgroup: "Коммуникации", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AM", title: "Решение споров", type: "scale4", group: "Команда", subgroup: "Конфликты", report: true, filter: true, average: false, display: "Распределение", compare: true, answers: "да; скорее да; скорее нет; нет" },
    { column: "AN", title: "Открытая ОС 1", type: "text", group: "Команда", subgroup: "Комментарий", report: false, filter: false, average: false, display: "❌", compare: false, answers: null },
    { column: "AO", title: "eNPS", type: "enps", group: "Лояльность", subgroup: "eNPS", report: true, filter: true, average: false, display: "eNPS", compare: true, answers: "1, 2, 3 , 4, 5, 6, 7, 8, 9, 10" },
    { column: "AP", title: "Открытая ОС 2", type: "text", group: "Итог", subgroup: "Общий комментарий", report: false, filter: false, average: false, display: "❌", compare: false, answers: null },

    // ---------- Обогащение справочником "перформанс" (только "Ответы 2026", см. PerformanceDirectory.gs) ----------
    // Это не колонки анкеты: значения присоединяются в память при
    // загрузке источника "2026" (см. loadEnrichedSurveyData_).
    // report:false — эти поля не участвуют в кодировании/светофоре/
    // корреляциях (Scoring/AnalyticsService), только в фильтрах и в
    // отдельных срезах "Соответствие ожиданиям"/"Грейд" (AnalyticsService.build).
    // performanceOnly:true — маркер для гейтинга по источнику
    // (Filters.getFilterableQuestions, ReportService "Сравнить с 2025").
    // display:"Топ 5" — значения не фиксированы заранее (в отличие от
    // остальных вопросов каталога, answers:"" — как и "Группа команд"),
    // поэтому распределение считается тем же динамическим подсчетом
    // частот, что и у открытых вопросов (Statistics.calculateAnswerFrequencies/
    // selectTopAnswers), а не по фиксированному Statistics.getDistributionOrder_.
    // Раздел "Состав выборки" (ReportSections.gs) показывает эти два поля,
    // только если в выборке отчета вообще есть теги справочника
    // "перформанс" (см. ReportBuilder.renderQuestionBlock_ — вопрос с
    // performanceOnly пропускается целиком, если items пуст, например
    // для источника "Ответы 2025" или несопоставленной выборки).
    { column: null, title: "Соответствие ожиданиям", type: "single", group: "Перформанс", subgroup: "Перформанс", report: false, filter: true, average: false, display: "Топ 5", compare: false, performanceOnly: true, answers: "" },
    { column: null, title: "Грейд", type: "single", group: "Перформанс", subgroup: "Перформанс", report: false, filter: true, average: false, display: "Топ 5", compare: false, performanceOnly: true, answers: "" },
    { column: null, title: "Роль в отделе", type: "single", group: "Перформанс", subgroup: "Перформанс", report: false, filter: true, average: false, display: "❌", compare: false, performanceOnly: true, answers: "Руководитель отдела; Сотрудник отдела" }
  ],

  /**
   * Все вопросы из карты.
   */
  getAll() {

    return this.catalogue.map(question => this.toQuestion_(question));

  },

  /**
   * Вопросы со средними.
   */
  getAverageQuestions() {

    return this.getAll().filter(question => question.average);

  },

  /**
   * Вопросы для распределения.
   */
  getDistributionQuestions() {

    return this.getAll().filter(question => {
      return question.display === "Распределение";
    });

  },

  /**
   * Вопросы для фильтрации.
   */
  getFilterQuestions() {

    return this.getAll().filter(question => question.filter);

  },

  /**
   * Названия вопросов, доступных только для источника "Ответы 2026"
   * (обогащение справочником "перформанс" — см. PerformanceDirectory.gs).
   * В данных 2025 этих признаков нет.
   */
  getPerformanceOnlyTitles() {

    return this.catalogue.filter(question => question.performanceOnly).map(question => question.title);

  },
  /**
   * Открытые вопросы с топ-5 ответов.
   */
  getTopAnswerQuestions() {

    return this.getAll().filter(question => question.display === "Топ 5");

  },

  /**
   * Привести запись каталога к рабочему виду вопроса:
   * строка "answers" разбирается в массив вариантов ответа
   * (в карте встречаются разделители "," ";" и перенос строки).
   */
  toQuestion_(question) {

    return Object.assign({}, question, {
      answers: this.parseAnswers_(question.answers)
    });

  },

  // Фиксированный порядок вариантов для вопросов с шкалой
  // "Да / Скорее да / Скорее нет / Нет" (см. isYesNoScale) —
  // используется только для распознавания, не для расчетов.
  YES_NO_SCALE_ANSWERS: ["да", "скорее да", "скорее нет", "нет"],

  /**
   * Вопрос со шкалой "Да / Скорее да / Скорее нет / Нет" (в отличие
   * от других scale4-вопросов анкеты, например "Смена работы", у
   * которых те же 4 варианта, но другой текст). Используется отчетом
   * для компактного визуального представления таких вопросов вместо
   * обычной таблицы распределения.
   */
  isYesNoScale(question) {

    if (question.type !== "scale4") {
      return false;
    }

    const normalized = question.answers.map(answer => this.normalizeForComparison_(answer));

    return normalized.length === this.YES_NO_SCALE_ANSWERS.length &&
      normalized.every((answer, index) => answer === this.YES_NO_SCALE_ANSWERS[index]);

  },

  normalizeForComparison_(value) {
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  },

  /**
   * Разбор строки "answers" в массив.
   *
   * В карте встречаются вопросы с разными разделителями вариантов
   * ответа: запятая (шкалы rating5/eNPS — "1, 2, 3, 4, 5"), перенос
   * строки (Город/Отдел) и точка с запятой (остальные, включая scale4/
   * scale5). Если в строке есть хотя бы одна точка с запятой — это и
   * есть выбранный для вопроса разделитель, и запятая внутри текста
   * варианта ответа не разбивает его на части (иначе, например, вариант
   * "очень редко, но такие мысли были" вопроса "Смена работы" ошибочно
   * распадался бы на "очень редко" и "но такие мысли были" — 5 вариантов
   * вместо правильных 4).
   */
  parseAnswers_(rawAnswers) {

    if (!rawAnswers || rawAnswers === "❌") {
      return [];
    }

    const separator = rawAnswers.indexOf(";") !== -1 ? /[;\n]+/ : /[,;\n]+/;

    return rawAnswers
      .split(separator)
      .map(value => value.trim())
      .filter(value => value.length > 0);

  }

};