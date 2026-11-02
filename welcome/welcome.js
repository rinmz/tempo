'use strict';

const t = (key) => chrome.i18n.getMessage(key) || '';
document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll('[data-i18n]')) {
  const text = t(el.dataset.i18n);
  if (text) el.textContent = text;
}
document.title = `${t('extShortName')} · ${t('welcomeTitle')}`;
