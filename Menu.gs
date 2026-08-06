function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HR Analytics')
    .addItem('Создать отчет', 'showSidebar')
    .addToUi();
}
