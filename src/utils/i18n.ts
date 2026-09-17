// i18n.ts
// Translation helpers for the shipped locales (en, zh, ru).
import zh from '@/locales/zh.json';
import en from '@/locales/en.json';
import ru from '@/locales/ru.json';
import { getLanguage } from 'obsidian';

/**
 * Dictionary of all shipped locales.
 */
const locales: Record<string, Record<string, string>> = {
    zh,
    en,
    ru,
};

/**
 * Resolves the current language.
 * Prefers Obsidian's getLanguage(), and falls back to English.
 * @returns Language code ('zh', 'ru' or 'en')
 */
export function getCurrentLang(): string {
    try {
        const obsidianLang = getLanguage();
        if (obsidianLang && obsidianLang.startsWith('zh')) {
            return 'zh';
        }
        if (obsidianLang && obsidianLang.startsWith('ru')) {
            return 'ru';
        }
    } catch (error) {
        console.warn('Failed to read the Obsidian language setting:', error);
    }
    return 'en';
}

/**
 * Resolves a translated string.
 * @param key Translation key
 * @returns The translation, the English fallback, or the key itself
 */
export function t(key: string): string {
    const lang = getCurrentLang();
    return locales[lang]?.[key] || locales['en']?.[key] || key;
}

/**
 * Resolves a translated string and substitutes parameters.
 * @param key Translation key
 * @param params Parameter values
 * @returns The translation with all {param} placeholders replaced
 */
export function tWithParams(key: string, params: Record<string, string | number>): string {
    let text = t(key);
    // Replace parameters in the form {paramName}.
    Object.entries(params).forEach(([paramKey, paramValue]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue));
    });
    return text;
}
