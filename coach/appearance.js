/* Light, dark, or whatever the device is set to.
 *
 * Loaded in <head>, before the stylesheet paints, so the page never flashes the
 * wrong palette. System is the default, decided 2026-09-16: follow the device
 * unless told otherwise.
 *
 * The palette lives in style.css as CSS variables. Dark is the base; light
 * applies under `[data-theme="light"]`, and under `prefers-color-scheme: light`
 * when no explicit choice has been made. This file only sets or clears that
 * attribute, keeps the browser's theme-color in step, and tells the app when to
 * redraw its canvases, which cannot read CSS variables by themselves.
 *
 * Identical in LIFT web and Coach web. The storage key comes from the script
 * tag's data-key, so each app keeps its own setting.
 */
(function (global) {
  'use strict';

  var script = document.currentScript;
  var KEY = (script && script.getAttribute('data-key')) || 'appearance';
  var CHOICES = ['system', 'light', 'dark'];
  var listeners = [];
  var media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function get() {
    try {
      var stored = global.localStorage.getItem(KEY);
      return CHOICES.indexOf(stored) === -1 ? 'system' : stored;
    } catch (e) {
      return 'system';
    }
  }

  /** 'light' or 'dark' -- what is actually being drawn. */
  function resolved() {
    var choice = get();
    if (choice !== 'system') return choice;
    return media && !media.matches ? 'light' : 'dark';
  }

  function apply() {
    var root = document.documentElement;
    var choice = get();
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved() === 'light' ? '#f4efe7' : '#1c1b19');
  }

  function notify() {
    apply();
    listeners.forEach(function (fn) { try { fn(resolved()); } catch (e) { /* one listener must not stop the rest */ } });
  }

  function set(choice) {
    if (CHOICES.indexOf(choice) === -1) return;
    try { global.localStorage.setItem(KEY, choice); } catch (e) { /* private mode: applies for this visit */ }
    notify();
  }

  if (media) {
    var onSystem = function () { if (get() === 'system') notify(); };
    if (media.addEventListener) media.addEventListener('change', onSystem);
    else if (media.addListener) media.addListener(onSystem);
  }

  /** A CSS colour for canvas: resolves `var(--name)` against the live palette. */
  function cssColor(value) {
    var m = /^var\((--[\w-]+)\)$/.exec(value || '');
    if (!m) return value;
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || value;
  }

  apply();

  global.LiftAppearance = {
    CHOICES: CHOICES,
    get: get,
    set: set,
    resolved: resolved,
    cssColor: cssColor,
    onChange: function (fn) { listeners.push(fn); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
