/**
 * Controllable mock for @/lib/supabase/feature-access.
 *
 * The monthly-cache hook test needs to control readMonthlyCacheRow,
 * triggerMonthlyRecalc, and readCategoryTotals per scenario. This mock
 * replaces the real feature-access module at require time via the
 * require-hook redirect.
 *
 * Pattern: default implementations return safe no-ops; tests override
 * per scenario via __set* seam functions.
 */

let _readMonthlyCacheRow = async (userId, yearMonth) => ({
  status: 'ok',
  data: null,
});

let _readMonthlyCacheRows = async (userId, yearMonths) => ({
  status: 'ok',
  data: [],
});

let _triggerMonthlyRecalc = async (userId, yearMonth) => ({
  status: 'ok',
  data: undefined,
});

let _readCategoryTotals = async (yearMonth, householdId) => ({
  status: 'ok',
  data: [],
});

// --- Seam functions (harness API) ---

exports.__setReadMonthlyCacheRow = function (fn) {
  _readMonthlyCacheRow = fn;
};

exports.__setReadMonthlyCacheRows = function (fn) {
  _readMonthlyCacheRows = fn;
};

exports.__setTriggerMonthlyRecalc = function (fn) {
  _triggerMonthlyRecalc = fn;
};

exports.__setReadCategoryTotals = function (fn) {
  _readCategoryTotals = fn;
};

exports.__reset = function () {
  _readMonthlyCacheRow = async () => ({ status: 'ok', data: null });
  _readMonthlyCacheRows = async () => ({ status: 'ok', data: [] });
  _triggerMonthlyRecalc = async () => ({ status: 'ok', data: undefined });
  _readCategoryTotals = async () => ({ status: 'ok', data: [] });
};

// --- Exported functions (same signatures as the real feature-access) ---

exports.readMonthlyCacheRow = async function readMonthlyCacheRow(
  userId,
  yearMonth,
) {
  return _readMonthlyCacheRow(userId, yearMonth);
};

exports.readMonthlyCacheRows = async function readMonthlyCacheRows(
  userId,
  yearMonths,
) {
  return _readMonthlyCacheRows(userId, yearMonths);
};

exports.triggerMonthlyRecalc = async function triggerMonthlyRecalc(
  userId,
  yearMonth,
) {
  return _triggerMonthlyRecalc(userId, yearMonth);
};

exports.readCategoryTotals = async function readCategoryTotals(
  yearMonth,
  householdId,
) {
  return _readCategoryTotals(yearMonth, householdId);
};

exports.READ_ERROR_MESSAGE =
  'No se pudieron cargar los datos. Inténtalo de nuevo.';
