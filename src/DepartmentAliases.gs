/**
 * ==========================================================
 * Справочник оргструктуры: алиасы названий отделов
 * ==========================================================
 *
 * ЗАЧЕМ. К 2026 году несколько отделов были переименованы (и один
 * вариант ответа 2025 года содержал опечатку) — реальные орг.
 * изменения, не ошибка загрузки данных. Сырые листы 2025 и 2026 годов
 * хранят название отдела, действовавшее в момент опроса, поэтому одно
 * и то же подразделение в разных годах может называться по-разному.
 *
 * ПРАВИЛО. department_id стабилен и не меняется при переименовании;
 * название — атрибут периода. canonicalName — название в последнем
 * известном периоде (2026 год); aliases — прежние названия с периодом
 * действия.
 *
 * id — внутренний стабильный ключ, сгенерированный из канонического
 * названия, а не код из внешней HR-системы: реального справочника
 * оргструктуры с кодами в проекте нет (только плоский список названий
 * в Questions.gs). Появится настоящий справочник с кодами — id
 * заменяется на реальный код без изменения интерфейса модуля.
 *
 * ОГРАНИЧЕНИЕ. Слияние отделов (несколько старых названий → одно
 * новое) поддерживается тривиально — это естественное свойство
 * словаря aliases. Разделение отдела (одно старое название → два
 * новых) простым алиасом НЕ решается: неизвестно, к какому из новых
 * отделов отнести конкретную строку без дополнительных данных
 * (например, привязки по сотруднику). Такой конфликт в реестре
 * обнаруживается validateRegistry_() и приводит к явной ошибке —
 * вместо того чтобы молча выбрать один из вариантов.
 *
 * Источник данных реестра: перенесено без изменений из прежней
 * Comparison.DEPARTMENT_NAME_MAP_2025_TO_2026_.
 */

const DepartmentAliases = {

  REGISTRY_: [
    {
      id: "dept_network_technologies",
      canonicalName: "Отдел сетевых технологий",
      aliases: [
        { name: "Отдел сетевого администрирования", validUntil: "2025" }
      ]
    },
    {
      id: "dept_localization",
      canonicalName: "Отдел локализации и перевода",
      aliases: [
        { name: "Отдел локализации", validUntil: "2025" }
      ]
    },
    {
      id: "dept_microcontrollers",
      canonicalName: "Отдел программируемых микроконтроллеров",
      aliases: [
        // Опечатка в данных 2025 года ("микрокотроллеров"), не новое
        // название — обрабатывается тем же механизмом алиаса.
        { name: "Отдел программируемых микрокотроллеров", validUntil: "2025" }
      ]
    }
  ],

  validated_: false,

  /**
   * Разрешить сырое название отдела в каноническое.
   *
   * @param {String} rawName
   * @returns {{id: ?String, canonicalName: String, matchedAlias: Boolean, unknown: Boolean, raw: String}}
   */
  resolve(rawName) {

    this.ensureValidated_();

    const normalized = Statistics.normalize_(rawName);

    const byCanonical = this.REGISTRY_.find(
      entry => Statistics.normalize_(entry.canonicalName) === normalized
    );

    if (byCanonical) {
      return {
        id: byCanonical.id,
        canonicalName: byCanonical.canonicalName,
        matchedAlias: false,
        unknown: false,
        raw: rawName
      };
    }

    const byAlias = this.REGISTRY_.find(entry =>
      entry.aliases.some(alias => Statistics.normalize_(alias.name) === normalized)
    );

    if (byAlias) {
      return {
        id: byAlias.id,
        canonicalName: byAlias.canonicalName,
        matchedAlias: true,
        unknown: false,
        raw: rawName
      };
    }

    // Неизвестный алиас: может быть новый отдел, не опечатка — данные
    // не отбрасываются и не подменяются, только помечаются.
    console.warn("DepartmentAliases: неизвестное название отдела «" + rawName + "»");

    return {
      id: null,
      canonicalName: rawName,
      matchedAlias: false,
      unknown: true,
      raw: rawName
    };

  },

  /**
   * Каноническое название отдела (без остальных полей resolve()) —
   * для точечной подстановки в фильтр/срез.
   */
  canonicalize(rawName) {
    return this.resolve(rawName).canonicalName;
  },

  /**
   * Прежние названия (alias-имена) для канонического названия отдела —
   * основа примечания о переименовании в отчете. Пусто, если у отдела
   * нет известных алиасов.
   */
  getAliasesFor(canonicalName) {

    this.ensureValidated_();

    const normalized = Statistics.normalize_(canonicalName);
    const entry = this.REGISTRY_.find(
      e => Statistics.normalize_(e.canonicalName) === normalized
    );

    return entry ? entry.aliases.map(alias => alias.name) : [];

  },

  ensureValidated_() {
    if (!this.validated_) {
      this.validateRegistry_(this.REGISTRY_);
      this.validated_ = true;
    }
  },

  /**
   * Проверка целостности реестра. Бросает Error, если одно и то же имя
   * (каноническое или alias) заявлено более чем одной записью — это
   * признак разделения отдела (split), которое не выражается простым
   * алиасом и требует отдельного правила (см. комментарий вверху
   * файла), а не тихого выбора одного из вариантов.
   *
   * Принимает реестр параметром (а не только читает REGISTRY_), чтобы
   * тесты могли прогнать проверку на синтетическом реестре без подмены
   * состояния модуля.
   */
  validateRegistry_(registry) {

    const owners = {};

    const claim = (name, ownerId) => {

      const key = Statistics.normalize_(name);
      const existingOwner = owners[key];

      if (existingOwner && existingOwner !== ownerId) {
        throw new Error(
          "DepartmentAliases: конфликт в справочнике — название «" + name +
          "» одновременно заявлено отделами «" + existingOwner + "» и «" + ownerId +
          "». Похоже на разделение отдела (split), которое не решается простым " +
          "алиасом и требует отдельного правила."
        );
      }

      owners[key] = ownerId;

    };

    registry.forEach(entry => {
      claim(entry.canonicalName, entry.id);
      entry.aliases.forEach(alias => claim(alias.name, entry.id));
    });

  }

};
