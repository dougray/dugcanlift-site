/* My equipment: the equipment someone has, which narrows exercise search to
 * what they can actually do. A port of LIFT iOS's `MyEquipment`, rule for rule.
 *
 * Kept as what they do *not* have, so nothing stored is everything owned and
 * an untouched browser hides nothing. Owning everything removes the key rather
 * than storing an empty list.
 *
 * An exercise whose equipment is not listed is never hidden: unknown is not
 * "needs something you lack", and hiding it would be a claim nobody made.
 *
 * Its own localStorage key, `lift.equipmentNotOwned`, and deliberately not in
 * the backup -- like `lift.perSide`, it is a preference about this device's
 * screen, not a record of training, and no other client writes such a section.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'lift.equipmentNotOwned';

  /** Every equipment value in exercises.json, in the order a gym is usually
   *  described. `my-equipment.test.mjs` checks the data has no value missing
   *  from this list. The same twelve, spelled the same way, as LIFT iOS's
   *  exercises.db: the two are the same free-exercise-db. */
  var KINDS = [
    { id: 'barbell', displayName: 'Barbell' },
    { id: 'e-z curl bar', displayName: 'EZ bar' },
    { id: 'dumbbell', displayName: 'Dumbbells' },
    { id: 'kettlebells', displayName: 'Kettlebells' },
    { id: 'cable', displayName: 'Cable' },
    { id: 'machine', displayName: 'Machines' },
    { id: 'bands', displayName: 'Bands' },
    { id: 'medicine ball', displayName: 'Medicine ball' },
    { id: 'exercise ball', displayName: 'Exercise ball' },
    { id: 'foam roll', displayName: 'Foam roller' },
    { id: 'body only', displayName: 'Bodyweight' },
    { id: 'other', displayName: 'Other' },
  ];

  function normalised(equipment) {
    return String(equipment == null ? '' : equipment).trim().toLowerCase();
  }

  function allows(equipment, notOwned) {
    var value = normalised(equipment);
    return value === '' || !notOwned.has(value);
  }

  /** What to show, and how many were left out, so search can say so. */
  function filter(items, notOwned, equipmentOf) {
    if (!notOwned.size) return { shown: items, leftOut: 0 };
    var shown = items.filter(function (item) { return allows(equipmentOf(item), notOwned); });
    return { shown: shown, leftOut: items.length - shown.length };
  }

  /** `storage` is localStorage or anything with its three methods. A value
   *  that does not read as a list of strings is nothing stored. */
  function load(storage) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.filter(function (v) { return typeof v === 'string'; }) : []);
    } catch (e) {
      return new Set();
    }
  }

  /** Owning everything removes the key, rather than storing an empty list. */
  function save(notOwned, storage) {
    if (!notOwned.size) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(Array.from(notOwned).sort()));
  }

  /** The words search uses, iOS's exactly. */
  function leftOutText(leftOut) {
    return leftOut === 1 ? "1 exercise needs equipment you don't have."
      : leftOut + " exercises need equipment you don't have.";
  }

  function rowText(filtering, leftOut) {
    if (!filtering) return 'All equipment';
    return leftOut > 0 ? 'Your equipment · ' + leftOut + ' left out' : 'Your equipment';
  }

  global.LiftEquipment = {
    STORAGE_KEY: STORAGE_KEY,
    KINDS: KINDS,
    normalised: normalised,
    allows: allows,
    filter: filter,
    load: load,
    save: save,
    leftOutText: leftOutText,
    rowText: rowText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
