/**
 * ==========================================================
 * Ручные тесты DepartmentAliases (HR-009)
 * ==========================================================
 *
 * В проекте нет тестового фреймворка/раннера — запускать вручную из
 * редактора Apps Script: testDepartmentAliases_runAll() печатает
 * PASS/FAIL по каждому кейсу и бросает Error, если хоть один упал.
 *
 * Покрывает критерий приемки HR-009: переименование, слияние,
 * разделение, неизвестный алиас. Синтетические названия
 * ("Тестовый отдел ...") — только для теста, не выдаются за реальные
 * данные и не попадают в DepartmentAliases.REGISTRY_.
 */

function testDepartmentAliases_runAll() {

  const tests = [
    testDepartmentAliases_rename_,
    testDepartmentAliases_filterEngineIntegration_,
    testDepartmentAliases_merge_,
    testDepartmentAliases_split_,
    testDepartmentAliases_unknownAlias_
  ];

  const failures = [];

  tests.forEach(test => {
    try {
      test();
      console.log("PASS: " + test.name);
    } catch (error) {
      failures.push(test.name + ": " + error.message);
      console.error("FAIL: " + test.name + " — " + error.message);
    }
  });

  if (failures.length) {
    throw new Error(failures.length + " тест(ов) упало:\n" + failures.join("\n"));
  }

  console.log("Все тесты DepartmentAliases пройдены.");

}

function assertEquals_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "assertEquals") + ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual));
  }
}

/**
 * 1. Переименование: старое название 2025 года резолвится в
 * каноническое название 2026 года.
 */
function testDepartmentAliases_rename_() {

  const resolved = DepartmentAliases.resolve("Отдел сетевого администрирования");

  assertEquals_(resolved.canonicalName, "Отдел сетевых технологий", "canonicalName");
  assertEquals_(resolved.matchedAlias, true, "matchedAlias");
  assertEquals_(resolved.unknown, false, "unknown");
  assertEquals_(resolved.id, "dept_network_technologies", "id");

}

/**
 * 1b. Интеграция с FilterEngine: фильтр задан текущим (2026) названием
 * отдела, строка — старым (2025) названием. До фикса HR-009 такая
 * строка молча выбрасывалась из выборки 2025 года ДО применения
 * алиаса — это и есть баг из контекста задачи.
 */
function testDepartmentAliases_filterEngineIntegration_() {

  const headers = ["Отдел", "eNPS"];
  const data = [
    ["Отдел сетевого администрирования", "9"],
    ["Отдел продаж", "5"]
  ];

  const filters = [{
    question: "Отдел",
    values: ["Отдел сетевых технологий"]
  }];

  const result = FilterEngine.applyFilters(data, headers, filters);

  assertEquals_(result.length, 1, "количество строк после фильтра");
  assertEquals_(result[0][0], "Отдел сетевого администрирования", "сохранена сырая строка 2025 года");

}

/**
 * 2. Слияние: два разных старых названия резолвятся в один и тот же
 * canonicalName/id — поддерживается словарем без отдельной логики.
 * Проверяется на синтетическом реестре, не на боевом.
 */
function testDepartmentAliases_merge_() {

  const registry = [{
    id: "dept_test_merged",
    canonicalName: "Тестовый объединённый отдел",
    aliases: [
      { name: "Тестовый отдел А", validUntil: "2025" },
      { name: "Тестовый отдел Б", validUntil: "2025" }
    ]
  }];

  // Реестр валиден сам по себе (нет конфликтов).
  DepartmentAliases.validateRegistry_(registry);

  const resolveAgainst = rawName => {
    const normalized = Statistics.normalize_(rawName);
    const entry = registry.find(e =>
      Statistics.normalize_(e.canonicalName) === normalized ||
      e.aliases.some(a => Statistics.normalize_(a.name) === normalized)
    );
    return entry ? entry.id : null;
  };

  assertEquals_(resolveAgainst("Тестовый отдел А"), "dept_test_merged", "alias А → объединенный id");
  assertEquals_(resolveAgainst("Тестовый отдел Б"), "dept_test_merged", "alias Б → тот же id");

}

/**
 * 3. Разделение: одно и то же старое название заявлено алиасом в двух
 * разных записях реестра — validateRegistry_ обязана бросить явную
 * ошибку, а не молча выбрать одну из записей.
 */
function testDepartmentAliases_split_() {

  const conflictingRegistry = [
    {
      id: "dept_test_split_a",
      canonicalName: "Тестовый отдел А (новый)",
      aliases: [{ name: "Тестовый отдел до разделения", validUntil: "2025" }]
    },
    {
      id: "dept_test_split_b",
      canonicalName: "Тестовый отдел Б (новый)",
      aliases: [{ name: "Тестовый отдел до разделения", validUntil: "2025" }]
    }
  ];

  let threw = false;

  try {
    DepartmentAliases.validateRegistry_(conflictingRegistry);
  } catch (error) {
    threw = true;
  }

  if (!threw) {
    throw new Error("validateRegistry_ должна была бросить ошибку на конфликте split, но не бросила");
  }

}

/**
 * 4. Неизвестный алиас: название, отсутствующее и в canonicalName, и в
 * aliases — возвращается как есть, помечается unknown, id === null,
 * исключение не бросается.
 */
function testDepartmentAliases_unknownAlias_() {

  const resolved = DepartmentAliases.resolve("Совсем новый несуществующий отдел");

  assertEquals_(resolved.canonicalName, "Совсем новый несуществующий отдел", "canonicalName не искажен");
  assertEquals_(resolved.unknown, true, "unknown");
  assertEquals_(resolved.id, null, "id");

}
