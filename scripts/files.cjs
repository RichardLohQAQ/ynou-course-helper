// Deliberate allowlist: never package logs, local settings or diagnostic exports.
module.exports = [
  'background.js', 'chapter-alert.js', 'content.js', 'diagnostic-bridge.js',
  'diagnostic-page.js', 'homework-background.js', 'homework-content.js',
  'homework-logic.js', 'homework-model.js', 'logic.js', 'manifest.json',
  'popup.css', 'popup.html', 'popup.js', 'private-config.js', 'ui-window.js'
];
